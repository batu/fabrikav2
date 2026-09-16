import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountRatePrompt } from '../../src/v1core/ui';
import { showRatePromptWithHandle } from '../../src/ui/RatePrompt';

const marks = vi.hoisted(() => ({ accepted: vi.fn(), declined: vi.fn(), tap: vi.fn() }));
vi.mock('../../src/core/GameState', () => ({ gameState: {
  markRatePromptShown: marks.accepted,
  markRateDeclined: marks.declined,
} }));
vi.mock('../../src/audio/AudioManager', () => ({ playUITap: marks.tap }));
vi.mock('../../src/platform/StoreMetadata', () => ({ getStoreMetadata: () => ({
  storeUrl: 'https://apps.apple.com/app/id6796698146',
}) }));

describe('Find the Bird rating prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="hud-overlay"></div>';
  });
  afterEach(() => {
    document.getElementById('rate-prompt-overlay')?.remove();
    vi.restoreAllMocks();
  });

  it('shows the mascot and a neutral rating request without duplicating the modal', async () => {
    const first = showRatePromptWithHandle();
    const second = showRatePromptWithHandle();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    const image = document.querySelector<HTMLImageElement>('.fab-rate-illustration');
    expect(image?.getAttribute('src')).toBe('ui/rating/bird-please.png');
    expect(document.querySelector('[data-fab-action="accept"]')?.textContent).toBe('Rate the game');
    expect(document.querySelector('[data-fab-action="decline"]')?.textContent).toBe('No thanks');
    expect(marks.accepted).not.toHaveBeenCalled();
    expect(marks.declined).not.toHaveBeenCalled();
    first.dismiss();
    await second.dismissed;
  });

  it('declines without opening the store and resolves the next-level continuation', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const handle = showRatePromptWithHandle();
    document.querySelector<HTMLButtonElement>('[data-fab-action="decline"]')!.click();
    await handle.dismissed;
    expect(marks.declined).toHaveBeenCalledOnce();
    expect(marks.accepted).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens the configured store on acceptance and closes even if navigation fails', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => { throw new Error('unavailable'); });
    const handle = showRatePromptWithHandle();
    document.querySelector<HTMLButtonElement>('[data-fab-action="accept"]')!.click();
    await handle.dismissed;
    expect(open).toHaveBeenCalledWith('https://apps.apple.com/app/id6796698146', '_system');
    expect(marks.accepted).toHaveBeenCalledOnce();
    expect(marks.declined).not.toHaveBeenCalled();
  });

  it('keeps programmatic dismissal decision-free and works without artwork', async () => {
    const handle = mountRatePrompt({ mountInto: document.body, id: 'rate-prompt-overlay',
      content: { title: 'Rate', subtitle: 'An honest rating', acceptLabel: 'Rate', declineLabel: 'No thanks' },
      actions: { onAccept: marks.accepted, onDecline: marks.declined },
    });
    expect(document.querySelector('.fab-rate-illustration')).toBeNull();
    handle.dismiss();
    await handle.dismissed;
    expect(marks.accepted).not.toHaveBeenCalled();
    expect(marks.declined).not.toHaveBeenCalled();
  });
});
