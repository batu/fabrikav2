import { gameState } from '../core/GameState';
import { playUITap } from '../audio/AudioManager';
import { getStoreMetadata } from '../platform/StoreMetadata';
import { mountRatePrompt } from '../v1core/ui';
import { FTD_UI_THEME } from './ftdTheme';

/**
 * One-shot rate-me prompt — find_the_dog wiring of the shared
 * `../v1core/ui` component (A-UI0).
 *
 * The reusable structure/look/behavior lives in core (`mountRatePrompt`); this
 * file injects only the FTD-specific bits: copy, theme tokens, and the side
 * effects (gameState marks, store deep-link, tap sound). The env-reading
 * `getStoreMetadata` stays here on purpose — core must not import
 * `import.meta.env`.
 *
 * UX contract (per ZJRPOiTP): caller decides when to show (after the 5th
 * level-complete); Yes → open store + mark `ratePromptShown`; Not really →
 * mark `rateDeclined` (never re-prompts). `dismissed` resolves on every path so
 * the caller can sequence it against scene transitions.
 */
export interface RatePromptHandle {
  dismissed: Promise<void>;
  dismiss: () => void;
}

export function showRatePromptWithHandle(): RatePromptHandle {
  const hudOverlay = document.getElementById('hud-overlay');
  if (!hudOverlay) return { dismissed: Promise.resolve(), dismiss: () => {} };

  const handle = mountRatePrompt({
    mountInto: hudOverlay,
    id: 'rate-prompt-overlay',
    theme: FTD_UI_THEME,
    content: {
      title: 'Enjoying Marble Run?',
      subtitle: 'A quick rating helps other players find us.',
      acceptLabel: 'Yes, rate it',
      declineLabel: 'Not really',
    },
    actions: {
      onInteract: playUITap,
      onAccept: () => {
        gameState.markRatePromptShown();
        try {
          // _system tells the WebView / Capacitor shell to open externally
          // (store deep-links resolve there). Failure = silent no-op.
          const storeUrl = getStoreMetadata().storeUrl;
          if (storeUrl !== null) window.open(storeUrl, '_system');
        } catch {
          // Never block the prompt close on a navigation failure.
        }
      },
      onDecline: () => {
        gameState.markRateDeclined();
      },
    },
  });

  return { dismissed: handle.dismissed, dismiss: handle.dismiss };
}
