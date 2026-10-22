# Unit test agent and PR workflow

A custom **Claude Code** agent, `test-writer`, with four reusable skills. It analyses a change,
decides per source file whether unit tests must be created, updated or skipped, writes Vitest
tests for the Express/Prisma backend and the React frontend, and verifies them by running them.
A GitHub Actions workflow runs it on every pull request. The workflow re-verifies the result
without trusting the agent, commits the tests to the PR branch, and posts a report comment
on the PR.

```
pull request ──▶ agent job ───────────────▶ verify job ───────────────▶ publish job
 (owner, same     Claude token, read-only     no secrets, read-only      write token, runs no
  repo, not        repo token, no push         policy check of the        repo code: git apply,
  draft)           credentials                 patch, type check, tests,  commit, push, comment
                   analyse ▸ write ▸ verify    coverage, Prettier
                   ▸ report.json + patch
```

| Where | What |
|-------|------|
| `.claude/agents/test-writer.md` | The custom agent: role, procedure, hard rules, tool allowlist, preloaded skills |
| `.claude/skills/pr-change-analysis/` | Skill + script: what changed, what is testable, which test owns it, the create/update/skip decision |
| `.claude/skills/backend-unit-tests/` | Skill: conventions and recipes for Express routers, Prisma repositories, config, lifecycle |
| `.claude/skills/frontend-unit-tests/` | Skill: conventions and recipes for components, TanStack Query hooks, fetch wrapper, pure utils |
| `.claude/skills/test-verification/` | Skill + script: run, fix loop, flakiness, type check, Prettier, coverage, bug classification |
| `.claude/hooks/guard.mjs` | PreToolUse guard: writes only to test files, allowlisted commands, no secrets |
| `scripts/test-agent/` | Runner (`run-agent.sh`), settings, report schema, path policy, CI patch check, verification, PR comment renderer, and their tests |
| `.github/workflows/test-agent.yml` | The agentic PR workflow |
| `.github/workflows/ci.yml` | Regular CI: both projects plus the agent tooling tests |

## Main technical decisions

**Claude Code, run headless with `--agent`.** The task asks for a custom agent with reusable
skills. Claude Code has both as first-class files in the repo (`.claude/agents`,
`.claude/skills`), so the same agent works interactively (`claude --agent test-writer`, or as a
subagent) and in CI (`claude -p --agent test-writer`). I run the CLI directly rather than
through `anthropics/claude-code-action`. That keeps the job read-only and pins the exact CLI
version, permission mode, tool list, turn limit and output schema in one script. It also lets
me run the identical command locally (`scripts/test-agent/run-agent.sh`).

**Skills split by responsibility, not by step.** Analysis, backend writing, frontend writing and
verification each change for different reasons. The test conventions of one project should not
leak into the other, and the verification rules apply to both. Each skill carries the repo's
real conventions, read from the existing tests: flat `it` blocks, mocked design system,
Supertest with a fake repository, Prisma delegates spied without a database. Without them the
agent writes generic tests that look foreign in this codebase.

**Deterministic facts, model judgement.** Scripts give the agent facts: changed files and lines,
the test file that owns a source (resolved from real imports, not file names), where a module
is mocked, current coverage, compact test results. The model only decides what is worth testing
and how. The same path policy (`scripts/test-agent/policy.mjs`) drives the analysis, the guard
hook and the CI check, so they cannot drift apart. Exclusions mirror the coverage config of
both Vitest setups.

**Structured report.** The agent must end with JSON that matches
`scripts/test-agent/report-schema.json` (`--json-schema`). Every analysed file gets a decision
and a reason, and the report adds behaviours covered, skills used, suspected bugs and findings.
The PR comment is rendered from it by a plain script. The model never writes Markdown that goes
straight into the PR.

**Don't trust the agent's results.** The agent's claims ("tests pass, coverage went up") are
shown next to an independent CI run in a job that has no access to the Claude token. Only
tests that pass that run are committed.

**Never encode a bug.** When a test reveals that production code contradicts its own contract,
the agent keeps that test out of the suite and reports it as a suspected bug, with the test it
held back. It never edits production code and never adjusts the expectation to match the bug.

