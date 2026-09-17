/**
 * Debug bird strip (harness builds only, Batu 2026-09-17): a vertical strip on
 * the left of the play screen showing the pickup order around the current
 * bird — 3 past, the current one in a ring, 3 next. It slides down one slot
 * per pickup. Tapping a sprite flags that bird as problematic; flags persist
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
const SLOT = 60;
const SLOTS = 7;
const THUMB = 48;

let root: HTMLDivElement | null = null;
let track: HTMLDivElement | null = null;
let renderedLevel = '';
let renderedIds = '';

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
    'position:fixed', 'left:6px', 'top:50%', `height:${SLOT * SLOTS}px`, `width:${SLOT}px`,
    'transform:translateY(-50%)', 'z-index:60', 'overflow:hidden', 'pointer-events:auto',
    'border-radius:30px', 'background:rgba(0,0,0,0.28)', 'touch-action:none',
  ].join(';');
  const ring = document.createElement('div');
  ring.style.cssText = [
    'position:absolute', 'left:2px', `top:${SLOT * 3 + 2}px`, `width:${SLOT - 4}px`, `height:${SLOT - 4}px`,
    'border:3px solid #ff2d55', 'box-shadow:0 0 0 2px #fff inset', 'border-radius:50%', 'pointer-events:none', 'box-sizing:border-box',
  ].join(';');
  track = document.createElement('div');
  track.style.cssText = 'position:absolute;left:0;top:0;width:100%;transition:transform 350ms cubic-bezier(.2,.8,.2,1);will-change:transform';
  root.appendChild(track);
  root.appendChild(ring);
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
    const s = Math.min((THUMB - 6) / w, (THUMB - 6) / h);
    ctx.drawImage(bird.image, (THUMB - w * s) / 2, (THUMB - h * s) / 2, w * s, h * s);
  }
  const paint = (): void => {
    canvas.style.border = isFlagged(levelId, bird.id) ? '3px solid #ff2d55' : '3px solid transparent';
    canvas.style.opacity = bird.found ? '0.45' : '1';
  };
  paint();
  canvas.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
  canvas.addEventListener('pointerup', (e) => {
    e.stopPropagation(); e.preventDefault();
    toggleFlag(levelId, bird.id, bird.index);
    paint();
    window.dispatchEvent(new CustomEvent('ftb-debug-bird-flag', { detail: { levelId, dogId: bird.id, index: bird.index, flagged: isFlagged(levelId, bird.id) } }));
  });
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
    track.replaceChildren(...birds.map((b) => thumbFor(b, levelId)));
    if (renderedLevel !== levelId) { track.style.transition = 'none'; void track.offsetHeight; }
    renderedLevel = levelId; renderedIds = ids;
  }
  // put the current bird into the middle slot (index 3)
  track.style.transform = `translateY(${(3 - currentPos) * SLOT}px)`;
  if (track.style.transition === 'none') { void track.offsetHeight; track.style.transition = 'transform 350ms cubic-bezier(.2,.8,.2,1)'; }
}

export function destroyDebugBirdStrip(): void {
  root?.remove(); root = null; track = null; renderedLevel = ''; renderedIds = '';
}
