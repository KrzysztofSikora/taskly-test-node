import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '../extract-result.mjs');
let dir;

function extract(events, status = 0) {
  dir = mkdtempSync(join(tmpdir(), 'extract-'));
  writeFileSync(join(dir, 'transcript.jsonl'), events.map((e) => JSON.stringify(e)).join('\n'));
  const res = spawnSync('node', [script, join(dir, 'transcript.jsonl'), dir, String(status)], { encoding: 'utf8' });
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  const report = existsSync(join(dir, 'report.json')) ? JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) : null;
  return { code: res.status, meta, report };
}

afterEach(() => rmSync(dir, { recursive: true, force: true }));

test('writes the structured report and counts tool calls', () => {
  const { code, meta, report } = extract([
    { type: 'system', subtype: 'init', model: 'claude-sonnet-5-5' },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }, { type: 'tool_use', name: 'Bash' }] } },
    { type: 'result', subtype: 'success', is_error: false, num_turns: 3, duration_ms: 4200, structured_output: { summary: 'ok' }, modelUsage: { 'claude-sonnet-5-5': {} } },
  ]);
  assert.equal(code, 0);
  assert.deepEqual(report, { summary: 'ok' });
  assert.equal(meta.outcome, 'success');
  assert.deepEqual(meta.tool_calls, { Bash: 2 });
  assert.equal(meta.duration_s, 4);
});

test('records the CLI error and the init model when the session fails', () => {
  const { code, meta, report } = extract([
    { type: 'system', subtype: 'init', model: 'claude-sonnet-5-5' },
    { type: 'result', subtype: 'success', is_error: true, terminal_reason: 'api_error', result: 'Invalid auth token', num_turns: 1, duration_ms: 10 },
  ], 1);
  assert.equal(code, 1);
  assert.equal(report, null);
  assert.equal(meta.outcome, 'api_error');
  assert.equal(meta.error, 'Invalid auth token');
  assert.equal(meta.model, 'claude-sonnet-5-5');
});

test('reports a missing result as no_result', () => {
  const { code, meta } = extract([{ type: 'system', subtype: 'init' }], 124);
  assert.equal(code, 1);
  assert.equal(meta.outcome, 'no_result');
  assert.equal(meta.timed_out, true);
});
