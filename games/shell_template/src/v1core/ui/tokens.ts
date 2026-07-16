/**
 * `../v1core/ui/tokens` — typed mirror of the neutral scalar `--fab-*`
 * design tokens defined in `ui.css` (the `.fab-ui` rule).
 *
 * WHY this exists: DOM games consume theming through the `--fab-*` CSS custom
 * properties, but Phaser/canvas games render in-canvas where CSS variables are
 * unreachable (they need numeric `0x` colors and raw px numbers). This module is
 * the typed, canvas-consumable statement of the SAME neutral defaults `ui.css`
 * ships — the single source of truth for those values in TypeScript.
 *
 * CONTRACT (two tiers, see packages/core/src/ui/README.md):
 *   - `ui.css` remains the RUNTIME source for DOM consumers.
 *   - `FabTokens` is the canonical TS statement for canvas consumers.
 *   - Alignment is enforced by `tokens.test.ts` (parse-and-assert), NOT by
 *     codegen or any build-time coupling. Edit both files together; the test
 *     catches you if you don't.
 *
 * SCOPE: scalar tokens only (colors + spacing/radius/font/duration). The ~150
 * composite tokens (multi-layer shadows, gradients, animation shorthands, art
 * URLs, per-component groups) are intentionally NOT mirrored — they are not
 * meaningfully consumable as canvas numbers and stay CSS-only.
 *
 * This module is a pure data leaf: zero imports of DOM, Phaser, `import.meta.env`
 * or the `./ui` barrel. Import it directly via `../v1core/ui/tokens` — never
 * through the `./ui` barrel, which would drag DOM code into a canvas game's
 * import graph.
 */

/** A color token carrying both the lowercase hex string and its numeric `0x` form. */
export interface ColorToken {
  /** Lowercase 6-digit hex, byte-identical to the `ui.css` declaration (e.g. `#6b7280`). */
  readonly hex: string;
  /** The same color as a numeric literal for Phaser/canvas APIs (e.g. `0x6b7280`). */
  readonly num: number;
}

/** A string-only color token (no meaningful single `0x` form — e.g. an rgba scrim). */
export interface CssColorToken {
  /** The raw CSS color string, byte-identical to the `ui.css` declaration. */
  readonly css: string;
}

/**
 * Authors a color once as a lowercase hex string and derives the numeric `0x`
 * form, so the two never drift by hand-typing. The drift test additionally
 * asserts `num === parseInt(hex.slice(1), 16)` and lowercase-hex shape.
 */
function color(hex: string): ColorToken {
  return { hex, num: parseInt(hex.slice(1), 16) };
}

export const FabTokens = {
  color: {
    surface: color('#ffffff'),
    text: color('#3d3d3d'),
    textMuted: color('#555555'),
    accent: color('#6b7280'),
    onAccent: color('#ffffff'),
    secondarySurface: color('#f0f0f0'),
    onSecondary: color('#333333'),
    secondaryBorder: color('#cccccc'),
    /** Mirrors `--fab-btn-icon-color`; equal to `accent` today but kept distinct per the CSS. */
    btnIcon: color('#6b7280'),
    /** `--fab-color-overlay-scrim`: string-only (an alpha color has no single `0x` form). */
    overlayScrim: { css: 'rgba(0, 0, 0, 0.4)' } as CssColorToken,
  },
  /** `--fab-space-*` in px. */
  space: { sm: 8, md: 20, lg: 24 },
  /** `--fab-radius-*` in px. */
  radius: { sm: 8, md: 16, pill: 28 },
  font: {
    family: "'Nunito', sans-serif",
    // NOTE: sm (15) > md (14) is REAL in ui.css, not a typo — do not "fix" it.
    size: { sm: 15, md: 14, lg: 18 },
    weight: { normal: 500, bold: 800 },
  },
  /** `--fab-duration-fast` in ms. */
  duration: { fastMs: 80 },
} as const;

export type FabTokens = typeof FabTokens;
