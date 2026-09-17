/**
 * Debug bird strip (harness builds only, Batu 2026-09-17): a vertical strip on
 * the left of the play screen showing the pickup order around the current
 * bird — 3 past, the current one in a ring, 3 next. It slides down one slot
 * per pickup. The red button beside the ring flags the current bird as buggy; flags persist
 * in localStorage under FLAGS_KEY so they can be read back from the device.
 */
import { TEST_HARNESS_ENABLED } from '../core/Constants';

export interface DebugStripBird {
  readonly id: string;
  /** index in the level's dog list */
  readonly index: number;
  readonly image: CanvasImageSource | null;
  readonly found: boolean;
}

export interface DebugBirdFlag {
  levelId: string;
  dogId: string;
  index: number;
  at: string;
}

export const FLAGS_KEY = 'ftb-debug-bird-flags';
const SLOT = 100;
const SLOTS = 7;
const THUMB = 86;
const BUTTON = 76;

let root: HTMLDivElement | null = null;
let track: HTMLDivElement | null = null;
let renderedLevel = '';
let renderedIds = '';
let buggy: HTMLButtonElement | null = null;
let current: { levelId: string; bird: DebugStripBird } | null = null;
const paintSlot = new Map<string, () => void>();

function paintCurrent(): void {
  if (!buggy) return;
  const flagged = current !== null && isFlagged(current.levelId, current.bird.id);
  buggy.style.background = flagged ? '#fff' : '#ff2d55';
  buggy.style.color = flagged ? '#ff2d55' : '#fff';
  buggy.style.borderColor = flagged ? '#ff2d55' : '#fff';
  buggy.textContent = flagged ? '✓' : '!';
  buggy.style.opacity = current ? '1' : '0.35';
  if (current) paintSlot.get(current.bird.id)?.();
}

export function readDebugBirdFlags(): DebugBirdFlag[] {
  try {
    const raw = window.localStorage.getItem(FLAGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as DebugBirdFlag[]) : [];
  } catch { return []; }
}

function writeDebugBirdFlags(flags: DebugBirdFlag[]): void {
  try { window.localStorage.setItem(FLAGS_KEY, JSON.stringify(flags)); } catch { /* storage unavailable */ }
}

function isFlagged(levelId: string, dogId: string): boolean {
  return readDebugBirdFlags().some((f) => f.levelId === levelId && f.dogId === dogId);
}

function toggleFlag(levelId: string, dogId: string, index: number): boolean {
  const flags = readDebugBirdFlags();
  const at = flags.findIndex((f) => f.levelId === levelId && f.dogId === dogId);
  if (at >= 0) { flags.splice(at, 1); writeDebugBirdFlags(flags); return false; }
  flags.push({ levelId, dogId, index, at: new Date().toISOString() });
  writeDebugBirdFlags(flags);
  return true;
}

function ensureRoot(): HTMLDivElement {
  if (root && root.isConnected) return root;
  root = document.createElement('div');
  root.id = 'debug-bird-strip';
  root.style.cssText = [
    'position:fixed', 'left:6px', 'top:50%', `height:${SLOT * SLOTS}px`, `width:${SLOT + BUTTON + 12}px`,
    'transform:translateY(-50%)', 'z-index:60', 'overflow:hidden', 'pointer-events:none', 'touch-action:none',
  ].join(';');
  const column = document.createElement('div');
  column.style.cssText = `position:absolute;left:0;top:0;width:${SLOT}px;height:100%;overflow:hidden;border-radius:${SLOT / 2}px;background:rgba(0,0,0,0.28);pointer-events:auto`;
  const ring = document.createElement('div');
  ring.style.cssText = [
    'position:absolute', 'left:2px', `top:${SLOT * 3 + 2}px`, `width:${SLOT - 4}px`, `height:${SLOT - 4}px`,
    'border:3px solid #ff2d55', 'box-shadow:0 0 0 2px #fff inset', 'border-radius:50%', 'pointer-events:none', 'box-sizing:border-box',
  ].join(';');
  track = document.createElement('div');
  track.style.cssText = 'position:absolute;left:0;top:0;width:100%;transition:transform 350ms cubic-bezier(.2,.8,.2,1);will-change:transform';
  column.appendChild(track);
  column.appendChild(ring);
  root.appendChild(column);
  // "this one is buggy": a separate button beside the ring that flags the CURRENT bird
  buggy = document.createElement('button');
  buggy.id = 'debug-bird-buggy';
  buggy.type = 'button';
  buggy.textContent = '!';
  buggy.style.cssText = [
    'position:absolute', `left:${SLOT + 12}px`, `top:${SLOT * 3 + (SLOT - BUTTON) / 2}px`, `width:${BUTTON}px`, `height:${BUTTON}px`,
    'border-radius:50%', 'border:4px solid #fff', 'background:#ff2d55', 'color:#fff', 'font:900 44px/1 system-ui,sans-serif',
    'pointer-events:auto', 'touch-action:none', 'box-shadow:0 4px 12px rgba(0,0,0,0.4)',
  ].join(';');
  buggy.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
  buggy.addEventListener('pointerup', (e) => {
    e.stopPropagation(); e.preventDefault();
    if (!current) return;
    toggleFlag(current.levelId, current.bird.id, current.bird.index);
    paintCurrent();
    window.dispatchEvent(new CustomEvent('ftb-debug-bird-flag', { detail: { levelId: current.levelId, dogId: current.bird.id, index: current.bird.index, flagged: isFlagged(current.levelId, current.bird.id) } }));
  });
  root.appendChild(buggy);
  document.body.appendChild(root);
  return root;
}

