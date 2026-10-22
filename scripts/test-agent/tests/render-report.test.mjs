import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '../render-report.mjs');
let dir;

function render(files) {
  dir = mkdtempSync(join(tmpdir(), 'render-'));
  for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(value));
  return execFileSync('node', [script, dir], { encoding: 'utf8' });
}

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const coverage = (lines) => ({ coverage: { total: { lines, branches: lines, functions: lines }, files: { 'backend/src/core/config.ts': { lines, branches: lines } } } });

test('renders decisions, verification and coverage deltas', () => {
  const md = render({
    'report.json': {
      summary: 'Added tests for config.',
      files: [
        { path: 'README.md', decision: 'not_testable', reason: 'docs' },
        { path: 'backend/src/core/config.ts', decision: 'create', reason: 'new branches', test_file: 'backend/tests/config.test.ts', status: 'passed', behaviours: ['throws on a missing variable'] },
      ],
      skills_used: [{ skill: 'backend-unit-tests', purpose: 'config tests' }],
      suspected_bugs: [],
      findings: [],
    },
    'check.json': { ok: true, files: [{ status: 'A', path: 'backend/tests/config.test.ts' }], changed_lines: 40, errors: [], warnings: [] },
    'verify.json': { ok: true, backend: { ok: true, typecheck: { ok: true }, tests: { total: 50, passed: 50, failed: 0 }, failures: [], threshold_errors: [], ...coverage(40) } },
    'coverage-before.json': { backend: coverage(30) },
    'context.json': { outcome: 'committed', commit: 'abc1234', run_url: 'https://example.invalid/run/1', head_sha: 'deadbeef' },
  });
  assert.ok(md.startsWith('<!-- test-agent-report -->'));
  assert.match(md, /committed to this branch in abc1234/);
  // create rows come before not_testable rows
  assert.ok(md.indexOf('backend/src/core/config.ts') < md.indexOf('README.md'));
  assert.match(md, /\| backend \| ✅ \| ✅ 50\/50 \| 40\.0% \(\+10\.0\)/);
  assert.match(md, /30\.0% → 40\.0%/);
  assert.match(md, /throws on a missing variable/);
});

test('distinguishes an agent that did not start from one that produced no report', () => {
  assert.match(render({ 'context.json': { outcome: 'agent_failed' } }), /did not run/);
  rmSync(dir, { recursive: true, force: true });
  const md = render({ 'context.json': { outcome: 'agent_failed' }, 'meta.json': { outcome: 'error_max_turns' } });
  assert.match(md, /did not finish with a report/);
  assert.doesNotMatch(md, /### Decisions/);
});

test('escapes table-breaking characters from agent text', () => {
  const md = render({
    'report.json': { summary: 's', files: [{ path: 'a.ts', decision: 'skip', reason: 'x | y\nz' }], skills_used: [], suspected_bugs: [], findings: [] },
  });
  assert.match(md, /x \\\| y z/);
});

test('shows the agent error, type errors, and groups identical test failures', () => {
  const failure = (test) => ({ file: 'frontend/src/a.test.tsx', test, message: 'Error: No QueryClient set\n    at x\n    at y\n    at z\n    at w' });
  const md = render({
    'meta.json': { outcome: 'api_error', error: 'Invalid auth token', turns: 1 },
    'verify.json': {
      ok: false,
      backend: { typecheck: { ok: false, errors: ['tests/router.test.ts(11,43): error TS2345: missing deleteCompleted'] }, tests: { total: 1, passed: 1, failed: 0 }, failures: [] },
      frontend: { typecheck: { ok: true, errors: [] }, tests: { total: 5, passed: 0, failed: 5 }, failures: ['a', 'b', 'c', 'd', 'e'].map(failure) },
    },
    'context.json': { outcome: 'agent_failed' },
  });
  assert.match(md, /did not finish with a report: Invalid auth token/);
  assert.match(md, /backend\/tests\/router\.test\.ts\(11,43\): error TS2345/);
  assert.match(md, /`frontend\/src\/a\.test\.tsx`: 5 tests \(a; b; c; …\)/);
  assert.equal(md.match(/No QueryClient set/g).length, 1);
  assert.doesNotMatch(md, /at w/);
});
