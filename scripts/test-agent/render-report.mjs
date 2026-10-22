#!/usr/bin/env node
// Renders the pull request comment from the agent run artifacts. Pure function of its inputs:
// no network, no git. Missing inputs are rendered as such, never invented.
//
//   node scripts/test-agent/render-report.mjs <dir> > comment.md
//
// <dir> may contain: report.json, meta.json (agent), check.json (check-patch), verify.json (verify),
// coverage-before.json ({ backend, frontend } run-tests coverage output before the agent ran),
// context.json ({ run_url, pr, head_sha, outcome }).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MARKER = '<!-- test-agent-report -->';

const dir = process.argv[2] ?? '.test-agent';
const load = (name) => {
  const file = join(dir, name);
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
};

const report = load('report.json');
const meta = load('meta.json');
const check = load('check.json');
const verify = load('verify.json');
const before = load('coverage-before.json');
const context = load('context.json') ?? {};

const esc = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const pct = (value) => (typeof value === 'number' ? `${value.toFixed(1)}%` : 'n/a');
const delta = (after, prior) => {
  if (typeof after !== 'number' || typeof prior !== 'number') return '';
  const d = after - prior;
  return Math.abs(d) < 0.05 ? ' (±0)' : ` (${d > 0 ? '+' : ''}${d.toFixed(1)})`;
};
const icon = (ok) => (ok === true ? '✅' : ok === false ? '❌' : '➖');

const lines = [MARKER, '## 🧪 Test agent report', ''];

// Headline: what happened to the patch.
const outcome = context.outcome;
const headline = {
  committed: `✅ Tests verified and committed to this branch${context.commit ? ` in ${context.commit}` : ''}.`,
  no_changes: '➖ The agent decided no test changes are needed.',
  rejected: '❌ The agent\'s patch was **not** committed: it failed the policy check or verification. The patch is attached to the workflow run for inspection.',
  push_failed: '⚠️ Tests were verified but could not be pushed (the branch moved). Re-run the workflow, or apply the patch from the run artifacts.',
  agent_failed: '❌ The agent did not finish with a report. See the transcript in the run artifacts.',
}[outcome];
if (headline) lines.push(headline, '');
if (report?.summary) lines.push(`> ${esc(report.summary)}`, '');

// Decisions per file.
if (report?.files?.length) {
  lines.push('### Decisions', '', '| File | Decision | Test file | Status | Reason |', '|------|----------|-----------|--------|--------|');
  const order = { create: 0, update: 1, blocked: 2, skip: 3, not_testable: 4 };
  for (const file of [...report.files].sort((a, b) => order[a.decision] - order[b.decision])) {
    const status = file.status === 'passed' ? '✅' : file.status === 'failed' ? `❌${file.attempts ? ` after ${file.attempts}` : ''}` : '➖';
    lines.push(`| \`${esc(file.path)}\` | ${file.decision} | ${file.test_file ? `\`${esc(file.test_file)}\`` : ''} | ${status} | ${esc(file.reason)} |`);
  }
  lines.push('');
  const covered = report.files.filter((file) => file.behaviours?.length);
  if (covered.length) {
    lines.push('<details><summary>Behaviours covered by new or updated tests</summary>', '');
    for (const file of covered) {
      lines.push(`**\`${file.test_file ?? file.path}\`**`, ...file.behaviours.map((b) => `- ${esc(b)}`), '');
    }
    lines.push('</details>', '');
  }
}

// Suspected bugs and findings.
if (report?.suspected_bugs?.length) {
  lines.push('### ⚠️ Suspected bugs in production code', '');
  for (const bug of report.suspected_bugs) {
    lines.push(`- **\`${esc(bug.file)}${bug.line ? `:${bug.line}` : ''}\`**: ${esc(bug.description)}  `, `  expected: ${esc(bug.expected)}; actual: ${esc(bug.actual)}`);
    if (bug.removed_test) lines.push('', '  <details><summary>Test kept out of the suite</summary>', '', '  ```ts', ...bug.removed_test.split('\n').map((l) => `  ${l}`), '  ```', '  </details>');
  }
  lines.push('');
}
if (report?.findings?.length) lines.push('### Findings', '', ...report.findings.map((f) => `- ${esc(f)}`), '');

