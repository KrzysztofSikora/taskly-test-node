// Single source of truth for what the test agent may touch and what counts as testable source.
// Used by the PreToolUse guard (.claude/hooks/guard.mjs), the change analysis skill and the
// deterministic patch check in CI (check-patch.mjs). Paths are repo-relative, POSIX style.

export const PROJECTS = {
  backend: {
    dir: 'backend',
    // Mirrors backend/vitest.config.ts: coverage.include / coverage.exclude.
    source: /^backend\/src\/.+\.ts$/,
    skip: [
      [/\/types\.ts$/, 'type declarations only (excluded from coverage)'],
      [/^backend\/src\/generated\//, 'generated Prisma client'],
      [/^backend\/src\/main\.ts$/, 'process entry point, only calls start()'],
    ],
  },
  frontend: {
    dir: 'frontend',
    // Mirrors frontend/vite.config.ts: coverage.include / coverage.exclude.
    source: /^frontend\/src\/.+\.tsx?$/,
    skip: [
      [/\.test\.tsx?$/, 'test file'],
      [/\.stories\.tsx$/, 'Storybook story'],
      [/^frontend\/src\/design-system\//, 'design system (excluded from coverage, mocked in tests)'],
      [/^frontend\/src\/test\//, 'test support code'],
      [/^frontend\/src\/main\.tsx$/, 'browser entry point'],
      [/(\/types|\.types)\.ts$/, 'type declarations only (excluded from coverage)'],
      [/\/index\.ts$/, 're-export barrel (excluded from coverage)'],
      [/(\/constants|\.constants)\.tsx?$/, 'constants (excluded from coverage)'],
      [/\.styles\.ts$/, 'styled-components styles'],
      [/^frontend\/src\/features\/todos\/api\/queryKeys\.ts$/, 'query key constants (excluded from coverage)'],
      [/^frontend\/src\/lib\/queryClient\.ts$/, 'query client configuration (excluded from coverage)'],
    ],
  },
};

// The only files the agent may create or change.
const WRITABLE = [
  /^backend\/tests\/(.+\/)?[^/]+\.test\.ts$/,
  /^backend\/tests\/(.+\/)?(fixture|fixtures|helpers?)[^/]*\.ts$/,
  /^frontend\/src\/(.+\/)?[^/]+\.test\.tsx?$/,
  /^frontend\/src\/test\/[^/]+\.tsx?$/,
];

export function projectOf(path) {
  return Object.keys(PROJECTS).find((name) => path.startsWith(`${PROJECTS[name].dir}/`)) ?? null;
}

export function isWritable(path) {
  return !path.includes('..') && WRITABLE.some((rule) => rule.test(path));
}

export function isTestFile(path) {
  return /\.test\.tsx?$/.test(path);
}

// Returns { testable: true } or { testable: false, reason }.
export function classifySource(path) {
  const name = projectOf(path);
  const project = name && PROJECTS[name];
  if (!project || !project.source.test(path)) {
    if (isTestFile(path)) return { testable: false, reason: 'test file' };
    return { testable: false, reason: 'not application source (docs, config, schema or tooling)' };
  }
  const skip = project.skip.find(([rule]) => rule.test(path));
  return skip ? { testable: false, reason: skip[1] } : { testable: true, project: name };
}

// Bash commands the agent may run. Everything else is denied by the guard, on top of the
// permission allowlist in claude-settings.json.
export const ALLOWED_COMMANDS = [
  /^node \.claude\/skills\/[a-z-]+\/scripts\/[a-z-]+\.mjs( [^;&|`$<>]*)?$/,
  /^git (diff|log|show|status|ls-files)( [^;&|`$<>]*)?$/,
  // Tracked files only: --no-index / --untracked would reach ignored files such as .env.
  /^git grep (?!.*--(no-index|untracked))[^;&|`$<>]*$/,
  /^ls( [^;&|`$<>]*)?$/,
];

export function isAllowedCommand(command) {
  const normalized = command.trim().replace(/\s+/g, ' ');
  return !/\.env\b(?!\.example)/.test(normalized) && ALLOWED_COMMANDS.some((rule) => rule.test(normalized));
}

// Local secrets the agent never needs to read (.env.example is fine).
export function isSecretFile(path) {
  return /(^|\/)\.env(\.(?!example$)[^/]+)?$/.test(path);
}
