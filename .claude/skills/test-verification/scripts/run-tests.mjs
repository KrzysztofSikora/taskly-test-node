#!/usr/bin/env node
// The only way the test agent runs project tooling. Prints a short, structured summary instead of
// raw tool output, and runs every child process with a scrubbed environment so code under test
// never sees credentials (Claude token, GitHub token) that the agent session holds.
//
//   node run-tests.mjs <backend|frontend> test [test files...]   run tests (all when none given)
//   node run-tests.mjs <backend|frontend> coverage               full suite with coverage (honours thresholds)
//   node run-tests.mjs <backend|frontend> typecheck              tsc --noEmit
//   node run-tests.mjs frontend format <test files...>           prettier --write on test files only
//   node run-tests.mjs <backend|frontend> flaky <test files...>  run the given tests 3 times
//   node run-tests.mjs <backend|frontend> discard <test files...> restore tracked test files to HEAD,
//                                                                 delete untracked (newly created) ones
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const { PROJECTS, isWritable, isTestFile } = await import(join(root, 'scripts/test-agent/policy.mjs'));

const TIMEOUT_MS = 5 * 60 * 1000;
const MAX_FAILURE_CHARS = 1500;
const SAFE_ENV = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'TZ', 'CI', 'NODE_OPTIONS', 'npm_config_cache'];

const [project, action = 'test', ...files] = process.argv.slice(2);
const ACTIONS = ['test', 'coverage', 'typecheck', 'format', 'flaky', 'discard'];
if (!PROJECTS[project] || !ACTIONS.includes(action)) {
  fail(`usage: run-tests.mjs <backend|frontend> <${ACTIONS.join('|')}> [test files...]`);
}
const cwd = join(root, PROJECTS[project].dir);
for (const file of files) {
  if (!file.startsWith(`${PROJECTS[project].dir}/`) || !isTestFile(file) || !isWritable(file) || !existsSync(join(root, file))) {
    fail(`not an existing ${project} test file (use a repo-relative path): ${file}`);
  }
}
if (['format', 'flaky', 'discard'].includes(action) && files.length === 0) fail(`${action} needs at least one test file`);
if (!existsSync(join(cwd, 'node_modules'))) fail(`${project}/node_modules is missing; dependencies must be installed before the agent runs`);

function fail(message) {
  console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(2);
}

function run(command, args) {
  const env = Object.fromEntries(SAFE_ENV.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
  const result = spawnSync(command, args, { cwd, env: { ...env, FORCE_COLOR: '0' }, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
  return {
    code: result.status,
    timedOut: result.error?.code === 'ETIMEDOUT',
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, ''),
  };
}

const local = (file) => relative(cwd, join(root, file));
const tail = (text, size = 3000) => (text.length > size ? `…${text.slice(-size)}` : text);

function vitest(extraArgs, testFiles) {
  const dir = mkdtempSync(join(tmpdir(), 'vitest-'));
  const report = join(dir, 'report.json');
  const res = run('npx', ['vitest', 'run', '--reporter=dot', '--reporter=json', `--outputFile.json=${report}`, ...extraArgs, ...testFiles.map(local)]);
  let summary = null;
  if (existsSync(report)) {
    const json = JSON.parse(readFileSync(report, 'utf8'));
    summary = {
      files: json.numTotalTestSuites !== undefined ? json.testResults.length : undefined,
      tests: { total: json.numTotalTests, passed: json.numPassedTests, failed: json.numFailedTests, skipped: json.numPendingTests + json.numTodoTests },
      failures: json.testResults.flatMap((suite) => {
        const file = relative(root, suite.name);
        const failed = suite.assertionResults.filter((test) => test.status === 'failed').map((test) => ({
          file, test: test.fullName, message: (test.failureMessages ?? []).join('\n').slice(0, MAX_FAILURE_CHARS),
        }));
        // A suite can fail without failing tests: syntax, import or type errors.
        if (suite.status === 'failed' && failed.length === 0) failed.push({ file, test: '(suite)', message: (suite.message ?? '').slice(0, MAX_FAILURE_CHARS) });
        return failed;
      }),
    };
  }
  rmSync(dir, { recursive: true, force: true });
  return { res, summary };
}

let output;
if (action === 'test') {
  const { res, summary } = vitest([], files);
  output = { ok: res.code === 0, timedOut: res.timedOut, ...summary, log: summary ? undefined : tail(res.output) };
} else if (action === 'flaky') {
  const runs = [1, 2, 3].map(() => vitest(['--sequence.shuffle'], files));
  const outcomes = runs.map(({ res }) => res.code === 0);
  output = { ok: outcomes.every(Boolean), stable: outcomes.every((o) => o === outcomes[0]), runs: outcomes, failures: runs.flatMap(({ summary }) => summary?.failures ?? []) };
} else if (action === 'coverage') {
  const { res, summary } = vitest(['--coverage', '--coverage.reportOnFailure', '--coverage.reporter=json-summary', '--coverage.reporter=text-summary'], []);
  const file = join(cwd, 'coverage/coverage-summary.json');
  let coverage = null;
  if (existsSync(file)) {
    const json = JSON.parse(readFileSync(file, 'utf8'));
    coverage = {
      total: { lines: json.total.lines.pct, branches: json.total.branches.pct, functions: json.total.functions.pct, statements: json.total.statements.pct },
      files: Object.fromEntries(Object.entries(json).filter(([key]) => key !== 'total').map(([key, value]) => [relative(root, key), { lines: value.lines.pct, branches: value.branches.pct }])),
    };
  }
  const thresholdErrors = [...res.output.matchAll(/ERROR: Coverage for .*/g)].map((match) => match[0]);
  output = { ok: res.code === 0, ...summary, threshold_errors: thresholdErrors, coverage };
} else if (action === 'typecheck') {
  const res = run('npx', ['tsc', '--noEmit']);
  const errors = res.output.split('\n').filter((line) => /error TS\d+/.test(line));
  output = { ok: res.code === 0, errors: errors.slice(0, 40), more: Math.max(0, errors.length - 40) };
} else if (action === 'format') {
  if (project !== 'frontend') fail('only the frontend uses Prettier');
  const bad = files.filter((file) => !isWritable(file));
  if (bad.length) fail(`refusing to format non-test files: ${bad.join(', ')}`);
  const res = run('npx', ['prettier', '--write', ...files.map(local)]);
  output = { ok: res.code === 0, log: tail(res.output, 1000) };
} else if (action === 'discard') {
  const tracked = new Set(execFileSync('git', ['ls-files', '--', ...files], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean));
  const result = files.map((file) => {
    if (tracked.has(file)) {
      execFileSync('git', ['checkout', 'HEAD', '--', file], { cwd: root });
      return { file, action: 'restored to HEAD' };
    }
    rmSync(join(root, file));
    return { file, action: 'deleted (created in this run)' };
  });
  output = { ok: true, files: result };
}
console.log(JSON.stringify(output, null, 2));
process.exit(output.ok ? 0 : 1);
