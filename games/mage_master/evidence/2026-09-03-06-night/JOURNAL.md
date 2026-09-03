# Night pass (2026-09-03, 01:30–02:15 and 10:00–10:30) — review fixes after the fidelity pass

Batu at 01:2x: "Work until the morning. It is up to you to improve it." The phone was
occupied by Find the Bird until 02:00; the session was then suspended by a
re-login from 02:15 until 10:04, so the queue finished in the morning.

## What the captures found (before)

- `03-victory-before.png`: the Victory card's "Next level" / "Home" rendered as bare
  text — no plates. Root cause: the runtime art variables (`--fab-mm-frame-*`,
  `--fab-mm-scene-*`) were declared with `none` defaults on `:root, .fab-ui`; every
  kit root nested inside `.mm-root` also carries `.fab-ui` (modal backdrops, the
  shop and settings pages), so the inherited URL was reset to `none` on exactly
  those surfaces. Fix: the defaults now live on `:root` only (`design/tokens.css`).
- `02-boss-bar-before.png`: the Phaser boss bar sat at canvas y≈40, behind the
  framed DOM level strip; only a red sliver showed. Fix: the bar is a DOM overlay
  (`.mm-bossbar`) at the top of the arena, driven per frame from the sim view.
- `01-shop-before.png`: four-digit gold truncated to "12…"; price plates floated
  below the cards; dead wood under the Restore row (judge: 3 majors).
- `04-settings-before.png`: flat CSS page, kit defaults, no frames.

## After

- `06-victory-after.png`: gold "Next level" plate + dark "Home" plate on the card.
- `09-boss-bar-after.png`: "Goblin chief" name + bar across the arena top, clear of
  the strip and the stage track (rect 44,211 → 366,244 in CSS px).
- `13-topbar-worst-case.png` / `14-topbar-four-digits.png`: pills share the bar
  equally, the energy timer stacks under its value, counts ≥ 10 000 compact to
  "10.9k" — nothing ellipsizes.
- `11-shop-after-rows.png`: packs are framed rows (art, name, one-line copy, price
  plate inside the frame), "Best value" badge, Restore framed, the rift scene
  glowing below the packs.
- `12-settings-after-scene.png`: painted camp under a scrim, one framed panel
  with the three toggle rows and a full-width Reset plate.

## Judge trajectory (pixelsmith multi-model consensus)

- shop v1: pass with 3 majors (truncated coin ×3 models, dead space, detached plates)
- settings v1: fail (reset width, empty lower half, flat background, plain toggles)
- shop v2 / settings v2 / victory / boss: see `judge-*.json` next to this file.

## Not done

- The 30-minute device re-soak against the softened ramp did not run (the phone
  was busy at night and the morning went to the review fixes). The headless
  pacing test still covers a greedy 30-minute session (≥6 wins, level ≥3,
  ≤2 energy waits) on the shipped tuning.
