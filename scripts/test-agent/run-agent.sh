#!/usr/bin/env bash
# Runs the test-writer agent headless. Same entry point locally and in GitHub Actions.
#
#   scripts/test-agent/run-agent.sh pr <base-ref> [out-dir]   tests for the changes in <base-ref>...HEAD
#   scripts/test-agent/run-agent.sh all [out-dir]             backfill: missing tests across the repo
#
# Writes to <out-dir> (default .test-agent/):
#   transcript.jsonl  full session (stream-json), uploaded as a CI artifact
#   report.json       the agent's structured report (scripts/test-agent/report-schema.json)
#   meta.json         outcome, turns, duration and cost of the session
#
# Auth: CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in the environment, else the local login.
# Limits (env): TEST_AGENT_MODEL (sonnet), TEST_AGENT_MAX_TURNS (pr: 80, all: 150),
#               TEST_AGENT_TIMEOUT (pr: 25m, all: 60m).
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

mode="${1:-}"
case "$mode" in
  pr)
    base="${2:?usage: run-agent.sh pr <base-ref> [out-dir]}"
    out="${3:-.test-agent}"
    [[ "$base" =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "invalid base ref: $base" >&2; exit 2; }
    git rev-parse --verify --quiet "$base^{commit}" >/dev/null || { echo "unknown base ref: $base" >&2; exit 2; }
    task="Mode: pull request. Base ref: ${base}. Analyse the changes in ${base}...HEAD with
\`node .claude/skills/pr-change-analysis/scripts/analyze-changes.mjs --base ${base}\`, then create or
update unit tests for the changed behaviour, verify them, and return the report."
    turns="${TEST_AGENT_MAX_TURNS:-80}"
    limit="${TEST_AGENT_TIMEOUT:-25m}"
    ;;
  all)
    out="${2:-.test-agent}"
    task="Mode: backfill. Analyse the whole repository with
\`node .claude/skills/pr-change-analysis/scripts/analyze-changes.mjs --all\` and add the missing unit
tests for the backend and the frontend, most valuable uncovered behaviour first. Verify them and
return the report."
    turns="${TEST_AGENT_MAX_TURNS:-150}"
    limit="${TEST_AGENT_TIMEOUT:-60m}"
    ;;
  *)
    sed -n '2,15p' "$0" >&2
    exit 2
    ;;
esac

for project in backend frontend; do
  [[ -d "$project/node_modules" ]] || { echo "$project/node_modules is missing: run npm ci in $project first" >&2; exit 2; }
done
command -v claude >/dev/null || { echo "claude CLI not found (npm i -g @anthropic-ai/claude-code)" >&2; exit 2; }

mkdir -p "$out"
transcript="$out/transcript.jsonl"

# Minimal environment: the session (and every tool it starts) sees only what it needs.
# GITHUB_TOKEN and other CI secrets are deliberately not passed through.
env_args=(PATH="$PATH" HOME="$HOME" LANG="${LANG:-C.UTF-8}" CI="${CI:-}" TEST_AGENT_RUN=1)
for var in CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY XDG_CONFIG_HOME; do
  [[ -n "${!var:-}" ]] && env_args+=("$var=${!var}")
done

task="${task}
Turn budget: ${turns} turns."

set +e
env -i "${env_args[@]}" timeout --kill-after=30s "$limit" claude -p "$task" \
  --agent test-writer \
  --model "${TEST_AGENT_MODEL:-sonnet}" \
  --max-turns "$turns" \
  --settings scripts/test-agent/claude-settings.json \
  --setting-sources project \
  --permission-mode dontAsk \
  --strict-mcp-config \
  --disallowedTools "WebFetch,WebSearch,Agent,NotebookEdit" \
  --json-schema "$(cat scripts/test-agent/report-schema.json)" \
  --no-session-persistence \
  --output-format stream-json --verbose \
  > "$transcript"
status=$?
set -e

node scripts/test-agent/extract-result.mjs "$transcript" "$out" "$status"
