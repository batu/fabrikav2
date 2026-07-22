import { afterEach, describe, expect, it } from 'vitest';
import { readModalGeometry } from '../../src/testing/modalGeometry';

// MRV2-11 U1 (KTD2): the device-truth probe reports the open modal chain's
// geometry so the round-5 device log can prove what made modals top-pin/crop/
// scale — and that the fix removed it. It must be present ONLY while a modal is
// open, and omitted otherwise (so the snapshot stays clean on every other state).
describe('readModalGeometry (device-truth probe)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is undefined when no modal is open', () => {
    document.body.innerHTML = '<div id="modal-root"></div>';
    expect(readModalGeometry()).toBeUndefined();
  });

  it('reports backdrop + card + mount container geometry when a modal is open', () => {
    document.body.innerHTML = `
      <div id="modal-root">
        <div class="fab-ui fab-modal-backdrop">
          <div class="fab-modal-card" role="dialog"></div>
        </div>
      </div>`;

    const geometry = readModalGeometry();
    expect(geometry).toBeDefined();
    expect(geometry!.backdrop).toBeDefined();
    expect(geometry!.card).not.toBeNull();
    // The mount container is the backdrop's parent (#modal-root).
    expect(geometry!.container).not.toBeNull();
    expect(geometry!.window.innerWidth).toBe(window.innerWidth);
    expect(geometry!.window.innerHeight).toBe(window.innerHeight);
  });
});
