/**
 * Debug bird strip (harness builds only, Batu 2026-09-17): a vertical strip on
 * the left of the play screen showing the pickup order around the current
 * bird — 3 past, the current one (arrow), 3 next. It slides down one slot
 * per pickup; an arrow marks the current bird. Drag the wheel to choose the next target (auto play starts
 * there). Tapping a bird rings it as buggy; flags persist
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
const ARROW = 28;

let root: HTMLDivElement | null = null;
let track: HTMLDivElement | null = null;
let renderedLevel = '';
let renderedIds = '';
let current: { levelId: string; bird: DebugStripBird } | null = null;
const paintSlot = new Map<string, () => void>();
let birdCount = 0;
let shownPos = 3;
let dragged = false;
let onSelect: ((pos: number) => void) | null = null;

/** The scene registers what happens when the wheel is scrolled to a bird: that bird becomes the next target. */
export function setDebugStripSelectHandler(handler: ((pos: number) => void) | null): void { onSelect = handler; }

function paintCurrent(): void {
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
    'position:fixed', 'left:6px', 'top:calc(50% + 44px)', `height:${SLOT * SLOTS}px`, `width:${SLOT + ARROW + 6}px`,
    'transform:translateY(-50%)', 'z-index:60', 'overflow:hidden', 'pointer-events:none', 'touch-action:none',
  ].join(';');
  const column = document.createElement('div');
  column.style.cssText = `position:absolute;left:0;top:0;width:${SLOT}px;height:100%;overflow:hidden;border-radius:${SLOT / 2}px;background:rgba(0,0,0,0.28);pointer-events:auto;touch-action:none`;
  // the wheel scrolls: drag up/down, snaps to a slot, and the bird under the arrow becomes the next target
  let dragStartY = 0; let dragStartPos = 0; let dragging = false;
  column.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); e.preventDefault();
    dragging = true; dragged = false; dragStartY = e.clientY; dragStartPos = shownPos;
    column.setPointerCapture(e.pointerId);
    if (track) track.style.transition = 'none';
  });
  column.addEventListener('pointermove', (e) => {
    if (!dragging || !track) return;
    const dy = e.clientY - dragStartY;
    if (Math.abs(dy) > 8) dragged = true;
    if (dragged) track.style.transform = `translateY(${(3 - dragStartPos) * SLOT + dy}px)`;
  });
  const endDrag = (e: PointerEvent): void => {
    if (!dragging || !track) return;
    dragging = false;
    track.style.transition = 'transform 350ms cubic-bezier(.2,.8,.2,1)';
    if (!dragged) return;
    const dy = e.clientY - dragStartY;
    const pos = Math.max(0, Math.min(Math.max(0, birdCount - 1), Math.round(dragStartPos - dy / SLOT)));
    shownPos = pos;
    track.style.transform = `translateY(${(3 - pos) * SLOT}px)`;
    onSelect?.(pos);
  };
  column.addEventListener('pointerup', endDrag);
  column.addEventListener('pointercancel', endDrag);
  track = document.createElement('div');
  track.style.cssText = 'position:absolute;left:0;top:0;width:100%;transition:transform 350ms cubic-bezier(.2,.8,.2,1);will-change:transform';
  column.appendChild(track);
  root.appendChild(column);
  // a little arrow pointing at the current slot
  const arrow = document.createElement('div');
  arrow.textContent = '◀';
  arrow.style.cssText = [
    'position:absolute', `left:${SLOT + 4}px`, `top:${SLOT * 3}px`, `width:${ARROW}px`, `height:${SLOT}px`, 'display:flex', 'align-items:center',
    'color:#ff2d55', 'font:900 26px/1 system-ui,sans-serif', 'text-shadow:0 0 3px #fff,0 0 6px #fff', 'pointer-events:none',
  ].join(';');
  root.appendChild(arrow);
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
    const flagged = isFlagged(levelId, bird.id);
    canvas.style.border = flagged ? '5px solid #ff2d55' : '5px solid transparent';
    canvas.style.boxShadow = flagged ? '0 0 0 2px #fff inset' : 'none';
    canvas.style.opacity = bird.found ? '0.85' : '1';
  };
  paint();
  paintSlot.set(bird.id, paint);
  // tapping a bird marks it as buggy (tap again to clear)
  canvas.addEventListener('pointerup', (e) => {
    if (dragged) return;   // the column handled a scroll, not a tap
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
    paintSlot.clear();
    track.replaceChildren(...birds.map((b) => thumbFor(b, levelId)));
    if (renderedLevel !== levelId) { track.style.transition = 'none'; void track.offsetHeight; }
    renderedLevel = levelId; renderedIds = ids;
  }
  // put the current bird into the middle slot (index 3)
  birdCount = birds.length; shownPos = currentPos;
  track.style.transform = `translateY(${(3 - currentPos) * SLOT}px)`;
  current = currentPos < birds.length ? { levelId, bird: birds[currentPos] } : null;
  paintCurrent();
  if (track.style.transition === 'none') { void track.offsetHeight; track.style.transition = 'transform 350ms cubic-bezier(.2,.8,.2,1)'; }
}

export function destroyDebugBirdStrip(): void {
  root?.remove(); root = null; track = null; current = null; paintSlot.clear(); renderedLevel = ''; renderedIds = '';
}
