import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkClaudeMirror, formatMirrorErrors } from '../src/claude-mirror.mjs';

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-mirror-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(rel, text) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

describe('checkClaudeMirror', () => {
  it('passes when settings and hooks are byte-identical', () => {
    write('agents/settings.json', '{"hooks":{}}\n');
    write('.claude/settings.json', '{"hooks":{}}\n');
    write('agents/hooks/a.sh', '#!/bin/sh\nexit 0\n');
    write('.claude/hooks/a.sh', '#!/bin/sh\nexit 0\n');
    expect(checkClaudeMirror(dir)).toEqual({ ok: true, errors: [] });
  });

  it('fails on missing mirror files, extra mirror hooks, or byte drift', () => {
    write('agents/settings.json', 'source\n');
    write('.claude/settings.json', 'drift\n');
    write('agents/hooks/a.sh', 'a\n');
    write('.claude/hooks/extra.sh', 'extra\n');
    const result = checkClaudeMirror(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/settings/);
    expect(result.errors.join('\n')).toMatch(/missing mirror: \.claude\/hooks\/a\.sh/);
    expect(result.errors.join('\n')).toMatch(/missing source: agents\/hooks\/extra\.sh/);
    expect(formatMirrorErrors(result.errors)).toMatch(/mirror integrity failed/);
  });
});
