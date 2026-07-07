import fs from 'node:fs';
import path from 'node:path';

function listFiles(dir, fsImpl) {
  let entries = [];
  try {
    entries = fsImpl.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

function read(pathname, fsImpl) {
  try {
    return fsImpl.readFileSync(pathname);
  } catch {
    return null;
  }
}

function sameBytes(a, b) {
  return a !== null && b !== null && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
}

export function checkClaudeMirror(projectDir, fsImpl = fs) {
  const pairs = [
    ['agents/settings.json', '.claude/settings.json'],
  ];
  const agentHooksDir = path.join(projectDir, 'agents', 'hooks');
  const claudeHooksDir = path.join(projectDir, '.claude', 'hooks');
  const agentHooks = listFiles(agentHooksDir, fsImpl);
  const claudeHooks = listFiles(claudeHooksDir, fsImpl);
  for (const name of new Set([...agentHooks, ...claudeHooks])) {
    pairs.push([path.join('agents/hooks', name), path.join('.claude/hooks', name)]);
  }

  const errors = [];
  for (const [sourceRel, mirrorRel] of pairs) {
    const source = read(path.join(projectDir, sourceRel), fsImpl);
    const mirror = read(path.join(projectDir, mirrorRel), fsImpl);
    if (source === null) errors.push(`missing source: ${sourceRel}`);
    if (mirror === null) errors.push(`missing mirror: ${mirrorRel}`);
    if (source !== null && mirror !== null && !sameBytes(source, mirror)) {
      errors.push(`mirror drift: ${sourceRel} != ${mirrorRel}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function formatMirrorErrors(errors) {
  return [
    'agents/.claude mirror integrity failed:',
    ...errors.map((err) => `  - ${err}`),
    'Run the agents -> .claude sync or update both copies in the same change.',
  ].join('\n');
}
