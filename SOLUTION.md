# Unit test agent and PR workflow

A custom **Claude Code** agent, `test-writer`, with four reusable skills. On every pull request
it decides per changed source file whether unit tests must be created, updated or skipped,
writes Vitest tests for the backend (Express + Prisma) and the frontend (React), and runs them.
GitHub Actions then re-verifies the result without trusting the agent, commits the tests to
the PR branch and posts a report on the PR. Full details:
[docs/test-agent.md](docs/test-agent.md).

```
pull request ─▶ Agent ─────────────────────▶ Verify ──────────────────▶ Publish
               Claude token, read-only repo   no secrets: path policy,   write token, no repo code:
               token, cannot push             type check, tests,         commit tests, start CI,
               analyse ▸ write ▸ run ▸ report coverage, Prettier         post the PR comment
```

## Where the agent and skills are defined, and how they are used

| File | Role during a run |
|------|-------------------|
| `.claude/agents/test-writer.md` | The custom agent: procedure, hard rules, tool allowlist. It preloads the four skills. |
| `.claude/skills/pr-change-analysis/` | Runs `analyze-changes.mjs`, which lists the changed files, whether each is testable, the test that owns it (resolved from imports), where it is mocked, the changed lines and coverage. The agent then decides `create` / `update` / `skip` / `deferred` / `blocked`. |
| `.claude/skills/backend-unit-tests/` | Repo conventions and recipes: Supertest with a fake repository, Prisma delegates spied without a database, `vi.stubEnv`. |
| `.claude/skills/frontend-unit-tests/` | Mocked design system, user-event, `renderHook` with a `QueryClientProvider`, a stubbed `fetch`, fake timers. |
| `.claude/skills/test-verification/` | Runs tests only through `run-tests.mjs` (scrubbed environment, compact JSON). Fixes failing tests within 3 attempts, then runs a 3× shuffled flakiness check, type check, Prettier and full coverage. A test that exposes a production bug is held back and reported, never adjusted to the bug. |
| `.claude/hooks/guard.mjs`, `scripts/test-agent/policy.mjs` | One path policy shared by the analysis, the guard hook and the CI check. The agent may write only test files and may run only allowlisted commands. |
| `scripts/test-agent/` | `run-agent.sh` (headless runner, also used locally), report schema, `check-patch.mjs`, `verify.mjs`, `render-report.mjs`, plus tests for all of them. |
| `.github/workflows/test-agent.yml`, `ci.yml` | The PR workflow, and regular CI. |

`run-agent.sh` starts `claude -p --agent test-writer` with a permission allowlist (`dontAsk`),
the guard hook, a turn budget and `--json-schema`. The agent must end with a structured report:
a decision and reason per file, behaviours covered, skills used, suspected bugs and findings.
The PR comment is rendered from that report, next to the independent CI results.

## Main technical decisions

- **Claude Code agent and skills as files in the repo.** The same agent runs interactively, as
  a subagent, and headless in CI. I call the CLI directly, not `claude-code-action`, so the
  version, permissions, tools, limits and output schema are pinned in one script and the agent
  job stays read-only.
- **Skills split by responsibility.** Analysis, backend, frontend and verification each change
  for different reasons. Each one encodes the conventions of this repo's existing tests, so the
  generated tests look like the team's own.
- **Scripts provide facts, the model provides judgement.** Change analysis, test mapping,
  coverage and test results come from deterministic scripts. The model decides what is worth
  testing and how.
- **Don't trust the agent.** Verification runs in a separate job without the token. Only a
  patch that touches test files alone and passes the full suites is committed.
- **Defence in depth.** Tool allowlist → permission allowlist → PreToolUse guard → CI patch
  check (run from tooling copied before the patch is applied). Tests run with a scrubbed
  environment, so test code never sees the token. The token is an environment secret, and runs
  only happen for same-repo PRs by the owner (fork PRs get no secrets). There are no
  `pull_request_target` or comment triggers. Actions are pinned by SHA, the CLI by version,
  and dependencies are installed with `npm ci --ignore-scripts`. Turn, time and concurrency
  limits apply.
- **Commit on the PR branch** (fast-forward only), so the tests sit next to the change and can
  be dropped with one revert.

## How to run the PR workflow, and prerequisites

1. Create a token with `claude setup-token` (Claude Pro/Max), or use an Anthropic API key
   (`ANTHROPIC_API_KEY` in the *Run test-writer* step).
