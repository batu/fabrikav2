import { SDK_VERIFIER_PANEL_ID } from '@fabrikav2/testkit/debug';

export interface SdkVerifierGestureOptions {
  now?: () => number;
  tapWindowMs?: number;
  tapsRequired?: number;
  panelId?: string;
}

const DEFAULT_TAP_WINDOW_MS = 600;
const DEFAULT_TAPS_REQUIRED = 4;

/** Installs the hidden dev gesture without counting interactions inside the tool. */
export function installSdkVerifierGesture(
  target: Window,
  onToggle: () => void,
  options: SdkVerifierGestureOptions = {},
): () => void {
  const now = options.now ?? Date.now;
  const tapWindowMs = options.tapWindowMs ?? DEFAULT_TAP_WINDOW_MS;
  const tapsRequired = options.tapsRequired ?? DEFAULT_TAPS_REQUIRED;
  const panelId = options.panelId ?? SDK_VERIFIER_PANEL_ID;
  let tapCount = 0;
  let lastTapTime = 0;

  const onPointerUp = (event: PointerEvent): void => {
    const eventTarget = event.target as { closest?: (selector: string) => Element | null } | null;
    if (eventTarget?.closest?.(`#${panelId}`)) return;

    const timestamp = now();
    if (timestamp - lastTapTime > tapWindowMs) tapCount = 0;
    tapCount += 1;
    lastTapTime = timestamp;

    if (tapCount < tapsRequired) return;
    tapCount = 0;
    onToggle();
  };

  target.addEventListener('pointerup', onPointerUp);
  return (): void => target.removeEventListener('pointerup', onPointerUp);
}
