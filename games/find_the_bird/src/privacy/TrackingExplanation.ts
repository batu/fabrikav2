import { mountV1Modal } from '../v1core/ui';
import { playUITap } from '../audio/AudioManager';
import { withTimeout } from '../utils/withTimeout';

let notificationPromptReady: Promise<void> = Promise.resolve();
export function setNotificationPromptReady(ready: Promise<void>): void {
  notificationPromptReady = ready.catch(() => {});
}

/** Continue acknowledges the explanation, never records tracking permission. */
export async function showTrackingExplanation(): Promise<void> {
  await notificationPromptReady;
  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.className = 'tracking-explanation-body';
    const art = document.createElement('img');
    art.src = '/ui/tutorial/personalized-ads.png';
    art.alt = '';
    const copy = document.createElement('p');
    copy.id = 'tracking-explanation-copy';
    copy.textContent = 'Your choice helps decide whether ads can be personalized. Next, iOS will ask whether to allow tracking.';
    body.append(art, copy);
    let continued = false;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = mountV1Modal({
      mountInto: document.body,
      id: 'tracking-explanation',
      title: 'PERSONALIZED ADS',
      describedById: copy.id,
      cardClassName: 'tracking-explanation-card',
      body,
      backdropDismiss: false,
      actions: [{ label: 'Continue', variant: 'primary', onClick: () => {
        if (continued) return;
        continued = true;
        playUITap();
        modal.dismiss();
        previousFocus?.focus();
        resolve();
      } }],
    });
    const button = document.querySelector<HTMLButtonElement>('#tracking-explanation button');
    modal.el.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') { event.preventDefault(); button?.focus(); }
    });
    button?.focus();
  });
}

export interface TrackingRequestDependencies {
  platform: string;
  status: () => Promise<{ status: string }>;
  explain: () => Promise<void>;
  request: () => Promise<void>;
  timeoutMs?: number;
}

/** One owner shared by ads and attribution; failures never trigger a second requester. */
export function createTrackingRequest(deps: TrackingRequestDependencies): () => Promise<void> {
  let pending: Promise<void> | null = null;
  const bounded = <T>(operation: Promise<T>): Promise<T> =>
    withTimeout(operation, deps.timeoutMs ?? 15000, 'Tracking request');
  return () => {
    pending ??= (async () => {
      if (deps.platform !== 'ios') return;
      try {
        if ((await bounded(deps.status())).status !== 'notDetermined') return;
        await deps.explain();
        // Recheck: a Settings change while the explanation was open wins.
        if ((await bounded(deps.status())).status === 'notDetermined') {
          await bounded(deps.request());
          await bounded(deps.status());
        }
      } catch { /* Unavailable native APIs must not deadlock startup or imply permission. */ }
    })();
    return pending;
  };
}
