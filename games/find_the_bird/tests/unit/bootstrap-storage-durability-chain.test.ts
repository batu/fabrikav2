import { afterEach, describe, expect, it, vi } from 'vitest';

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
const originalLocksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');

function installRuntimeShellMocks(): void {
  const game = { events: { once: vi.fn() } };
  const Game = vi.fn(function MockPhaserGame() {
    return game;
  });
  vi.doMock('phaser', () => ({ default: { Game } }));
  vi.doMock('@fabrikav2/testkit/testing', () => ({
    assignWindowBindings: vi.fn(() => vi.fn()),
    maybeRunInsituTour: vi.fn(() => Promise.resolve()),
  }));
  vi.doMock('../../src/core/GameConfig', () => ({ GameConfig: {} }));
  vi.doMock('../../src/ui/HUD', () => ({ initHUD: vi.fn() }));
  vi.doMock('../../src/platform/portraitOrientation', () => ({ installPortraitOrientationLock: vi.fn() }));
  vi.doMock('../../src/platform/gameLifecycle', () => ({
    installGameLifecycle: vi.fn(),
    registerLifecycleHooks: vi.fn(() => vi.fn()),
  }));
  vi.doMock('../../src/notifications/NotificationService', () => ({
    notificationService: {
      install: vi.fn(),
      maybePromptOnLaunch: vi.fn(() => Promise.resolve()),
    },
  }));
  vi.doMock('../../src/audio/AudioManager', () => ({
    installAudioUnlock: vi.fn(),
    installButtonVoiceEffects: vi.fn(),
    setMusicPausedForAd: vi.fn(),
  }));
  vi.doMock('../../src/ui/iconPreload', () => ({ preloadIcons: vi.fn() }));
}

async function launchWithDeniedStorage(): Promise<boolean | undefined> {
  vi.resetModules();
  installRuntimeShellMocks();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get: () => {
      throw new DOMException('denied', 'SecurityError');
    },
  });
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async (_name: string, callback: () => boolean | Promise<boolean>) => callback(),
    },
  });

  await import('../../src/bootstrap');
  const { getSdkContext } = await import('../../src/sdk/SdkContext');
  const context = getSdkContext();
  await vi.waitFor(() => {
    expect(context.analyticsRing.snapshot().some(({ name }) => name === 'app_open')).toBe(true);
  });
  return context.analyticsRing
    .snapshot()
    .find(({ name }) => name === 'session_start')
    ?.params.first_open as boolean | undefined;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  if (originalLocalStorageDescriptor === undefined) Reflect.deleteProperty(window, 'localStorage');
  else Object.defineProperty(window, 'localStorage', originalLocalStorageDescriptor);
  if (originalLocksDescriptor === undefined) Reflect.deleteProperty(navigator, 'locks');
  else Object.defineProperty(navigator, 'locks', originalLocksDescriptor);
});

describe('production bootstrap storage durability chain', () => {
  it('fails first_open closed on every launch backed only by the in-memory fallback', async () => {
    await expect(launchWithDeniedStorage()).resolves.toBe(false);
    await expect(launchWithDeniedStorage()).resolves.toBe(false);
  });
});
