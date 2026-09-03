import iconBack from "./assets/icon-control-back.png";
import iconHome from "./assets/icon-control-home.png";
import iconPause from "./assets/icon-control-pause.png";
import iconPlay from "./assets/icon-control-play.png";
import iconSettings from "./assets/icon-control-settings.png";
import ribbonFail from "./assets/ribbon-fail.svg?url";
import ribbonNeutral from "./assets/ribbon-neutral.svg?url";
import ribbonWin from "./assets/ribbon-win.svg?url";
import panel from "./assets/panel.svg?url";
import buttonPrimary from "./assets/button-primary.svg?url";
import buttonSecondary from "./assets/button-secondary.svg?url";

/**
 * Generated art is bound by file name so a sprite that has not landed yet
 * resolves to undefined and the renderer draws a placeholder. Adding a unit
 * or icon = dropping `unit-<kind>.png` / `icon-<name>.png` into ./assets.
 */
const generated = import.meta.glob("./assets/*.png", { eager: true, query: "?url", import: "default" }) as Record<
  string,
  string
>;

/**
 * Dev builds serve unhashed URLs; a file rewritten while the WebView holds it
 * cached paints as blank until the URL changes, so dev URLs carry a boot stamp.
 * Production URLs are content-hashed by Vite and need nothing.
 */
const BOOT_STAMP = import.meta.env.DEV ? `?b=${Date.now().toString(36)}` : "";

function stamped(url: string | undefined): string | undefined {
  return url ? `${url}${BOOT_STAMP}` : undefined;
}

function generatedUrl(name: string): string | undefined {
  return stamped(generated[`./assets/${name}.png`]);
}

export const assetUrls = {
  chrome: {
    back: iconBack,
    home: iconHome,
    pause: iconPause,
    play: iconPlay,
    settings: iconSettings,
  },
  ribbon: { win: ribbonWin, fail: ribbonFail, neutral: ribbonNeutral },
  panel,
  button: { primary: buttonPrimary, secondary: buttonSecondary },
} as const;

/** Generated chrome icon with the Kenney seed as fallback until the art lands. */
export function chromeIcon(name: "home" | "settings" | "back" | "pause"): string {
  return generatedUrl(`icon-nav-${name}`) ?? assetUrls.chrome[name];
}

/** Mages tab icon: the generated wizard hat, else the warrior sprite. */
export function magesIcon(): string | undefined {
  return generatedUrl("icon-nav-mages") ?? unitSprite("warrior");
}

/** Shop tab icon; falls back to the gem pill icon until the art lands. */
export function shopNavIcon(): string | undefined {
  return generatedUrl("icon-nav-shop") ?? currencyIcon("gem");
}

/** Gem-pack art by catalog id (`gems_small` -> `shop-gems-small.png`). */
export function shopIcon(name: string): string | undefined {
  return generatedUrl(`shop-${name.replace(/_/g, "-")}`) ?? currencyIcon("gem");
}

/** Level-ladder node art (kit `--fab-levelmap-art-*`), undefined until generated. */
export function nodeArt(state: "current" | "locked" | "completed"): string | undefined {
  return generatedUrl(`node-${state}`);
}

/** Camp props drawn at the party's camp line. */
export function propSprite(name: "campfire" | "tent" | "rock-sand" | "cactus" | "bones" | "rock-forest" | "grass" | "stump" | "mushroom" | "puddle" | "roots"): string | undefined {
  return generatedUrl(`prop-${name}`);
}

/** Lettering art (title, victory, defeat, summoned, welcome). */
export function lettering(name: "title" | "victory" | "defeat" | "summoned" | "welcome"): string | undefined {
  return generatedUrl(`lettering-${name}`);
}

