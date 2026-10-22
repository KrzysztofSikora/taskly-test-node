#!/usr/bin/env node
// Lists the source files a change touches and, for each, whether it is unit-testable, which test
// file covers it and which lines changed. Output: JSON on stdout.
//
//   node analyze-changes.mjs --base <ref>   files changed in <ref>...HEAD (pull request mode)
//   node analyze-changes.mjs --all          every tracked source file (backfill mode)
//
// Coverage is attached when <project>/coverage/coverage-summary.json exists.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const { PROJECTS, classifySource, projectOf, isTestFile } = await import(join(root, 'scripts/test-agent/policy.mjs'));

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function parseArgs(argv) {
  const args = { mode: null, base: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--all') args.mode = 'all';
    else if (argv[i] === '--base') { args.mode = 'pr'; args.base = argv[++i]; }
  }
  if (!args.mode || (args.mode === 'pr' && !args.base)) {
    console.error('usage: analyze-changes.mjs --base <ref> | --all');
    process.exit(2);
  }
  if (args.base && !/^[\w./-]+$/.test(args.base)) {
    console.error(`invalid base ref: ${args.base}`);
    process.exit(2);
  }
  return args;
}

// [{ status: 'A'|'M'|'D'|'R', path, previous? }]
function changedFiles(base) {
  return git('diff', '--name-status', '--find-renames', `${base}...HEAD`)
    .split('\n').filter(Boolean).map((line) => {
      const [status, first, second] = line.split('\t');
      return status.startsWith('R')
        ? { status: 'R', path: second, previous: first }
        : { status: status[0], path: first };
    });
}

// Changed line ranges in the new version of the file, e.g. ["12-18", "40"].
function changedLines(base, path) {
  const ranges = [];
  for (const match of git('diff', '-U0', `${base}...HEAD`, '--', path).matchAll(/^@@ [^+]*\+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count > 0) ranges.push(count === 1 ? `${start}` : `${start}-${start + count - 1}`);
  }
  return ranges;
}

const trackedFiles = git('ls-files').split('\n').filter(Boolean);
const testFiles = trackedFiles.filter((file) => isTestFile(file) && existsSync(join(root, file)));

// Tests that reference the source module by relative specifier (any extension), split into
// tests that exercise it and tests that replace it with vi.mock (those break when its interface changes).
function testsReferencing(source) {
  const project = projectOf(source);
  const stem = source.replace(/\.tsx?$/, '');
  const resolves = (test, specifier) => join(dirname(test), specifier).replace(/\.(js|ts|tsx)$/, '') === stem;
  const related = [];
  const mockedIn = [];
  for (const test of testFiles) {
    if (projectOf(test) !== project) continue;
    const text = readFileSync(join(root, test), 'utf8');
    const mocked = [...text.matchAll(/vi\.mock\(\s*['"](\.{1,2}\/[^'"]+)['"]/g)].some((m) => resolves(test, m[1]));
    const imported = [...text.matchAll(/(?:from|import\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)].some((m) => resolves(test, m[1]));
    if (mocked) mockedIn.push(test);
    else if (imported) related.push(test);
  }
  return { related, mockedIn };
}

// The test file that owns the source, following each project's convention:
// frontend tests sit next to the source; backend tests live in the flat backend/tests folder,
// with the source's parent directory as a subfolder when the flat name is taken by another module.
function conventionalTests(source, project) {
  if (project === 'frontend') {
    const stem = source.replace(/\.tsx?$/, '');
    return [`${stem}.test.tsx`, `${stem}.test.ts`].sort((a) => (a.endsWith(source.endsWith('.tsx') ? '.tsx' : '.ts') ? -1 : 1));
  }
  const name = basename(source).replace(/\.ts$/, '.test.ts');
  return [`backend/tests/${name}`, `backend/tests/${basename(dirname(source))}/${name}`];
}

function ownTest(source, project, related) {
  const [flat, nested] = conventionalTests(source, project);
  if (project === 'frontend') return [flat, nested].find((file) => existsSync(join(root, file))) ?? null;
  if (existsSync(join(root, nested))) return nested;
  // A flat backend test belongs to this source only if it actually imports it.
  return related.includes(flat) ? flat : null;
}

function proposedTest(source, project) {
  const [flat, nested] = conventionalTests(source, project);
  return project === 'backend' && existsSync(join(root, flat)) ? nested : flat;
}

function loadCoverage(project) {
  const file = join(root, PROJECTS[project].dir, 'coverage/coverage-summary.json');
  if (!existsSync(file)) return null;
  const summary = JSON.parse(readFileSync(file, 'utf8'));
  return Object.fromEntries(Object.entries(summary).filter(([key]) => key !== 'total').map(([key, value]) => [
    relative(root, key).split('\\').join('/'),
    { lines: value.lines.pct, branches: value.branches.pct, functions: value.functions.pct },
  ]));
}

const args = parseArgs(process.argv.slice(2));
const coverage = { backend: loadCoverage('backend'), frontend: loadCoverage('frontend') };
const entries = args.mode === 'all'
  ? trackedFiles.map((path) => ({ status: 'tracked', path }))
  : changedFiles(args.base);

const files = [];
for (const entry of entries) {
  const result = { path: entry.path, status: entry.status };
  if (entry.previous) result.previous = entry.previous;
  if (entry.status === 'D') {
    const orphans = testFiles.filter((test) => readFileSync(join(root, test), 'utf8').includes(basename(entry.path).replace(/\.tsx?$/, '')));
    files.push({ ...result, testable: false, reason: 'deleted', possibly_orphaned_tests: orphans });
    continue;
  }
  const classification = classifySource(entry.path);
  if (!classification.testable) {
    // Report skipped files in PR mode only; in backfill mode they are noise.
    if (args.mode === 'pr') files.push({ ...result, testable: false, reason: classification.reason });
    continue;
  }
  const project = classification.project;
  const { related, mockedIn } = testsReferencing(entry.path);
  const own = ownTest(entry.path, project, related);
  files.push({
    ...result,
    testable: true,
    project,
    own_test: own,
    related_tests: related.filter((test) => test !== own),
    mocked_in: mockedIn,
    target_test: own ?? proposedTest(entry.path, project),
    changed_lines: args.mode === 'pr' ? changedLines(args.base, entry.path) : undefined,
    coverage: coverage[project]?.[entry.path] ?? null,
  });
}

const testable = files.filter((file) => file.testable);
console.log(JSON.stringify({
  mode: args.mode,
  base: args.base,
  head: git('rev-parse', '--short', 'HEAD').trim(),
  summary: {
    changed: args.mode === 'pr' ? entries.length : undefined,
    testable: testable.length,
    backend: testable.filter((file) => file.project === 'backend').length,
    frontend: testable.filter((file) => file.project === 'frontend').length,
    tests_changed_by_author: args.mode === 'pr' ? entries.filter((entry) => isTestFile(entry.path)).map((entry) => entry.path) : undefined,
    coverage_available: { backend: !!coverage.backend, frontend: !!coverage.frontend },
  },
  files,
}, null, 2));
