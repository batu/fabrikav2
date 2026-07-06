import { describe, it, expect } from 'vitest';
import { parseYaml } from '../src/yaml.mjs';

describe('parseYaml (manifest subset)', () => {
  it('parses scalars, booleans, null, and nested maps', () => {
    const doc = parseYaml(`
game: marble_run
reference:
  package: com.basegamelab.marblerun
  serial: null
  manual: false
`);
    expect(doc.game).toBe('marble_run');
    expect(doc.reference.package).toBe('com.basegamelab.marblerun');
    expect(doc.reference.serial).toBe(null);
    expect(doc.reference.manual).toBe(false);
  });

  it('parses a list of maps with inline and nested keys', () => {
    const doc = parseYaml(`
states:
  - name: menu
    reference:
      offline: refs/menu.png
    v2:
      offline: evidence/v2-menu.png
      driveTo: menu
  - name: win
    reference:
      manual: true
      prompt: "Drive to WIN, then ENTER"
`);
    expect(Array.isArray(doc.states)).toBe(true);
    expect(doc.states).toHaveLength(2);
    expect(doc.states[0].name).toBe('menu');
    expect(doc.states[0].reference.offline).toBe('refs/menu.png');
    expect(doc.states[0].v2.driveTo).toBe('menu');
    expect(doc.states[1].reference.manual).toBe(true);
    expect(doc.states[1].reference.prompt).toBe('Drive to WIN, then ENTER');
  });

  it('ignores comments and blank lines', () => {
    const doc = parseYaml(`
# a comment
game: x   # trailing comment

v2:
  package: y
`);
    expect(doc.game).toBe('x');
    expect(doc.v2.package).toBe('y');
  });

  it('does not treat a colon inside a URL/value as a key separator', () => {
    const doc = parseYaml(`note: "see http://x/y for details"`);
    expect(doc.note).toBe('see http://x/y for details');
  });
});
