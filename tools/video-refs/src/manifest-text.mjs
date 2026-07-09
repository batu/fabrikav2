function isTopLevelKey(line, key) {
  return new RegExp(`^${key}:\\s*(?:#.*)?$`).test(line);
}

function isAnyTopLevelKey(line) {
  return /^[A-Za-z0-9_-]+:\s*(?:.*)?$/.test(line);
}

function isBlankOrComment(line) {
  const trimmed = line.trim();
  return trimmed === '' || trimmed.startsWith('#');
}

function findTopLevel(lines, key) {
  return lines.findIndex((line) => isTopLevelKey(line, key));
}

function findSectionEnd(lines, start) {
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isAnyTopLevelKey(lines[i])) {
      end = i;
      break;
    }
  }
  while (end > start + 1 && isBlankOrComment(lines[end - 1])) end--;
  return end;
}

function insertionBeforeSection(lines, key) {
  const section = findTopLevel(lines, key);
  if (section === -1) return lines.length;
  let insert = section;
  while (insert > 0 && isBlankOrComment(lines[insert - 1])) insert--;
  return insert;
}

function yamlScalar(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (value == null) return 'null';
  const text = String(value);
  if (text === '') return '""';
  if (
    text.startsWith(' ') ||
    text.endsWith(' ') ||
    text.includes('#') ||
    text.includes(': ') ||
    ['true', 'false', 'null', '~'].includes(text)
  ) {
    return JSON.stringify(text);
  }
  return text;
}

function orderedKeys(object, preferred) {
  const keys = Object.keys(object);
  return [
    ...preferred.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !preferred.includes(key)).sort(),
  ];
}

function renderMapping(lines, indent, object, preferred = []) {
  for (const key of orderedKeys(object, preferred)) {
    const value = object[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      lines.push(`${indent}${key}:`);
      renderMapping(lines, `${indent}  `, value, [
        'source',
        'package',
        'device',
        'lane',
        'host',
        'tool',
        'captured',
        'video',
      ]);
    } else {
      lines.push(`${indent}${key}: ${yamlScalar(value)}`);
    }
  }
}

export function renderRefsBlock(refs) {
  const lines = ['refs:'];
  const entryOrder = [
    'state-variant',
    'capture-recipe',
    'at-rest',
    'not-at-rest-reason',
    'recapture-note',
    'provenance',
  ];
  for (const key of Object.keys(refs).sort()) {
    lines.push(`  ${key}:`);
    renderMapping(lines, '    ', refs[key], entryOrder);
    lines.push('');
  }
  while (lines.at(-1) === '') lines.pop();
  return lines;
}

export function replaceOrInsertRefsBlock(text, refs) {
  const lines = text.replace(/\s*$/, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const block = renderRefsBlock(refs);
  const refsStart = findTopLevel(lines, 'refs');
  if (refsStart !== -1) {
    const end = findSectionEnd(lines, refsStart);
    lines.splice(refsStart, end - refsStart, ...block);
    return `${lines.join('\n')}\n`;
  }

  const insert = insertionBeforeSection(lines, 'states');
  const spacerBefore = insert > 0 && lines[insert - 1] !== '' ? [''] : [];
  const spacerAfter = insert < lines.length && lines[insert] !== '' ? [''] : [];
  lines.splice(insert, 0, ...spacerBefore, ...block, ...spacerAfter);
  return `${lines.join('\n')}\n`;
}

function renderStateGap(state) {
  return [
    `  - name: ${state}`,
    '    reference:',
    '      gap: video-extract refs folded under refs/captures/video-extract; no primary offline reference selected yet',
    '    v2:',
    '      gap: no v2 capture selected for this video-extracted state',
  ];
}

export function appendMissingStates(text, states) {
  if (states.length === 0) return text;
  const lines = text.replace(/\s*$/, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const statesStart = findTopLevel(lines, 'states');
  const block = states.flatMap((state, index) => (index === 0 ? renderStateGap(state) : ['', ...renderStateGap(state)]));

  if (statesStart === -1) {
    const spacer = lines.length > 0 && lines.at(-1) !== '' ? [''] : [];
    lines.push(...spacer, 'states:', ...block);
    return `${lines.join('\n')}\n`;
  }

  const end = findSectionEnd(lines, statesStart);
  const insert = end;
  const spacerBefore = insert > 0 && lines[insert - 1] !== '' ? [''] : [];
  lines.splice(insert, 0, ...spacerBefore, ...block);
  return `${lines.join('\n')}\n`;
}
