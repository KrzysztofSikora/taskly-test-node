#!/usr/bin/env node
// PreToolUse guard for the test-writer agent. Reads the hook event from stdin and denies:
//   - file writes outside test files (scripts/test-agent/policy.mjs: isWritable),
//   - reading local secret files (.env),
//   - any Bash command that is not on the allowlist (policy.mjs: ALLOWED_COMMANDS).
// The permission allowlist in scripts/test-agent/claude-settings.json says the same thing;
// this hook is the second, independent layer, and check-patch.mjs re-checks the result in CI.
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { isAllowedCommand, isSecretFile, isWritable } from '../../scripts/test-agent/policy.mjs';

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `test-agent guard: ${reason}`,
    },
  }));
  process.exit(0);
}

function repoPath(file) {
  return relative(root, resolve(root, file)).split('\\').join('/');
}

let event;
try {
  event = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  deny('could not parse the hook event, denying by default.');
}

const { tool_name: tool, tool_input: input = {} } = event;

if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
  const path = repoPath(input.file_path ?? input.notebook_path ?? '');
  if (!isWritable(path)) {
    deny(`${path} is not a test file. The agent may only create or change test files and test helpers; `
      + 'never production code, configs or workflows. If production code looks wrong, report it as a finding.');
  }
} else if (['Read', 'Grep', 'Glob'].includes(tool)) {
  const path = input.file_path ?? input.path ?? '';
  if (path && isSecretFile(repoPath(path))) deny('local secret files are off limits.');
} else if (tool === 'Bash') {
  if (!isAllowedCommand(input.command ?? '')) {
    deny('command not allowed. Run tests only through '
      + '`node .claude/skills/test-verification/scripts/run-tests.mjs ...`, analysis through '
      + '`node .claude/skills/pr-change-analysis/scripts/analyze-changes.mjs ...`, and read-only git '
      + '(diff, log, show, status, ls-files, grep). No pipes, redirects, chaining or substitutions.');
  }
} else if (!['Skill', 'StructuredOutput'].includes(tool)) {
  deny(`tool ${tool} is not available to the test agent.`);
}
process.exit(0);
