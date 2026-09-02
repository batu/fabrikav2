# Pass 1 — vertical slice on device (2026-09-02, 14:14–14:25)

Device: Batu's iPhone 12 (iOS 18.7, WKWebView), bundle `com.basegamelab.mage_master`,
dev build served live from the Mac (`server.url` → Vite on the LAN). Captures via
`pymobiledevice3 developer dvt screenshot` over the running tunnel; canvas frame
bursts via the dev drive (`/__drive.json` → `harness.captureFrames`).

## Captures

| File | State | Verdict |
| --- | --- | --- |
| dev-01-home.png | first boot | kit rail oversized (kit `.fab-ui` token scope beat `:root`), Play off-screen, energy pill truncated |
| dev-02-home.png | after CSS pass | Play visible, pills fixed, rail still unthemed |
| dev-03-home.png | tokens scoped to `.fab-ui` | rail themed; Kenney font reads sci-fi (swapped for rounded system font) |
| dev-04-battle.png | first battle | canvas blank — Phaser FIT measured a detached parent (renderer created before attach) |
| dev-05-home.png | gear composites live | tinted garments + element staves on the party |
| dev-06-battle.png | battle L1 S2 | units, hits, heal numbers, HUD bars, stage track all live |
| frames-01.png | 10 frames @ 90 ms | warrior lunge, hit numbers, STAGE CLEAR banner, party advance + camera follow |
| dev-07-rift.png | rift page | odds table current vs next tier; hidden Skip rendered as an empty bar (fixed) |
| dev-08-reveal.png | pull reveal | rarity frame, stat delta vs equipped, Use / Discard |
| dev-09-mages.png | mages page | three cards, slots, full stat grid |
| dev-10-settings.png | settings | header under the notch (fixed via `--fab-safe-top`) |
| dev-11-pause.png | pause | raw kit card (themed afterwards) |
| dev-12-win.png | victory | ribbon eyebrow clipped (moved into message lines) |
| dev-13-fail.png | "fail" drive | showed VICTORY: starter party cannot lose L1; harness now forces the outcome |
| art-sheet.png | generated art | 21 codex assets on sand |
| preview-2.png | composite preview | 3 mages × 4 rarity/element combos |
| garment-split.png | base / garment layers | hue-mask split of the magenta garments |

## Fixes landed in this pass

1. Kit tokens declared on `:root, .fab-ui` so they beat the kit's layered `.fab-ui` defaults.
2. SVG assets imported with `?url` + `assetsInlineLimit: 0` (inlined SVG data URIs broke the kit's `url()`).
3. Battle renderer created after the page is attached; `scale.refresh()` after boot.
4. Mage gear composite (base + tinted garment + staff) used on home, mages page, and battle.
5. Result card eyebrow → message line; pause card and buttons dressed with the game sprites.
6. `forceOutcome` on the sim so `driveTo('fail')` is reachable with any gear.

## Still open after this pass

- Motion evidence for ranged projectiles, deaths, boss entrance (needs a fast-forward drive).
- Damage-number overlap on clustered hits.
- Rarity glow on the reveal for legendary+ not yet seen on device.
