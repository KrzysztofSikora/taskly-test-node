#!/usr/bin/env node
// Independent verification of the tree after the agent's patch is applied. Runs in CI without
// credentials and does not read anything the agent wrote except the test files themselves.
//   node scripts/test-agent/verify.mjs <out.json> [changed files...]
// Formatting is checked on the changed frontend files only, so pre-existing issues elsewhere do
// not count against the agent. Exit code 0 only when every check passes for both projects.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [out, ...changed] = process.argv.slice(2);
if (!out) {
  console.error('usage: verify.mjs <out.json> [changed files...]');
  process.exit(2);
}

const runTests = (...args) => {
  const res = spawnSync('node', ['.claude/skills/test-verification/scripts/run-tests.mjs', ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  try {
    return JSON.parse(res.stdout);
  } catch {
    return { ok: false, error: `${res.stdout}${res.stderr}`.slice(-2000) };
  }
};

const result = {};
for (const project of ['backend', 'frontend']) {
  const typecheck = runTests(project, 'typecheck');
  const coverage = runTests(project, 'coverage');
  result[project] = {
    ok: typecheck.ok && coverage.ok,
    typecheck: { ok: typecheck.ok, errors: typecheck.errors ?? (typecheck.error ? [typecheck.error] : []) },
    tests: coverage.tests ?? null,
    failures: coverage.failures ?? [],
    threshold_errors: coverage.threshold_errors ?? [],
    coverage: coverage.coverage ?? null,
    error: coverage.error,
  };
  console.log(`${project}: typecheck ${typecheck.ok ? 'ok' : 'FAILED'}, tests ${coverage.tests ? `${coverage.tests.passed}/${coverage.tests.total}` : 'n/a'}, coverage run ${coverage.ok ? 'ok' : 'FAILED'}`);
}

const formatTargets = changed.filter((file) => /^frontend\/.+\.(tsx?|json|html)$/.test(file)).map((file) => file.slice('frontend/'.length));
const format = formatTargets.length
  ? spawnSync('npx', ['prettier', '--check', ...formatTargets], { cwd: 'frontend', encoding: 'utf8' })
  : { status: 0, stdout: 'no changed frontend files', stderr: '' };
result.frontend.format = { ok: format.status === 0, files: formatTargets, log: `${format.stdout}${format.stderr}`.slice(-1500) };
result.frontend.ok &&= result.frontend.format.ok;
console.log(`frontend: format ${result.frontend.format.ok ? 'ok' : 'FAILED'}`);

result.ok = result.backend.ok && result.frontend.ok;
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
process.exit(result.ok ? 0 : 1);