**Commit to the PR branch, not a second PR.** For a test-generation bot, a commit on the PR
branch keeps tests next to the change they cover, and the author can drop it with one revert.
The commit is fast-forward only, so if the author pushed in the meantime nothing is
overwritten. The comment says so and the patch stays in the run artifacts.

## Security

The evaluation weighs this heavily, and the workflow runs a model with write access to a
repository, so the agent is constrained at several independent layers:

| Threat | Mitigation |
|--------|------------|
| Someone else triggers runs on my Claude subscription | Runs only for non-draft PRs whose head branch is in this repo **and** whose triggering actor is the repo owner. Fork PRs get no secrets under `pull_request`. The token is an **environment secret** of `claude-agent` with a **required reviewer**, so every run waits for my approval. No `pull_request_target`, no comment triggers. |
| Agent edits production code, configs, workflows or itself | 1) tool allowlist in the agent (`Read, Write, Edit, Bash, StructuredOutput`); 2) permission allowlist in `scripts/test-agent/claude-settings.json` with `dontAsk` mode; 3) PreToolUse guard (`.claude/hooks/guard.mjs`) that denies writes outside test paths; 4) `check-patch.mjs` in the verify job rejects any non-test path, deleted/renamed tests, `.only`/`.skip`/`.todo`/`it.fails`, and oversized patches. Layer 4 runs from a copy of the tooling taken **before** the patch is applied. |
| Agent exfiltrates the token (e.g. via prompt injection in PR content) | Shell access is limited to two skill scripts and read-only git: no pipes, chaining, substitution, redirects, `npm`/`npx`/`curl`, network tools or `.env`. Tests run through `run-tests.mjs`, which starts every child process with a scrubbed environment (no `CLAUDE_*`, `GITHUB_*`), so test code never sees the token. The agent job has a read-only `GITHUB_TOKEN` and `persist-credentials: false`, and `run-agent.sh` starts Claude under `env -i` with only the variables it needs. Skills and the agent prompt state that PR content is data, not instructions, and that suspicious instructions are reported. |
| Agent "passes" by weakening tests | Forbidden by the rules, rejected by `check-patch` (skips, focus, `it.fails`, deletions), and reported as a warning when assertions disappear from an existing test. The verify job runs the **full** suite with the existing coverage thresholds. |
| Write token misused | Only the `publish` job has `contents: write` / `pull-requests: write`, and it executes no repository code: `git apply`, `git commit`, `git push`, `gh api`. Pushes made with `GITHUB_TOKEN` do not trigger workflows, so there are no loops. |
| Supply chain | Actions pinned by commit SHA. Claude Code pinned to an exact version. `npm ci --ignore-scripts` everywhere, with `prisma generate` as the only explicit build step. |
| Runaway cost or hangs | Turn limit (`--max-turns`, PR: 80), CLI timeout (25 min) and job timeout (40 min). `concurrency` cancels a running agent when the PR gets a new push. The `paths` filter skips PRs that do not touch `backend/src` or `frontend/src`. The `skip-test-agent` label opts a PR out. |

One finding from building this: hooks declared in an agent's frontmatter apply when the agent
runs as a **subagent**, but not when it is the main session (`claude --agent`). I verified this
with a forced write to `backend/src`, which went through. The guard is therefore also
registered in `scripts/test-agent/claude-settings.json`, which `run-agent.sh` always passes,
and the frontmatter copy covers interactive subagent use.

## Running it

### Prerequisites (one-time, repository owner)

1. **Claude token.** On your machine: `claude setup-token` (Pro/Max subscription) and copy
   the token. An Anthropic API key works too: set `ANTHROPIC_API_KEY` instead and add it
   to the `env` of the *Run test-writer* step.
2. **Environment.** *Settings → Environments → New environment* `claude-agent`:
   - *Required reviewers*: yourself (each run then waits for your approval; remove it for
     fully automatic runs),
   - *Deployment branches*: all branches (PR branches must be allowed),
   - *Environment secret* `CLAUDE_CODE_OAUTH_TOKEN` = the token.

   Create the environment **before** the first run. GitHub creates a missing environment
   automatically, without protection rules.
3. **Workflow permissions.** *Settings → Actions → General → Workflow permissions*:
   "Read repository contents" is enough. Jobs request `contents: write` /
   `pull-requests: write` explicitly where needed.

