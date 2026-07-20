// Warm the UI icon images into the browser cache so they don't pop in when a
// surface first renders. Home-critical icons are ALSO <link rel="preload">ed in
// index.html for first-paint; this covers everything (incl. shop/settings,
// which open later) from one list and is cheap to keep in sync.

export const HOME_NO_ADS_BADGE_SRC = '/ui/home/no-ads-runtime.png';

const ICON_URLS: readonly string[] = [
  // Home — nav bar, currency, no-ads, banner, level nodes
  '/ui/menu-icons/icon_coin.png',
  '/ui/menu-icons/icon_hint_magnifier.png',
  '/ui/menu-icons/shop-icon-runtime.png',
  '/ui/menu-icons/settings-icon-runtime.png',
  '/ui/menu-icons/magnifier-runtime.png',
  HOME_NO_ADS_BADGE_SRC,
  '/ui/home/play-level-button-runtime.png',
  '/ui/home/home-banner-mascot-runtime.png',
  '/ui/home/node-current-candy.png',
  '/ui/home/level-node-locked-runtime.png',
  '/ui/home/level-node-locked-bones-runtime.png',
  '/ui/home/level-node-complete-runtime.png',
  // Shop / settings page (open from the home "+" buttons and nav)
  '/ui/page-header/back_button.png',
  '/ui/shop/shop_no_ads.png',
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
let decoded: Promise<void> = Promise.resolve();

/** Fire-and-forget cache warm. Idempotent; safe to call from boot. Decodes each
 *  image (not just fetches) so the browser has a paint-ready bitmap cached and
 *  the real <img> doesn't blank-then-pop on first render. */
export function preloadIcons(): void {
  if (warmed) return;
  warmed = true;
  const decodes: Promise<unknown>[] = [];
  for (const src of ICON_URLS) {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    decodes.push(img.decode().catch(() => undefined));
  }
  decoded = Promise.all(decodes).then(() => undefined);
}

/** Resolves once the preloaded icons are decoded (paint-ready). Used to hold the
 *  scene-transition cover until the home can render without icons popping in. */
export function whenIconsDecoded(): Promise<void> {
  return decoded;
}
