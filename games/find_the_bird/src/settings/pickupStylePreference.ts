/** Session-only pickup presentation preference.
 *
 * Deliberately not persisted: a style selected during an earlier build's
 * evaluation silently overrode the shipped default on device (build 6). */

export const PICKUP_STYLE_OPTIONS = [
  { value: 'classic', label: 'Classic' },
  { value: 'dissolve', label: 'Dissolve' },
  { value: 'feathers', label: 'Feathers' },
  // 2026-08-07 juice proposals — each hides the sprite-swap size shift with a
  // different opening beat; see the Portal review post.
  { value: 'flashbulb', label: 'Flashbulb' },
  { value: 'burst', label: 'Feather burst' },
  { value: 'tumble', label: 'Pop & tumble' },
] as const;

export type PickupStyle = (typeof PICKUP_STYLE_OPTIONS)[number]['value'];

export const DEFAULT_PICKUP_STYLE: PickupStyle = 'classic';

let preference: PickupStyle | null = null;
let liveApply: ((style: PickupStyle) => void) | null = null;

export function getPickupStylePreference(): PickupStyle | null {
  return preference;
}

export function setPickupStylePreference(style: PickupStyle): void {
  preference = style;
  liveApply?.(style);
}

/** GameScene registers its setter on create so Settings applies to the
 * running level too, not just the next one. */
export function registerPickupStyleApplier(apply: ((style: PickupStyle) => void) | null): void {
  liveApply = apply;
}
