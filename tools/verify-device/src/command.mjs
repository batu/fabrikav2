import { execFileSync } from 'node:child_process';

export function splitCommandPrefix(prefix, label = 'command prefix') {
  if (Array.isArray(prefix)) {
    if (!prefix.length || !prefix[0]) throw new Error(`${label} must name a command`);
    return prefix.map(String);
  }
  if (typeof prefix !== 'string' || !prefix.trim()) {
    throw new Error(`${label} must be a non-empty command string`);
  }

  const parts = [];
  let current = '';
  let quote = null;
  let escaped = false;
  const flush = () => {
    if (current !== '') {
      parts.push(current);
      current = '';
    }
  };

  for (const c of prefix.trim()) {
    if (escaped) {
      current += c;
      escaped = false;
    } else if (c === '\\' && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (c === quote) quote = null;
      else current += c;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (/\s/.test(c)) {
      flush();
    } else {
      current += c;
    }
  }
  if (escaped) current += '\\';
  if (quote) throw new Error(`${label} has an unterminated ${quote} quote`);
  flush();
  if (!parts.length) throw new Error(`${label} must name a command`);
  return parts;
}

export function formatCommandParts(parts, { redact = [] } = {}) {
  const secrets = redact.filter((v) => typeof v === 'string' && v.length > 0);
  const rendered = parts.map((arg) => {
    let s = String(arg);
    for (const secret of secrets) {
      s = s.split(secret).join('***');
    }
    return s;
  });
  return `$ ${rendered.join(' ')}`;
}

export function execCommandParts(parts, opts = {}) {
  const { redact = [], ...execOpts } = opts;
  const [file, ...args] = parts;
  if (!file) throw new Error('cannot run an empty command');
  process.stderr.write(`  ${formatCommandParts(parts, { redact })}\n`);
  return execFileSync(file, args, { stdio: ['ignore', 'pipe', 'inherit'], ...execOpts });
}
