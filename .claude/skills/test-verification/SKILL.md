---
name: test-verification
description: Run, debug and validate the tests the agent wrote - targeted runs, a bounded fix loop, flakiness check, type check, formatting and full-suite coverage - and classify every remaining failure as a test problem or a suspected production bug. Use after writing or updating tests and before reporting.
allowed-tools: Bash(node .claude/skills/test-verification/scripts/run-tests.mjs *) Read Grep Glob Edit Write
---

# Test verification

A generated test counts only when it ran, passed, and would fail if the behaviour broke. All
tooling goes through one script. It scrubs credentials from the environment and prints a
compact JSON summary:

```bash
node .claude/skills/test-verification/scripts/run-tests.mjs <project> test <test files...>      # targeted run while iterating
node .claude/skills/test-verification/scripts/run-tests.mjs <project> flaky <test files...>     # 3 shuffled runs
node .claude/skills/test-verification/scripts/run-tests.mjs <project> typecheck                 # tsc --noEmit
node .claude/skills/test-verification/scripts/run-tests.mjs frontend format <test files...>     # Prettier, test files only
node .claude/skills/test-verification/scripts/run-tests.mjs <project> coverage                  # full suite + coverage + thresholds
node .claude/skills/test-verification/scripts/run-tests.mjs <project> discard <test files...>   # undo your changes to a test file
```

`<project>` is `backend` or `frontend`, and test files are repo-relative paths. Run each command
on its own: the guard rejects pipes, `&&`, redirects and shell variables. `discard` restores a
tracked test file to its committed version, or deletes a test file you created in this run.

## Loop (per test file)

1. **Run the file** with `test`.
2. **On failure, read the message and classify it:**
   - *Test problem* (wrong import path, wrong mock shape, wrong query, missing `await`, type
     error, wrong expectation about what the code does): fix the test. Re-read the source if
     the expectation was wrong. The code is the specification of current behaviour unless
     the PR shows a different intent.
   - *Suspected production bug* (the code contradicts its own validation rules, types, API
     contract or the PR's intent): do **not** change the expectation to match the bug, and do
     not touch production code. Remove that single test from the file, keep the rest, and
     record a `suspected_bug` with file, line, expected vs actual and the test code you removed.
3. **At most 3 fix attempts per file.** After the third failed attempt, keep only the tests that
   pass (remove the failing ones), or `discard` the file if none pass, and report it as `failed`
   with the last error. Never leave a failing test in the tree.
4. When the file passes, run `flaky` on it. Unstable results mean hidden shared state, real
   timers or ordering assumptions. Fix it or drop that test and report it.

## Mutation sanity check (manual, cheap)

For each behaviour you claim to cover, ask: *if I broke this line in the source, would a
test fail?* If you are unsure for an important branch (validation, error mapping, status
codes), strengthen the assertion. Assert the value, not just that "something was called".
Never edit production code to try it.

## Before reporting (per project you touched)

1. `typecheck`: must be clean. Type errors in your tests are test problems.
2. `format` on frontend test files you created or changed.
3. `coverage`: the full suite must pass, including the existing per-file thresholds of
   `validators.ts` and `mappers.ts` (100%). Record total and per-file coverage of the files you
   targeted. A coverage run that fails only because of a pre-existing threshold you did not
   affect is not your failure: say so in the report.

## Never

- Weaken, skip, delete or loosen an existing assertion to make the suite green.
- Use `.only`, `.skip`, `.todo`, `it.fails`, or raise timeouts to hide slowness.
- Change thresholds, configs, `package.json` or production code.
- Claim a result you did not get from the script output. The report quotes the real numbers.
  CI re-runs everything independently and compares.