2. *Settings → Environments* → create `claude-agent` **before the first run**, and add the
   environment secret `CLAUDE_CODE_OAUTH_TOKEN`. Optionally add a required reviewer, so that
   every run waits for approval.
3. Open a non-draft PR from a branch of this repository that changes `backend/src` or
   `frontend/src`. *Agent → Verify → Publish* run automatically. The result is a commit
   `test(agent): add unit tests for #N` and a **Test agent report** comment, updated on each
   push. To opt a PR out, use the label `skip-test-agent`.

Locally: `scripts/test-agent/run-agent.sh pr origin/main` (or `all` for backfill), then
`check-patch.mjs` and `verify.mjs`. Tooling tests: `node --test 'scripts/test-agent/tests/*.test.mjs'`.

## Example runs

**Backfill of the existing code** (two `run-agent.sh all` runs, each verified independently):

| | Before | After |
|---|---|---|
| Backend: tests, lines / branches | 48, 33.0% / 33.3% | 78, **97.2% / 97.9%** |
| Frontend: tests, lines / branches | 18, 47.7% / 43.8% | 90, **99.3% / 97.1%** |

The first run stopped after 55 of 150 turns and skipped the flakiness check. The fix: the task
now states the turn budget, and `deferred` and `flaky_check` are part of the report. After it,
every file passed the shuffled runs.

**[PR #2](https://github.com/KrzysztofSikora/taskly-test-node/pull/2)** adds "Clear all
completed tasks" across both projects, deliberately without test changes. It breaks
`router.test.ts` and `TodosHeader.test.tsx` (type errors) and 11 tests in `TodosPage.test.tsx`.
[Agent run](https://github.com/KrzysztofSikora/taskly-test-node/actions/runs/39819922506):
`claude-sonnet-5-5`, 38 turns, 98 s.

- **Decisions:** `create` for the new `useClearCompletedMutation` hook. `update` for
  `repository`, `router`, `api/todos`, `TodosHeader` and `TodosPage`: it repaired all three
  broken tests and added the new behaviour, including that `DELETE /completed` never reaches
  `delete(:id)`, which pins the route order. `not_testable` for `openapi.json`, `types.ts` and
  `queryKeys.ts`.
- **Skills used:** all four. Analysis decided per file, the two writing skills supplied the
  recipes, and verification ran the targeted, flakiness, type, format and coverage runs.
- **Results:** independent *Verify* found 6 test files, only test paths, clean types,
  **backend 80/80, frontend 102/102**. Backend lines went from 94.7% to 97.3%, and the targeted
  files are at 100% (`TodosPage` 97%). *Publish* committed the tests and CI went green.
- **Second run** on the same PR, after a rebase: every change was already covered, so the
  decision was `no_changes`. No commit was made, and the same comment was updated.
- **What the runs surfaced** (fixed in #3 and #4): a token pasted with a line break (now
  stripped and reported clearly), missing baseline coverage when the PR's tests fail
  (`--coverage.reportOnFailure`), and no CI on the bot commit (*Publish* now dispatches
  `ci.yml`).

## Assumptions

- Only the repository owner's PRs may use the owner's Claude token. Others can fork and use
  their own.
- "Unit tests" means no database or network, matching the existing suites (Prisma is spied,
  not connected).
- The Vitest coverage configuration defines what is worth testing (types, barrels, design
  system and entry points are excluded).
- A separate bot commit on the PR branch is acceptable to the author.

## Limitations

- CI guarantees the tests are safe and pass, not that they are meaningful. The comment lists
  the covered behaviours for review.
- Command filtering matches text. The real boundary is the ephemeral, read-only CI job.
- The bot's CI runs as `workflow_dispatch`, not `pull_request`, which matters for branch
  protection rules.
- A Pro token shares the owner's usage limits. Very large PRs may hit the turn budget, and the
  remaining files are then reported as `deferred`.
- Test mapping relies on relative imports and naming conventions. Path aliases would need
  resolver support.

## What I would change for production

- A GitHub App identity instead of `GITHUB_TOKEN` (normal PR CI, check runs with annotations).
- Network egress allowlist for the agent job (Anthropic API, npm registry only).
- Mutation testing (StrykerJS) of the generated tests, with the score in the report.
- An API key with a spend cap (`--max-budget-usd`) and per-PR cost in the report.
- An evaluation set of PRs with known expected decisions and seeded bugs, run on every change
  to the agent or its skills.
- Diff coverage as a required check, and caching of dependencies and baseline coverage.
