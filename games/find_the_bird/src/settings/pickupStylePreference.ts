/** Session-only pickup presentation preference.
 *
 * Deliberately not persisted: a style selected during an earlier build's
 * evaluation silently overrode the shipped default on device (build 6). */

const EXPERIMENTAL_PICKUP_STYLES = [
  'classic',
  'dissolve',
  'feathers',
  'flashbulb',
  'burst',
  'tumble',
] as const;

export type PickupStyle = (typeof EXPERIMENTAL_PICKUP_STYLES)[number];

export const DEFAULT_PICKUP_STYLE: PickupStyle = 'classic';

export function resolvePickupStyle(
  requested: string | null,
  allowExperimental = import.meta.env.DEV,
): PickupStyle {
  if (requested === 'classic') return requested;
  if (allowExperimental && EXPERIMENTAL_PICKUP_STYLES.includes(requested as PickupStyle)) {
    return requested as PickupStyle;
  }
  return DEFAULT_PICKUP_STYLE;
}

let preference: PickupStyle | null = null;
let liveApply: ((style: PickupStyle) => void) | null = null;

export function getPickupStylePreference(): PickupStyle | null {
  return preference;
}

export function setPickupStylePreference(style: PickupStyle): void {
  preference = style;
  liveApply?.(style);
}

/** GameScene registers its setter so the test harness can evaluate
 * experimental presentations against the running level. */
export function registerPickupStyleApplier(apply: ((style: PickupStyle) => void) | null): void {
  liveApply = apply;
}