// Independent verification by CI.
if (verify || check) {
  lines.push('### Verification (independent CI run, no agent involved)', '');
  if (check) {
    lines.push(`${icon(check.ok)} **Policy check:** ${check.files.length} file(s), ${check.changed_lines} changed line(s)${check.ok ? ', test files only' : ''}.`);
    for (const error of check.errors) lines.push(`  - ❌ ${esc(error)}`);
    for (const warning of check.warnings) lines.push(`  - ⚠️ ${esc(warning)}`);
    lines.push('');
  }
  if (verify) {
    lines.push('| Project | Type check | Tests | Lines | Branches | Functions |', '|---------|-----------|-------|-------|----------|-----------|');
    for (const project of ['backend', 'frontend']) {
      const v = verify[project];
      if (!v) continue;
      const total = v.coverage?.total;
      const prior = before?.[project]?.coverage?.total;
      const tests = v.tests ? `${icon(v.tests.failed === 0)} ${v.tests.passed}/${v.tests.total}` : icon(false);
      lines.push(`| ${project} | ${icon(v.typecheck?.ok)} | ${tests} | ${pct(total?.lines)}${delta(total?.lines, prior?.lines)} | ${pct(total?.branches)}${delta(total?.branches, prior?.branches)} | ${pct(total?.functions)}${delta(total?.functions, prior?.functions)} |`);
    }
    if (verify.frontend?.format) lines.push('', `${icon(verify.frontend.format.ok)} Prettier \`format:check\` (frontend)`);
    const failures = ['backend', 'frontend'].flatMap((p) => (verify[p]?.failures ?? []).map((f) => ({ ...f, project: p })));
    const thresholds = ['backend', 'frontend'].flatMap((p) => verify[p]?.threshold_errors ?? []);
    if (failures.length || thresholds.length) {
      lines.push('', '<details><summary>Failures</summary>', '');
      for (const f of failures) lines.push(`- \`${esc(f.file)}\` ${esc(f.test)}`, '', '  ```', ...String(f.message).split('\n').slice(0, 12).map((l) => `  ${l}`), '  ```');
      for (const t of thresholds) lines.push(`- ${esc(t)}`);
      lines.push('</details>');
    }
    // Per-file coverage for the files the agent targeted.
    const targeted = (report?.files ?? []).filter((f) => ['create', 'update'].includes(f.decision));
    const rows = targeted.map((f) => {
      const project = f.path.split('/')[0];
      const after = verify[project]?.coverage?.files?.[f.path];
      const prior = before?.[project]?.coverage?.files?.[f.path];
      return after ? `| \`${esc(f.path)}\` | ${pct(prior?.lines)} → ${pct(after.lines)} | ${pct(prior?.branches)} → ${pct(after.branches)} |` : null;
    }).filter(Boolean);
    if (rows.length) lines.push('', '<details><summary>Coverage of targeted files (before → after)</summary>', '', '| File | Lines | Branches |', '|------|-------|----------|', ...rows, '', '</details>');
    lines.push('');
  }
}

// How the agent worked.
if (report?.skills_used?.length) {
  lines.push('<details><summary>Skills used</summary>', '', ...report.skills_used.map((s) => `- **${esc(s.skill)}**: ${esc(s.purpose)}`), '', '</details>', '');
}
const footer = [];
if (meta) {
  const tools = Object.entries(meta.tool_calls ?? {}).map(([name, count]) => `${name} ×${count}`).join(', ');
  const denied = meta.permission_denials?.length ? `, ${meta.permission_denials.length} call(s) denied by the guard` : '';
  footer.push(`Agent \`test-writer\` (${esc(meta.model ?? 'unknown model')}): ${meta.outcome}, ${meta.turns ?? '?'} turns, ${meta.duration_s ?? '?'} s${tools ? `, tools: ${tools}` : ''}${denied}`);
}
if (context.head_sha) footer.push(`head \`${String(context.head_sha).slice(0, 7)}\``);
if (context.run_url) footer.push(`[workflow run and artifacts](${context.run_url})`);
if (footer.length) lines.push(`<sub>${footer.join(' · ')}</sub>`);

process.stdout.write(`${lines.join('\n')}\n`);
