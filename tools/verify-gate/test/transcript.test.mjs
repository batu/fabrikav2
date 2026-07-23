import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lastAssistantText,
  readLastAssistantText,
  sessionEditedFiles,
  readSessionEditedFiles,
} from '../src/transcript.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'transcript-done-claim.jsonl');

describe('lastAssistantText', () => {
  it('returns the last TEXT-bearing assistant message, skipping trailing tool_use', () => {
    const text = readLastAssistantText(FIXTURE);
    expect(text).toBe('Done — the menu renders correctly on device.');
  });

  it('joins multiple text blocks in one assistant message', () => {
    const jsonl = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'line one' }, { type: 'text', text: 'line two' }] },
    });
    expect(lastAssistantText(jsonl)).toBe('line one\nline two');
  });

  it('ignores user messages and malformed lines', () => {
    const jsonl = [
      'not json at all',
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'real answer' }] } }),
    ].join('\n');
    expect(lastAssistantText(jsonl)).toBe('real answer');
  });

  it('returns empty string for a missing file (fail-open)', () => {
    expect(readLastAssistantText('/no/such/transcript.jsonl')).toBe('');
    expect(readLastAssistantText('')).toBe('');
  });

  it('fixture actually exists on disk', () => {
    expect(fs.existsSync(FIXTURE)).toBe(true);
  });
});

describe('sessionEditedFiles', () => {
  const toolUse = (name, input) => JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] },
  });

  it('collects Edit/Write/MultiEdit/NotebookEdit paths, deduped', () => {
    const jsonl = [
      toolUse('Edit', { file_path: '/repo/games/g/src/a.ts', old_string: 'x', new_string: 'y' }),
      toolUse('Write', { file_path: '/repo/docs/plan.md', content: '…' }),
      toolUse('Edit', { file_path: '/repo/games/g/src/a.ts' }),
      toolUse('NotebookEdit', { notebook_path: '/repo/nb.ipynb' }),
    ].join('\n');
    expect(sessionEditedFiles(jsonl).sort()).toEqual([
      '/repo/docs/plan.md',
      '/repo/games/g/src/a.ts',
      '/repo/nb.ipynb',
    ]);
  });

  it('ignores non-editing tools, malformed lines, and Read calls', () => {
    const jsonl = [
      'garbage',
      toolUse('Read', { file_path: '/repo/games/g/src/a.ts' }),
      toolUse('Bash', { command: 'touch games/g/src/a.ts' }),
    ].join('\n');
    expect(sessionEditedFiles(jsonl)).toEqual([]);
  });

  it('readSessionEditedFiles returns null when the transcript is unreadable', () => {
    expect(readSessionEditedFiles('/no/such/transcript.jsonl')).toBe(null);
    expect(readSessionEditedFiles('')).toBe(null);
  });

  it('readSessionEditedFiles returns [] for a transcript with no edits', () => {
    expect(readSessionEditedFiles(FIXTURE)).toEqual([]);
  });
});
