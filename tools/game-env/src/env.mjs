import fs from 'node:fs';
import path from 'node:path';

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INTENTIONAL_BLANK_MARKER = 'intentional-blank';

function syntaxError(fileName, line, key = null) {
  const subject = key && ENV_KEY.test(key) ? ` for ${key}` : '';
  return new Error(`unsupported env syntax${subject} in ${fileName} at line ${line}`);
}

/**
 * Parse the dotenv subset used by Fabrika games. The parser is deliberately
 * small and fail-closed: interpolation and multiline values are unsupported.
 */
export function parseEnvText(text, { fileName = 'env file' } = {}) {
  const values = new Map();
  const assignments = [];
  let previousNonBlank = '';

  for (const [index, rawLine] of String(text).split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      previousNonBlank = trimmed;
      continue;
    }

    const withoutExport = trimmed.replace(/^export\s+/, '');
    const separator = withoutExport.indexOf('=');
    if (separator <= 0) throw syntaxError(fileName, lineNumber);

    const key = withoutExport.slice(0, separator).trim();
    if (!ENV_KEY.test(key)) throw syntaxError(fileName, lineNumber);

    let value = withoutExport.slice(separator + 1).trim();
    const openingQuote = value[0] === '"' || value[0] === "'" ? value[0] : null;
    if (openingQuote) {
      if (value.length < 2 || !value.endsWith(openingQuote)) {
        throw syntaxError(fileName, lineNumber, key);
      }
      value = value.slice(1, -1);
    } else {
      value = value.replace(/(^|\s)#.*$/, '').trim();
    }
    if (value.includes('${')) throw syntaxError(fileName, lineNumber, key);

    const assignment = {
      key,
      value,
      hasPurposeComment: previousNonBlank.startsWith('#'),
      intentionalBlank:
        previousNonBlank.startsWith('#') && previousNonBlank.includes(INTENTIONAL_BLANK_MARKER),
    };
    assignments.push(assignment);
    values.set(key, value);
    previousNonBlank = trimmed;
  }

  return { assignments, values };
}

export function readEnvFile(filePath) {
  try {
    return parseEnvText(fs.readFileSync(filePath, 'utf8'), { fileName: path.basename(filePath) });
  } catch (error) {
    if (error && error.code === 'ENOENT') return { assignments: [], values: new Map() };
    throw error;
  }
}

/** Load .env then .env.local, without replacing keys present in the launcher. */
export function loadGameEnv({ gameRoot, environment = process.env }) {
  const preset = new Set(Object.keys(environment));
  const fromFiles = new Map();
  for (const fileName of ['.env', '.env.local']) {
    for (const [key, value] of readEnvFile(path.join(gameRoot, fileName)).values) {
      fromFiles.set(key, value);
    }
  }
  for (const [key, value] of fromFiles) {
    if (!preset.has(key)) environment[key] = value;
  }
  return environment;
}
