#!/usr/bin/env node
// Deterministic gate on the agent's output, run in CI without any credentials and without trusting
// the agent's own report. Inspects the staged changes (git diff --cached) and fails when the agent:
//   - touched anything that is not a test file or test helper (policy.mjs: isWritable),
//   - deleted or renamed a test file,
//   - focused or disabled tests (.only, .skip, .todo, xit, it.fails),
//   - produced an oversized patch.
// Weaker signals (snapshots, removed assertions) are reported as warnings for the PR comment.
//
//   node scripts/test-agent/check-patch.mjs            human-readable output
//   node scripts/test-agent/check-patch.mjs --json     JSON output
import { execFileSync } from 'node:child_process';
import { isTestFile, isWritable } from './policy.mjs';

const MAX_CHANGED_LINES = 4000;
const FORBIDDEN = [
  [/\b(it|test|describe)\.only\s*\(/, 'focused test (.only) would silence the rest of the suite'],
  [/\b(it|test|describe)\.(skip|todo)\s*\(|\bx(it|describe)\s*\(/, 'skipped or todo test'],
  [/\b(it|test)\.fails\s*\(/, 'it.fails hides a failing behaviour; report suspected bugs instead'],
  [/\bprocess\.env\.(CLAUDE|ANTHROPIC|GITHUB|GH_|ACTIONS)/, 'test reads CI credentials from the environment'],
];
const WARN = [
  [/toMatch(Inline)?Snapshot\s*\(/, 'snapshot assertion (prefer explicit behavioural assertions)'],
  [/setTimeout\s*\(|new Date\(\)(?!\.)/, 'real timers or current date (check the test is deterministic)'],
];

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const errors = [];
const warnings = [];

const changes = git('diff', '--cached', '--name-status', '--find-renames').split('\n').filter(Boolean).map((line) => {
  const [status, first, second] = line.split('\t');
  return { status: status[0], path: second ?? first, previous: second ? first : undefined };
});

for (const { status, path, previous } of changes) {
  if (!isWritable(path)) errors.push(`${path}: not a test file or test helper; the agent may not change it`);
  if (status === 'D' && isTestFile(path)) errors.push(`${path}: deleting tests is not allowed`);
  if (status === 'R' && previous && isTestFile(previous)) errors.push(`${previous} -> ${path}: renaming tests is not allowed`);
}

let changedLines = 0;
for (const { path, status } of changes) {
  if (status === 'D') continue;
  const diff = git('diff', '--cached', '-U0', '--', path).split('\n');
  const added = diff.filter((line) => line.startsWith('+') && !line.startsWith('+++')).map((line) => line.slice(1));
  const removed = diff.filter((line) => line.startsWith('-') && !line.startsWith('---')).map((line) => line.slice(1));
  changedLines += added.length + removed.length;
  for (const line of added) {
    for (const [rule, message] of FORBIDDEN) if (rule.test(line)) errors.push(`${path}: ${message}: \`${line.trim()}\``);
    for (const [rule, message] of WARN) if (rule.test(line)) warnings.push(`${path}: ${message}`);
  }
  const count = (lines) => lines.filter((line) => /\bexpect\s*\(/.test(line)).length;
  if (status === 'M' && count(removed) > count(added)) {
    warnings.push(`${path}: ${count(removed) - count(added)} assertion(s) removed from an existing test; check the update is intended`);
  }
}
if (changedLines > MAX_CHANGED_LINES) errors.push(`patch changes ${changedLines} lines (limit ${MAX_CHANGED_LINES})`);

const result = { ok: errors.length === 0, files: changes.map(({ status, path }) => ({ status, path })), changed_lines: changedLines, errors, warnings: [...new Set(warnings)] };
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`check-patch: ${changes.length} file(s), ${changedLines} changed line(s)`);
  for (const error of result.errors) console.log(`  ERROR   ${error}`);
  for (const warning of result.warnings) console.log(`  WARNING ${warning}`);
  console.log(result.ok ? 'check-patch: OK' : 'check-patch: FAILED');
}
process.exit(result.ok ? 0 : 1);
