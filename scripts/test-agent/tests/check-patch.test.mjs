import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '../check-patch.mjs');
let repo;

function setupRepo(files) {
  repo = mkdtempSync(join(tmpdir(), 'check-patch-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo });
  git('init', '-q');
  write(files);
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
  return git;
}

function write(files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
}

function check() {
  const res = spawnSync('node', [script, '--json'], { cwd: repo, encoding: 'utf8' });
  return { code: res.status, ...JSON.parse(res.stdout) };
}

afterEach(() => rmSync(repo, { recursive: true, force: true }));

const base = {
  'backend/src/x.ts': 'export const x = 1\n',
  'backend/tests/x.test.ts': "it('a', () => { expect(1).toBe(1); expect(2).toBe(2) })\n",
};

test('accepts new and updated tests', () => {
  const git = setupRepo(base);
  write({ 'backend/tests/y.test.ts': "it('b', () => expect(1).toBe(1))\n", 'frontend/src/a.test.tsx': "it('c', () => {})\n" });
  git('add', '-A');
  const result = check();
  assert.equal(result.code, 0);
  assert.deepEqual(result.errors, []);
  assert.equal(result.files.length, 2);
});

test('rejects production code, deleted tests and focused or skipped tests', () => {
  const git = setupRepo(base);
  write({
    'backend/src/x.ts': 'export const x = 2\n',
    'backend/tests/y.test.ts': "it.only('b', () => {})\nit.skip('c', () => {})\nit.fails('d', () => {})\n",
  });
  git('rm', '-q', 'backend/tests/x.test.ts');
  git('add', '-A');
  const result = check();
  assert.equal(result.code, 1);
  const text = result.errors.join('\n');
  assert.match(text, /backend\/src\/x\.ts: not a test file/);
  assert.match(text, /x\.test\.ts: deleting tests/);
  assert.match(text, /\.only/);
  assert.match(text, /skipped or todo/);
  assert.match(text, /it\.fails/);
});

test('warns when assertions are removed from an existing test', () => {
  const git = setupRepo(base);
  write({ 'backend/tests/x.test.ts': "it('a', () => { expect(1).toBe(1) })\n" });
  git('add', '-A');
  const result = check();
  assert.equal(result.code, 0);
  assert.match(result.warnings.join('\n'), /assertion\(s\) removed/);
});
