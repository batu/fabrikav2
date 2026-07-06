// Minimal YAML-subset parser — enough for the refcap-compare manifest, no
// dependency. Supports: nested maps by indentation, lists of maps (`- key: v`),
// scalar list items, `key: value` scalars, quoted/bare strings, booleans, ints,
// null (empty value), `#` comments and blank lines. It deliberately does NOT
// implement flow collections, anchors, multiline scalars, etc. — the manifest is
// authored to stay inside this subset, and loadManifest() validates the shape.

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d*\.\d+$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// Split "key: value" respecting quotes; returns [key, rawValueOrUndefined].
function splitKeyValue(text) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === ':' && !inSingle && !inDouble) {
      const after = text[i + 1];
      if (after === undefined || after === ' ') {
        return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
      }
    }
  }
  return [text.trim(), undefined];
}

function tokenize(src) {
  const lines = [];
  for (const rawLine of src.split('\n')) {
    // strip trailing comment (only when not inside quotes — cheap heuristic:
    // manifest never puts `#` inside a value, and quoted values are simple)
    let line = rawLine;
    const hashAt = findCommentStart(line);
    if (hashAt !== -1) line = line.slice(0, hashAt);
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    lines.push({ indent, content: line.trim() });
  }
  return lines;
}

function findCommentStart(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble && (i === 0 || line[i - 1] === ' ')) {
      return i;
    }
  }
  return -1;
}

export function parseYaml(src) {
  const lines = tokenize(src);
  let index = 0;

  function parseBlock(minIndent) {
    // Decide list vs map by first line at this indent level.
    if (index >= lines.length) return null;
    const first = lines[index];
    if (first.indent < minIndent) return null;
    const blockIndent = first.indent;
    if (first.content.startsWith('- ') || first.content === '-') {
      return parseList(blockIndent);
    }
    return parseMap(blockIndent);
  }

  function parseMap(blockIndent) {
    const obj = {};
    while (index < lines.length) {
      const line = lines[index];
      if (line.indent < blockIndent) break;
      if (line.indent > blockIndent) {
        throw new Error(`unexpected indent at: ${line.content}`);
      }
      if (line.content.startsWith('- ')) break;
      const [key, rawValue] = splitKeyValue(line.content);
      index++;
      if (rawValue === undefined || rawValue === '') {
        // nested block or null
        const child = index < lines.length && lines[index].indent > blockIndent
          ? parseBlock(blockIndent + 1)
          : null;
        obj[key] = child;
      } else {
        obj[key] = parseScalar(rawValue);
      }
    }
    return obj;
  }

  function parseList(blockIndent) {
    const arr = [];
    while (index < lines.length) {
      const line = lines[index];
      if (line.indent < blockIndent) break;
      if (line.indent > blockIndent || !line.content.startsWith('-')) break;
      const rest = line.content.slice(1).trim();
      if (rest === '') {
        // item is a nested block on following lines
        index++;
        arr.push(parseBlock(blockIndent + 1));
        continue;
      }
      // inline start of a map item: "- key: value"
      const [key, rawValue] = splitKeyValue(rest);
      if (rawValue !== undefined) {
        // Build a map whose first pair is inline; subsequent deeper lines belong to it.
        const itemIndent = blockIndent + 2; // "- " is two chars
        const obj = {};
        if (rawValue === '') {
          index++;
          obj[key] = index < lines.length && lines[index].indent > blockIndent
            ? parseBlock(blockIndent + 1)
            : null;
        } else {
          obj[key] = parseScalar(rawValue);
          index++;
        }
        // absorb remaining keys of this map item (indented past the dash)
        while (index < lines.length && lines[index].indent >= itemIndent
               && !lines[index].content.startsWith('- ')) {
          const inner = lines[index];
          const [k2, v2] = splitKeyValue(inner.content);
          index++;
          if (v2 === undefined || v2 === '') {
            obj[k2] = index < lines.length && lines[index].indent > inner.indent
              ? parseBlock(inner.indent + 1)
              : null;
          } else {
            obj[k2] = parseScalar(v2);
          }
        }
        arr.push(obj);
      } else {
        // scalar list item
        arr.push(parseScalar(rest));
        index++;
      }
    }
    return arr;
  }

  const result = parseBlock(0);
  return result === null ? {} : result;
}
