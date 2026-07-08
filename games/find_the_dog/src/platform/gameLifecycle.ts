import type Phaser from 'phaser';

export type SuspendReason = 'capacitor' | 'visibility';

export interface LifecycleHooks {
  onSuspend?: () => void;
  onResume?: (elapsedMs: number) => void;
}

interface RegisteredHook {
  id: string;
  hooks: LifecycleHooks;
}

const hooks: RegisteredHook[] = [];
let suspended = false;
let suspendedAtMs = 0;
let game: Phaser.Game | null = null;
let listenersInstalled = false;
const RESUME_DELTA_CLAMP_MS = 1_000;

export function registerLifecycleHooks(id: string, hooksForId: LifecycleHooks): () => void {
  const existingIndex = hooks.findIndex((entry) => entry.id === id);
  const entry: RegisteredHook = { id, hooks: hooksForId };
  if (existingIndex >= 0) hooks[existingIndex] = entry;
  else hooks.push(entry);
  return (): void => {
    const idx = hooks.findIndex((candidate) => candidate.id === id);
    if (idx >= 0) hooks.splice(idx, 1);
  };
}

export function isGameSuspended(): boolean {
  return suspended;
}

export function installGameLifecycle(phaserGame: Phaser.Game): void {
  game = phaserGame;
  if (listenersInstalled) return;
  listenersInstalled = true;
  document.addEventListener('visibilitychange', (): void => {
    if (document.hidden) suspendGame('visibility');
    else resumeGame('visibility');
  });
}

export function suspendGame(_reason: SuspendReason): void {
  if (suspended) return;
  suspended = true;
  suspendedAtMs = Date.now();
  game?.loop.sleep();
  for (const entry of hooks) {
    try {
      entry.hooks.onSuspend?.();
    } catch (err: unknown) {
      console.warn(`[lifecycle] onSuspend hook "${entry.id}" threw`, err);
    }
  }
}

export function resumeGame(_reason: SuspendReason): void {
  if (!suspended) return;
  const elapsedMs = Date.now() - suspendedAtMs;
  suspended = false;
  game?.loop.resetDelta();
  game?.loop.wake();
  game?.loop.resetDelta();
  const reportedMs = Math.min(elapsedMs, RESUME_DELTA_CLAMP_MS);
  for (const entry of hooks) {
    try {
      entry.hooks.onResume?.(reportedMs);
    } catch (err: unknown) {
      console.warn(`[lifecycle] onResume hook "${entry.id}" threw`, err);
    }
  }
}

export function setLifecycleForTest(state: 'active' | 'inactive'): void {
  if (state === 'inactive') suspendGame('visibility');
  else resumeGame('visibility');
}

export function resetGameLifecycleForTest(): void {
  hooks.length = 0;
  suspended = false;
  suspendedAtMs = 0;
  game = null;
  listenersInstalled = false;
}
