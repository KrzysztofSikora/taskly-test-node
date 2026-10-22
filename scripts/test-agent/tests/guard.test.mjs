import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const guard = join(root, '.claude/hooks/guard.mjs');

function decide(event) {
  const res = spawnSync('node', [guard], {
    input: typeof event === 'string' ? event : JSON.stringify(event),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout ? JSON.parse(res.stdout).hookSpecificOutput.permissionDecision : 'pass';
}

test('lets test files through and denies production code', () => {
  assert.equal(decide({ tool_name: 'Write', tool_input: { file_path: join(root, 'backend/tests/config.test.ts') } }), 'pass');
  assert.equal(decide({ tool_name: 'Edit', tool_input: { file_path: 'frontend/src/lib/http.test.ts' } }), 'pass');
  assert.equal(decide({ tool_name: 'Edit', tool_input: { file_path: join(root, 'backend/src/factory.ts') } }), 'deny');
  assert.equal(decide({ tool_name: 'Write', tool_input: { file_path: 'backend/tests/../src/x.test.ts' } }), 'deny');
  assert.equal(decide({ tool_name: 'Write', tool_input: { file_path: '/etc/passwd' } }), 'deny');
  assert.equal(decide({ tool_name: 'Write', tool_input: { file_path: '.github/workflows/ci.yml' } }), 'deny');
});

test('denies reading secrets, unknown tools and disallowed commands', () => {
  assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: join(root, '.env') } }), 'deny');
  assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: '.env.example' } }), 'pass');
  assert.equal(decide({ tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } }), 'deny');
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: 'npx vitest run' } }), 'deny');
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: 'git status --short' } }), 'pass');
  assert.equal(decide({ tool_name: 'StructuredOutput', tool_input: {} }), 'pass');
});

test('fails closed on malformed input', () => {
  assert.equal(decide('not json'), 'deny');
});