const scenes = import.meta.glob("./assets/scene-*.jpg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

/** Painted scene backgrounds (opaque JPEG). */
export function scene(name: "home" | "rift"): string | undefined {
  return stamped(scenes[`./assets/scene-${name}.jpg`]);
}

/** Painted ground plate per arena theme (repeats vertically in the battle scene). */
export function groundScene(theme: string): string | undefined {
  return stamped(scenes[`./assets/scene-ground-${theme}.jpg`]);
}

/** Ornate 9-slice frames for panels, buttons, and portraits. */
export function frame(name: "panel" | "button" | "button-dark" | "portrait"): string | undefined {
  return generatedUrl(`frame-${name}`);
}

/** Environment props by arena theme, in placement order. */
export const THEME_PROPS: Readonly<Record<string, readonly string[]>> = {
  sand: ["rock-sand", "cactus", "bones"],
  forest: ["rock-forest", "grass", "stump"],
  swamp: ["mushroom", "puddle", "roots"],
};

export function allPropSprites(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, url] of Object.entries(generated)) {
    const m = /\/prop-(.+)\.png$/.exec(path);
    if (m?.[1]) out[m[1]] = url;
  }
  return out;
}

/** Unit sprite by kind (`tank`, `goblin_grunt`, ...). */
export function unitSprite(kind: string): string | undefined {
  const name = kind.startsWith("goblin") || kind.startsWith("wolf") || kind.startsWith("slime") ? kind : `mage-${kind}`;
  return generatedUrl(`unit-${name.replace(/_/g, "-")}`);
}

export function currencyIcon(currency: "energy" | "gold" | "crystal" | "gem"): string | undefined {
  return generatedUrl(`icon-${currency}`);
}

export function weaponIcon(element: string): string | undefined {
  return generatedUrl(`icon-weapon-${element}`);
}

export function armorIcon(cls: string): string | undefined {
  return generatedUrl(`icon-armor-${cls}`);
}

export function riftPortal(): string | undefined {
  return generatedUrl("icon-rift-portal");
}

/** Every generated unit url, for renderer preloads. */
export function allUnitSprites(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, url] of Object.entries(generated)) {
    const m = /\/unit-(.+)\.png$/.exec(path);
    if (!m?.[1]) continue;
    const kind = m[1].replace(/^mage-/, "").replace(/-/g, "_");
    out[kind] = url;
  }
  return out;
}

/** Which way each generated sprite faces as drawn (+1 right, -1 left); the renderer flips relative to this. */
const ART_FACING: Readonly<Record<string, 1 | -1>> = {
  wolf: -1,
  wolf_alpha: -1,
  warrior: -1,
};

export function spriteFacing(kind: string): 1 | -1 {
  return ART_FACING[kind] ?? 1;
}

/** Tintable garment layer for a mage (luminance-only PNG split from the base). */
export function garmentSprite(cls: string): string | undefined {
  return generatedUrl(`garment-mage-${cls}`);
}

export interface MageAnchor {
  /** Raised-hand position as a fraction of the composite canvas. */
  readonly x: number;
  readonly y: number;
  /** Staff icon size relative to the canvas, rotation in degrees, and the pivot within the staff icon. */
  readonly staffScale: number;
  readonly staffAngle: number;
  readonly staffPivotX: number;
  readonly staffPivotY: number;
  /** Draw the staff behind the body (hand in front of the shaft); false keeps the wand on top of the hand. */
  readonly staffBehind: boolean;
}

const ANCHORS: Readonly<Record<string, MageAnchor>> = {
  // Fist centres of the 2026-09-03 chibi set (measured on a 0.1 grid over the 512 body box).
  tank: { x: 0.15, y: 0.24, staffScale: 0.62, staffAngle: -6, staffPivotX: 0.44, staffPivotY: 0.56, staffBehind: false },
  warrior: { x: 0.27, y: 0.42, staffScale: 0.58, staffAngle: -8, staffPivotX: 0.44, staffPivotY: 0.56, staffBehind: false },
  support: { x: 0.24, y: 0.38, staffScale: 0.56, staffAngle: -4, staffPivotX: 0.44, staffPivotY: 0.56, staffBehind: false },
};

export function mageAnchor(cls: string): MageAnchor {
  return ANCHORS[cls] ?? ANCHORS.tank!;
}

/** Sound clips (Kenney CC0, see ./audio/LICENSE-KENNEY-AUDIO.txt) by file stem: `sfx-hit`, `music-menu`. */
const audio = import.meta.glob("./audio/*.wav", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

export function audioClip(name: string): string | undefined {
  return audio[`./audio/${name}.wav`];
}
