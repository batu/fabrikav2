// Warm the UI icon images into the browser cache so they don't pop in when a
// surface first renders. Home-critical icons are ALSO <link rel="preload">ed in
// index.html for first-paint. Shop/settings icons (~11 MB of PNG) are NOT on
// the boot critical path: they decode from an idle callback after home is
// interactive, since those surfaces only open on user action.

export const HOME_NO_ADS_BADGE_SRC = '/ui/home/no-ads-runtime.png';

const HOME_ICON_URLS: readonly string[] = [
  // Home — nav bar, currency, no-ads, banner, level nodes
  '/ui/menu-icons/icon_coin.png',
  '/ui/menu-icons/icon_hint_magnifier.png',
  '/ui/menu-icons/shop-icon-runtime.png',
  '/ui/menu-icons/settings-icon-runtime.png',
  '/ui/menu-icons/magnifier-runtime.png',
  HOME_NO_ADS_BADGE_SRC,
  '/ui/home/play-level-button-runtime.png',
  '/ui/home/home-banner-mascot-runtime.png',
  '/ui/home/level-node-locked-runtime.png',
  '/ui/home/level-node-locked-bones-runtime.png',
  '/ui/home/level-node-complete-runtime.png',
];

const DEFERRED_ICON_URLS: readonly string[] = [
  // Shop / settings page (open from the home "+" buttons and nav)
  '/ui/page-header/back_button.png',
  '/ui/shop/shop_no_ads.png',
  '/ui/shop/shop_no_ads_premium.png',
  '/ui/shop/shop_vip_bundle.png',
  '/ui/shop/shop_hint_pack_small.png',
  '/ui/shop/shop_hint_pack_medium.png',
  '/ui/shop/shop_hint_pack_large.png',
  '/ui/shop/shop_coin_pack_1.png',
  '/ui/shop/shop_coin_pack_2.png',
  '/ui/shop/shop_coin_pack_3.png',
  '/ui/shop/shop_coin_pack_4.png',
  '/ui/shop/shop_coin_pack_5.png',
  '/ui/shop/shop_coin_pack_6.png',
  '/ui/settings/settings_icon_home.png',
  '/ui/settings/settings_icon_music.png',
  '/ui/settings/settings_icon_sound.png',
  '/ui/settings/settings_icon_vibration.png',
];

let warmed = false;
let deferredWarmed = false;
let decoded: Promise<void> = Promise.resolve();

function decodeAll(urls: readonly string[]): Promise<void> {
  const decodes: Promise<unknown>[] = [];
  for (const src of urls) {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    decodes.push(img.decode().catch(() => undefined));
  }
  return Promise.all(decodes).then(() => undefined);
}

/** Fire-and-forget cache warm. Idempotent; safe to call from boot. Decodes each
 *  image (not just fetches) so the browser has a paint-ready bitmap cached and
 *  the real <img> doesn't blank-then-pop on first render. Only the HOME set
 *  gates `whenIconsDecoded()`; shop/settings decode later, off the boot path. */
export function preloadIcons(): void {
  if (warmed) return;
  warmed = true;
  decoded = decodeAll(HOME_ICON_URLS);
}

/** Warm settings/shop art only while HomeScene still owns the idle window.
 *  `requestIdleCallback({ timeout })` does not delay work — it may run
 *  immediately — so scheduling this from boot competes with an immediate Play
 *  tap. HomeScene supplies the cancellable delay and calls this idempotent
 *  operation only after the player has dwelled on the menu. */
export function preloadDeferredIcons(): void {
  if (deferredWarmed) return;
  deferredWarmed = true;
  void decodeAll(DEFERRED_ICON_URLS);
}

export function hasDeferredIconPreloadStarted(): boolean {
  return deferredWarmed;
}

/** Resolves once the HOME icons are decoded (paint-ready). Used to hold the
 *  scene-transition cover until the home can render without icons popping in. */
export function whenIconsDecoded(): Promise<void> {
  return decoded;
}
