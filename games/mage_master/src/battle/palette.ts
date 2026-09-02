/**
 * Numeric colors for the Phaser renderer, read from the --fab-mm-* tokens so
 * design/tokens.css stays the single color authority. Fallbacks only cover a
 * headless environment with no stylesheet.
 */
const FALLBACK: Record<string, number> = {
  sand: 0xe9d3a6,
  "sand-deep": 0xd9bf8c,
  ledge: 0x5b3a1e,
  "ledge-edge": 0x3f2612,
  ink: 0x3a2410,
  cream: 0xfff3d6,
  gold: 0xe8b84a,
  hp: 0xd4472f,
  "hp-track": 0x2b1a10,
  success: 0x7f9c4a,
  danger: 0xb9331c,
  crystal: 0xa56cf5,
  "element-fire": 0xf26a2a,
  "element-ice": 0x7cc6ff,
  "element-lightning": 0xffe14a,
  "element-arcane": 0xb56cff,
};

function parseHex(value: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim());
  return m?.[1] ? Number.parseInt(m[1], 16) : null;
}

export type PaletteKey = keyof typeof FALLBACK | (string & {});

export function readPalette(): (key: PaletteKey) => number {
  const style = typeof document !== "undefined" ? getComputedStyle(document.documentElement) : null;
  const cache = new Map<string, number>();
  return (key) => {
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const raw = style?.getPropertyValue(`--fab-mm-${key}`) ?? "";
    const value = parseHex(raw) ?? FALLBACK[key] ?? 0xff00ff;
    cache.set(key, value);
    return value;
  };
}