### On a pull request

Open a PR (not a draft) from a branch of this repository that changes `backend/src/**` or
`frontend/src/**`. Then:

1. *test-agent / Agent* waits for approval in the `claude-agent` environment. Approve it.
2. The agent runs (typically 5–20 minutes) and uploads `test-agent-run`: the patch, report,
   metadata and full transcript.
3. *Verify* applies the patch, checks the policy, type-checks, runs both suites with coverage
   and renders the comment (also in the job summary).
4. *Publish* commits the tests to the PR branch as `github-actions[bot]` (only if verification
   passed) and creates or updates the **Test agent report** comment.

Every new push to the PR re-runs the cycle and updates the same comment. To opt a PR out, add
the label `skip-test-agent`. It applies to events after the label is set: a label added by
`gh pr create --label` arrives just after the `opened` event, so for the first run just reject
the environment approval.

### Locally

```bash
(cd backend && npm ci) && (cd frontend && npm ci)
scripts/test-agent/run-agent.sh pr origin/main     # tests for the current branch's changes
scripts/test-agent/run-agent.sh all                # backfill missing tests across the repo
git add -A && node scripts/test-agent/check-patch.mjs
node scripts/test-agent/verify.mjs .test-agent/verify.json $(git diff --cached --name-only)
node scripts/test-agent/render-report.mjs .test-agent
```

It uses your local Claude Code login unless `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`
is set. Interactively: `claude --agent test-writer --settings scripts/test-agent/claude-settings.json`.

Tests for the tooling itself: `node --test 'scripts/test-agent/tests/*.test.mjs'` (also in CI).

## How the agent and skills are used during a run