function thumbFor(bird: DebugStripBird, levelId: string): HTMLDivElement {
  const slot = document.createElement('div');
  slot.className = 'debug-bird-slot';
  slot.dataset.dogId = bird.id;
  slot.style.cssText = `height:${SLOT}px;width:${SLOT}px;display:flex;align-items:center;justify-content:center;box-sizing:border-box`;
  const canvas = document.createElement('canvas');
  canvas.width = THUMB; canvas.height = THUMB;
  canvas.style.cssText = 'border-radius:50%;background:rgba(255,255,255,0.85);box-sizing:border-box';
  const ctx = canvas.getContext('2d');
  if (ctx && bird.image) {
    const src = bird.image as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; videoWidth?: number };
    const w = src.naturalWidth ?? src.width ?? THUMB;
    const h = src.naturalHeight ?? src.height ?? THUMB;
    // fit the sprite's bounding box inside the inscribed circle: the box diagonal must not exceed the diameter
    const inner = THUMB - 8;
    const s = inner / Math.hypot(w, h);
    ctx.drawImage(bird.image, (THUMB - w * s) / 2, (THUMB - h * s) / 2, w * s, h * s);
  }
  const paint = (): void => {
    canvas.style.border = isFlagged(levelId, bird.id) ? '3px solid #ff2d55' : '3px solid transparent';
    canvas.style.opacity = bird.found ? '0.45' : '1';
  };
  paint();
  paintSlot.set(bird.id, paint);
  canvas.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
  slot.appendChild(canvas);
  return slot;
}

/**
 * Render or update the strip. `birds` is the full pickup order; `currentPos`
 * is the position (in that order) of the bird about to be picked up, or
 * birds.length when every bird is found.
 */
export function updateDebugBirdStrip(levelId: string, birds: readonly DebugStripBird[], currentPos: number): void {
  if (!TEST_HARNESS_ENABLED) return;
  ensureRoot();
  if (!track) return;
  const ids = birds.map((b) => `${b.id}:${b.found ? 1 : 0}`).join(',');
  if (renderedLevel !== levelId || renderedIds !== ids) {
    paintSlot.clear();
    track.replaceChildren(...birds.map((b) => thumbFor(b, levelId)));
    if (renderedLevel !== levelId) { track.style.transition = 'none'; void track.offsetHeight; }
    renderedLevel = levelId; renderedIds = ids;
  }
  // put the current bird into the middle slot (index 3)
  track.style.transform = `translateY(${(3 - currentPos) * SLOT}px)`;
  current = currentPos < birds.length ? { levelId, bird: birds[currentPos] } : null;
  paintCurrent();
  if (track.style.transition === 'none') { void track.offsetHeight; track.style.transition = 'transform 350ms cubic-bezier(.2,.8,.2,1)'; }
}

export function destroyDebugBirdStrip(): void {
  root?.remove(); root = null; track = null; buggy = null; current = null; paintSlot.clear(); renderedLevel = ''; renderedIds = '';
}
