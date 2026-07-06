import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lastAssistantText, readLastAssistantText } from '../src/transcript.mjs';

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