`run-agent.sh` starts `claude -p --agent test-writer` with a short task ("Mode: pull request.
Base ref: origin/main …"). The agent's prompt replaces the default system prompt, and its
`skills:` frontmatter preloads all four skills into its context, so the procedure is there
from the first turn:

1. **pr-change-analysis**: runs `analyze-changes.mjs --base origin/main` and gets JSON with
   each changed file, whether it is testable (and why not), `own_test` / `target_test`,
   `mocked_in`, changed line ranges and current coverage. It then reads the diffs and decides
   `create` / `update` / `skip` / `blocked` per file and writes a short plan.
2. **backend-unit-tests / frontend-unit-tests**: for each file to test, it reads the closest
   existing test and the recipes (Supertest + fake repository, `vi.spyOn` on Prisma
   delegates, `renderHook` + `QueryClientProvider`, `vi.stubGlobal('fetch')`, fake timers)
   and writes the test.
3. **test-verification**: runs each file through `run-tests.mjs` (compact JSON, scrubbed env).
   It fixes test problems within 3 attempts and classifies real contradictions as suspected
   bugs. Then it runs the shuffled flakiness check, type check, Prettier, and the full suite
   with coverage.
4. The agent returns the report through the `StructuredOutput` tool. `extract-result.mjs`
   writes it to `report.json`, plus `meta.json` with turns, duration, tool calls and calls
   denied by the guard.

## Example runs

### 1. Backfill of the existing code (`run-agent.sh all`)

The base repository had tests for part of the code. The agent ran twice in backfill mode, and
each result was checked with `check-patch.mjs`, `verify.mjs` and a 3× shuffled run per file
before committing (commits `test: backfill … (pass 1)` and `(pass 2)`).

| | Before | After pass 1 | After pass 2 |
|---|---|---|---|
| Backend tests | 48 | 70 | 78 |
| Backend coverage, lines / branches | 33.0% / 33.3% | 78.0% / 93.8% | **97.2% / 97.9%** |
| Frontend tests | 18 | 54 | 90 |
| Frontend coverage, lines / branches | 47.7% / 43.8% | 82.1% / 70.1% | **99.3% / 97.1%** |
| Agent session | | 55 turns, 140 s | 60 turns, 190 s |

**Decisions (pass 1, 32 testable files):**
- 10 `create`: `health.ts`, `config.ts`, `factory.ts`, `lib/http.ts`, all six TanStack Query
  hooks.
- 4 `update`: `router.ts` (only list/create were tested), `api/todos.ts`, `utils/todos.ts`,
  `useNotice.ts`.
- `skip` for the files already at 100%.

Pass 2 took the remaining components and `database.ts` / `lifespan.ts` (4 `create`,
6 `update`). Every file passed the flakiness check.

**Skills:** `pr-change-analysis` ranked uncovered files with `--all`. `backend-unit-tests` and
`frontend-unit-tests` provided the recipes. For example, `factory.test.ts` covers malformed
JSON → 422, oversized body → 413, unknown route → 404, rejected DB call → 500;
`http.test.ts` covers abort vs. network failure; the hook tests check cache contents after
`mutateAsync`. `test-verification` ran targeted runs, then type check, Prettier and full
coverage.

**What the first run taught me** (fixed in `feat(test-agent): deferred decision, turn budget…`):
- The agent stopped after 55 of 150 turns, citing "budget".
- It labelled unfinished files `skip`.
- It did not run the flakiness check, though it admitted this in `findings`.

Since then the task states the turn budget, `deferred` is its own decision, and `flaky_check`
is part of the report schema. The second run used its budget properly and checked every
file. Small convention slips remain (a `describe` block in a new backend file where the
neighbours are flat), which is why the skills now say "match the file you extend" and why
review of the bot commit stays part of the process.

### 2. Pull request with a new feature (the agentic workflow)

_Filled in from the demo PR run._

## Assumptions

- Only the repository owner opens PRs that should consume the owner's Claude subscription.
  Outside contributors are not served automatically. They can fork and use their own token.
- "Unit tests" means fast tests without a database or network, which is how the existing
  suites are written (Prisma is spied, not connected). Integration tests against PostgreSQL
  are out of scope for the agent.
- The repo's coverage configuration is the authority on what is worth testing. The agent
  skips what Vitest excludes (types, barrels, design system, stories, entry points).
- Committing to the PR branch is acceptable to the PR author. The commit is a separate,
  revertible commit by `github-actions[bot]`.
- Frontend formatting is enforced with Prettier (`format:check`). Two files in the base repo
  failed it, and I formatted them in a separate commit so CI starts green.

## Limitations

- **The model decides what to test.** The policy and CI guarantee *safety* and that tests
  *pass*. They cannot guarantee the tests are *meaningful*. The skills push towards
  behavioural assertions, and the comment lists the behaviours covered for review. Mutation
  testing would measure it (see below).
- **The agent's commit does not trigger CI.** Pushes made with `GITHUB_TOKEN` do not start
  workflows. The verify job runs the same checks on exactly that tree, but GitHub shows no
  `ci` check on the bot commit until the next push.
- **Command filtering is pattern-based.** The guard and allowlist match command text. They
  are strong for this narrow command set, but the real boundary is the CI job itself: an
  ephemeral runner with a read-only token, a scrubbed environment for tests, and no push
  credentials.
- **Subscription limits.** With a Pro token, runs share the owner's usage limits. Very large
  PRs may hit the turn limit. The agent is told to finish what it has and report the rest.
- **Required reviewer approval** makes the workflow semi-automatic by design. Removing it
  makes it fully automatic, with the remaining guards.
- **Heuristic test mapping.** The owning test is found from relative imports and file name
  conventions. Path aliases or re-exported modules would need resolver support.

## What I would change for production

- **A GitHub App** instead of `GITHUB_TOKEN` for publishing, so the bot commit triggers CI
  and shows a proper identity. A check run with annotations instead of, or in addition to,
  the comment.
- **Network egress control** for the agent job (allowlist only the Anthropic API and the npm
  registry), e.g. with a hardened runner, so command filtering is not the main line of
  defence.
- **Mutation testing of generated tests** (StrykerJS on the changed files), with the score in
  the report. That measures whether the new tests would catch a real bug, not only whether
  they execute the code.
- **API key with a spend cap** on a dedicated workspace (`--max-budget-usd`) instead of a
  personal subscription, and per-PR cost in the report.
- **Evaluation set for the agent**: fixed PRs with known expected decisions and seeded bugs,
  run on every change to the agent or skills, to catch regressions in its judgement.
- **Coverage gate on changed lines** (diff coverage) as a required check, independent of
  the agent.
- **Caching**: reuse the `node_modules` and baseline coverage of the base commit across PR
  runs.
