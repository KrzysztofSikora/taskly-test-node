#!/usr/bin/env node
// Extracts the agent's structured report and session metadata from a stream-json transcript.
//   node extract-result.mjs <transcript.jsonl> <out-dir> <exit-status>
// Exit code: 0 when the session finished and produced a report, 1 otherwise.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [transcript, out, status] = process.argv.slice(2);
const lines = readFileSync(transcript, 'utf8').split('\n').filter(Boolean).map((line) => {
  try { return JSON.parse(line); } catch { return null; }
}).filter(Boolean);

const result = lines.findLast((event) => event.type === 'result');
const tools = {};
const denials = [];
for (const event of lines) {
  for (const block of event.type === 'assistant' ? event.message?.content ?? [] : []) {
    if (block.type === 'tool_use') tools[block.name] = (tools[block.name] ?? 0) + 1;
  }
}
for (const denial of result?.permission_denials ?? []) denials.push({ tool: denial.tool_name, input: denial.tool_input });

const meta = {
  exit_status: Number(status),
  timed_out: Number(status) === 124 || Number(status) === 137,
  outcome: result?.subtype ?? 'no_result',
  is_error: result?.is_error ?? true,
  turns: result?.num_turns ?? null,
  duration_s: result ? Math.round(result.duration_ms / 1000) : null,
  cost_usd: result?.total_cost_usd ?? null,
  model: Object.keys(result?.modelUsage ?? {})[0] ?? null,
  tool_calls: tools,
  permission_denials: denials,
};
writeFileSync(join(out, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);

const report = result?.structured_output ?? null;
if (report) writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`test-agent: ${meta.outcome}, ${meta.turns ?? '?'} turns, ${meta.duration_s ?? '?'} s, report: ${report ? 'yes' : 'no'}`);
process.exit(report && !meta.is_error ? 0 : 1);
