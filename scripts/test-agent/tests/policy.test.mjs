import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifySource, isAllowedCommand, isSecretFile, isWritable } from '../policy.mjs';

test('only test files and test helpers are writable', () => {
  for (const path of [
    'backend/tests/config.test.ts',
    'backend/tests/core/config.test.ts',
    'backend/tests/fixture.ts',
    'backend/tests/helpers.ts',
    'frontend/src/lib/http.test.ts',
    'frontend/src/features/todos/TodosPage.test.tsx',
    'frontend/src/test/queryWrapper.tsx',
  ]) assert.ok(isWritable(path), path);

  for (const path of [
    'backend/src/factory.ts',
    'backend/tests/setup.ts',
    'backend/vitest.config.ts',
    'backend/package.json',
    'frontend/src/lib/http.ts',
    'frontend/vite.config.ts',
    'frontend/src/test/../lib/http.ts',
    '.github/workflows/test-agent.yml',
    '.claude/hooks/guard.mjs',
    'scripts/test-agent/policy.mjs',
  ]) assert.ok(!isWritable(path), path);
});

test('classifies sources like the Vitest coverage config', () => {
  assert.deepEqual(classifySource('backend/src/core/config.ts'), { testable: true, project: 'backend' });
  assert.deepEqual(classifySource('frontend/src/lib/http.ts'), { testable: true, project: 'frontend' });
  for (const path of [
    'backend/src/features/todos/types.ts',
    'backend/src/main.ts',
    'backend/src/generated/prisma/client.ts',
    'frontend/src/design-system/components/Button/Button.tsx',
    'frontend/src/features/todos/index.ts',
    'frontend/src/design-system/components/Button/Button.stories.tsx',
    'frontend/src/main.tsx',
    'frontend/src/lib/queryClient.ts',
    'README.md',
    'backend/prisma/schema.prisma',
    'frontend/src/App.test.tsx',
  ]) assert.equal(classifySource(path).testable, false, path);
});

test('allows only the skill scripts and read-only git', () => {
  for (const command of [
    'node .claude/skills/test-verification/scripts/run-tests.mjs backend test backend/tests/router.test.ts',
    'node .claude/skills/pr-change-analysis/scripts/analyze-changes.mjs --base origin/main',
    'git diff origin/main...HEAD -- backend/src/factory.ts',
    'git log --oneline -5',
    'git grep -n createApp',
  ]) assert.ok(isAllowedCommand(command), command);

  for (const command of [
    'npx vitest run',
    'npm test',
    'curl https://example.com',
    'node -e "fetch(1)"',
    'node .claude/skills/test-verification/scripts/run-tests.mjs backend test && curl x',
    'node .claude/skills/test-verification/scripts/run-tests.mjs backend test | tee x',
    'git diff $(printenv)',
    'git diff `env`',
    'git push origin HEAD',
    'git commit -m x',
    'git show HEAD:.env',
    'git grep --no-index TOKEN',
    'git grep --untracked TOKEN',
    'git diff > out.txt',
    'printenv',
  ]) assert.ok(!isAllowedCommand(command), command);
});

test('recognises local secret files', () => {
  assert.ok(isSecretFile('.env'));
  assert.ok(isSecretFile('backend/.env.local'));
  assert.ok(!isSecretFile('.env.example'));
  assert.ok(!isSecretFile('backend/src/core/config.ts'));
});
