#!/usr/bin/env node
// Fail when agents/settings.json or agents/hooks/* drift from the live .claude
// mirrors. Documentation that says a hook is active is not enough; the live
// files Claude Code reads must match.
import { checkClaudeMirror, formatMirrorErrors } from './src/claude-mirror.mjs';

try {
  const projectDir = process.env.CLAUDE_MIRROR_PROJECT_DIR || process.cwd();
  const result = checkClaudeMirror(projectDir);
  if (result.ok) {
    process.stdout.write('check-claude-mirror: PASS — agents and .claude mirrors match\n');
    process.exit(0);
  }
  process.stderr.write(formatMirrorErrors(result.errors) + '\n');
  process.exit(1);
} catch (err) {
  process.stderr.write(`check-claude-mirror: ERROR — ${err && err.message}\n`);
  process.exit(1);
}
