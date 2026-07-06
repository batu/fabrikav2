// Read the LAST assistant message text from a Claude Code transcript (JSONL).
// The transcript is one JSON object per line; assistant turns look like
// {"type":"assistant","message":{"role":"assistant","content":[{"type":"text",...}]}}.
// We want the final message that actually carries text (the claim), skipping
// trailing tool_use-only entries.
import fs from 'node:fs';

/** Pure: extract the last text-bearing assistant message from raw JSONL. */
export function lastAssistantText(jsonlText) {
  const lines = String(jsonlText || '').split('\n');
  let last = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let o;
    try {
      o = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (o && o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
      const text = o.message.content
        .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('\n');
      if (text.trim()) last = text;
    }
  }
  return last;
}

/** IO wrapper: read the transcript file and return its last assistant text.
 *  Returns '' on any read/parse failure (fail-open — a missing transcript must
 *  never wedge the turn). */
export function readLastAssistantText(transcriptPath, fsImpl = fs) {
  if (!transcriptPath) return '';
  try {
    return lastAssistantText(fsImpl.readFileSync(transcriptPath, 'utf8'));
  } catch {
    return '';
  }
}
