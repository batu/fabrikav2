/** Debug-only pickup-style override (settings dropdown, TEST_HARNESS builds).
 *
 * Deliberately NOT persisted: a style persisted during an earlier build's
 * evaluation silently overrode the shipped default on device (build 6).
 * Session-scoped module state only. */

export type PickupStyle = 'classic' | 'juiced' | 'dissolve' | 'peel';

export const PICKUP_STYLES: readonly PickupStyle[] = ['classic', 'juiced', 'dissolve', 'peel'];

let override: PickupStyle | null = null;
let liveApply: ((style: PickupStyle) => void) | null = null;

export function getDebugPickupStyle(): PickupStyle | null {
  return override;
}

export function setDebugPickupStyle(style: PickupStyle): void {
  override = style;
  liveApply?.(style);
}

/** GameScene registers its setter on create so the dropdown applies to the
 * RUNNING level too, not just the next one. */
export function registerPickupStyleApplier(apply: ((style: PickupStyle) => void) | null): void {
  liveApply = apply;
}
