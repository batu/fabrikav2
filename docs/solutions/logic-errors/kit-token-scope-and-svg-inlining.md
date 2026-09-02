# Kit surfaces ignore `:root` tokens and inline SVG sprites render bare

**Date:** 2026-09-02 · **Game:** mage_master (kit lineage) · **Where seen:** first
device boot of a fresh `_template` game.

## Symptoms

1. The saga rail, modals, and buttons on the phone rendered with the kit's neutral
   greys even though `design/tokens.css` set every `--fab-*` color.
2. Sprite buttons (`buildButtonElement({ spriteImage })`) and result-card ribbons
   drew no background at all; on-device `getComputedStyle` showed
   `background-image: none` and no inline `--fab-btn-sprite-image`.

## Root causes

1. `packages/ui/src/ui.css` declares its token defaults on `.fab-ui` inside
   `@layer fab.tokens`. A kit root element carries `.fab-ui`, so its **own**
   layered declaration beats anything the game declares on `:root` (inheritance
   never beats a declaration on the element). Only a declaration that targets
   `.fab-ui` itself, unlayered, wins. Same family as the marble_run finding
   that `@fabrika/core` level-map tokens had to go through the `theme` prop.
2. Vite inlines small SVG imports as `data:image/svg+xml,...` URL-encoded with
   single quotes. The kit interpolates the value unquoted (`url(${spriteImage})`),
   which is invalid CSS, so the whole custom property is dropped.

## Fix

- `design/tokens.css`: `:root, .fab-ui { --fab-...: ... }`.
- Import SVG sprites with `?url` (tap_ten already does) and set
  `build.assetsInlineLimit: 0` in the game's `vite.config.ts`.

## How to spot it fast

Do not guess from screenshots. mage_master's dev drive has an `inspect` op
(`src/dev/devDrive.ts`) that returns computed style and rect for a selector on
the device; `inline: null` on a sprite button is the tell.
