import type Phaser from 'phaser';
import { Capacitor } from '@capacitor/core';

export type SuspendReason = 'capacitor' | 'visibility';

export interface LifecycleHooks {
  onSuspend?: () => void;
  onResume?: (elapsedMs: number) => void;
}

interface RegisteredHook {
  id: string;
  hooks: LifecycleHooks;
}

interface AppStateListenerHandle {
  remove(): Promise<void>;
}

interface AppStatePlugin {
  addListener(
    eventName: 'appStateChange',
    listener: (state: { isActive: boolean }) => void,
  ): Promise<AppStateListenerHandle>;
}

export type CapacitorAppLoader = () => Promise<{ App: AppStatePlugin }>;

const hooks: RegisteredHook[] = [];
let suspended = false;
let suspendedAtMs = 0;
let game: Phaser.Game | null = null;
let listenersInstalled = false;
let listenerGeneration = 0;
let appStateListenerHandle: AppStateListenerHandle | null = null;
let visibilityChangeListener: (() => void) | null = null;
let pageHideListener: (() => void) | null = null;
const RESUME_DELTA_CLAMP_MS = 1_000;

const loadCapacitorApp: CapacitorAppLoader = () => import('@capacitor/app');

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

export function installGameLifecycle(
  phaserGame: Phaser.Game,
  appLoader: CapacitorAppLoader = loadCapacitorApp,
  isNativePlatform: () => boolean = () => Capacitor.isNativePlatform(),
): void {
  game = phaserGame;
  if (listenersInstalled) return;
  listenersInstalled = true;

  const generation = ++listenerGeneration;
  if (isNativePlatform()) void installAppStateListener(appLoader, generation);

  visibilityChangeListener = (): void => {
    if (document.hidden) suspendGame('visibility');
    else resumeGame('visibility');
  };
  document.addEventListener('visibilitychange', visibilityChangeListener);
  // WKWebView fires pagehide (never beforeunload) when the WebView is about to
  // be torn down; treat it as a suspend so onSuspend hooks (analytics flush)
  // get their last chance to persist before an app kill.
  pageHideListener = (): void => {
    suspendGame('visibility');
  };
  window.addEventListener('pagehide', pageHideListener);
}

async function installAppStateListener(appLoader: CapacitorAppLoader, generation: number): Promise<void> {
  try {
    const { App } = await appLoader();
    const handle = await App.addListener('appStateChange', ({ isActive }): void => {
      if (!listenersInstalled || generation !== listenerGeneration) return;
      if (isActive) resumeGame('capacitor');
      else suspendGame('capacitor');
    });

    if (!listenersInstalled || generation !== listenerGeneration) {
      removeAppStateListener(handle);
      return;
    }
    appStateListenerHandle = handle;
  } catch {
    // Browser lifecycle events remain the fallback when the native plugin is
    // unavailable or listener registration is rejected.
  }
}

function removeAppStateListener(handle: AppStateListenerHandle): void {
  try {
    void handle.remove().catch((err: unknown) => {
      console.warn('[lifecycle] failed to remove appStateChange listener', err);
    });
  } catch (err: unknown) {
    console.warn('[lifecycle] failed to remove appStateChange listener', err);
  }
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
  listenersInstalled = false;
  listenerGeneration += 1;
  if (appStateListenerHandle !== null) {
    removeAppStateListener(appStateListenerHandle);
    appStateListenerHandle = null;
  }
  if (visibilityChangeListener !== null) {
    document.removeEventListener('visibilitychange', visibilityChangeListener);
    visibilityChangeListener = null;
  }
  if (pageHideListener !== null) {
    window.removeEventListener('pagehide', pageHideListener);
    pageHideListener = null;
  }
  hooks.length = 0;
  suspended = false;
  suspendedAtMs = 0;
  game = null;
}
