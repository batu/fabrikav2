import { mountModalShell, type UiHandle } from '@fabrikav2/ui';
import { assetUrls } from '../../design/theme';

/**
 * v1 sugar3d "all marbles sorted" finale: an orange-ribbon ModalShell with an
 * Awesome green button. The scaffold's wrapped level sequence has no built-in
 * all-complete trigger yet (gameplay-port card owns that), so this is exposed as
 * a standalone mount the flow can call when a finale state is reached.
 */
export interface MountFinaleOptions {
  mountInto: HTMLElement;
  onDone: () => void;
  onDismiss?: () => void;
}

export function mountFinale(opts: MountFinaleOptions): UiHandle {
  const body = document.createElement('div');
  body.className = 'marble-finale-body';
  const message = document.createElement('p');
  message.className = 'fab-result-message';
  message.textContent = 'All marbles sorted!';
  body.appendChild(message);

  const handle = mountModalShell({
    mountInto: opts.mountInto,
    ribbon: { title: 'Complete', image: assetUrls.ribbonOrange },
    cardImage: assetUrls.popup,
    cardClassName: 'marble-finale-card',
    body,
    actions: [
      {
        label: 'Awesome',
        dataAction: 'finale-done',
        className: 'marble-result-action',
        spriteImage: assetUrls.buttonGreen,
        onClick: () => {
          handle.dismiss();
          opts.onDone();
        },
      },
    ],
    onDismiss: opts.onDismiss,
  });
  return handle;
}
