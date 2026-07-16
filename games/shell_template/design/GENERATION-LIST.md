# Assets to generate per game — the definitive list

Phase-two source of truth. Every slot below is generated fresh when a new game
is skinned onto the shell. Grounded in the actual runtime inventory of
`public/ui/` (53 PNGs); everything not listed here is shell-generic and ships
as-is (confetti, hearts, back button, settings toggles — see ASSET-LIST.md).

Column key: **Files** are runtime paths under `public/ui/`; **Gen size** is the
generation target (post-processed down to the ship size); **Brief** is the slot
line appended to the shared prompt template (see PIPELINE below).

## A. Art slots (image generation)

| # | Slot | Files | Ship size | Gen size | Brief |
|---|---|---|---|---|---|
| 1 | Title card | `home/home-banner-mascot-runtime.png` | 966×429 | 1932×858 | Game-name display lettering + hero motif on transparent bg. No mascot required. |
| 2a | Success mark | `level-complete/<game>-complete.png` (+ `mascots/<game>.png` 768² if mascot game) | 492×512 | 1024² | Mascot celebrating, OR iconographic success (burst medal, trophy) for mascot-less games. |
| 2b | Failure mark | `level-complete/<game>-crying.png` | 492×512 | 1024² | Sad mascot OR iconographic failure (cracked medal). Same style as 2a. |
| 3 | Branded coin | `menu-icons/icon_coin.png` | 256² | 1024² | The soft-currency identity (FTD: paw coin). Single coin, front-facing, glossy. |
| 3b | Coin pack tiers ×6 | `shop/shop_coin_pack_{1..6}.png` | 256² each | 1024² | Tiered piles of #3's coin: single → pouch → stack → chest → cart → vault. Richness must scale with tier. |
| 4 | Branded hint / sellable | `menu-icons/icon_hint_magnifier.png` 256², `menu-icons/magnifier-runtime.png` ~384×405 | see files | 1024² | The consumable booster identity (FTD: magnifier). One object. |
| 4b | Hint pack tiers ×3 | `shop/shop_hint_pack_{small,medium,large}.png` | ≤512² (regen; FTD ships 1254²) | 1024² | 1 / 3 / 5 of #4's object, arranged; richness scales. |
| 5a | No-ads badge | `shop/shop_no_ads.png` + `home/no-ads-runtime.png` (≤512², regen) + `settings/settings_icon_no_ads.png` 256² | see files | 1024² | "ADS" burst with red slash, game-palette framing. Same art feeds all three slots. |
| 5b | No-ads premium / VIP | `shop/shop_no_ads_premium.png` 727², `shop/shop_vip_bundle.png` 727×715 | see files | 1024² | Premium variant: #5a + crown/gems + coin & hint garnish. |
| 6 | "Level Complete" title | `level-complete/level-complete-title.png` | 1100×469 | 2200×938 | Display lettering, arched, win-card style. |
| 7 | "Out of Lives" title | new file `level-complete/out-of-lives-title.png` | 1100×469 | 2200×938 | Same lettering family as #6, somber palette. UI task rides along: restyle fail screen to win-card structure. |
| 8 | Shop icon | `menu-icons/icon_shop_cart.png` 256², `menu-icons/shop-icon-runtime.png` 250×300 | see files | 1024² | Bottom-nav shop identity. |
| 9 | Play icon | `menu-icons/nav_play_btn.png` | ≤512² (regen; FTD ships 1254²) | 1024² | Bottom-nav center play mark. (Home Play CTA itself is the CSS pill — not art.) |
| 10 | Settings icon | `menu-icons/icon_settings_gear.png` 256², `menu-icons/settings-icon-runtime.png` ~302² | see files | 1024² | Bottom-nav gear + settings Home row reuses `settings/settings_icon_home.png` (generic, keep). |
| 11 | Saga node: current | `home/node-current-candy.png` (wired as `--fab-levelmap-art-current`, HomeScene.ts:65; NOT the teal file, which is unused) | 384² | 1024² | Glowing current-level button. |
| 12a | Saga node: upcoming/default | `home/level-node-locked-runtime.png` (`--fab-levelmap-art-default`) | 320×300 | 1024² | Muted not-yet-reached node, same family as #11. |
| 12b | Saga node: locked | `home/level-node-locked-bones-runtime.png` (`--fab-levelmap-art-locked`) | 320×343 | 1024² | Hard-locked node — FTD ships BONES art here, unmistakably branded; every game regenerates it. |
| 12c | Saga node: complete | `home/level-node-complete-runtime.png` (`--fab-levelmap-art-completed`) | 320×320 | 1024² | Checked/cleared node, same family. |

The saga map is these FOUR node states + a pure-CSS path connector
(`.fab-levelmap-path` — no asset). `level-node-current-teal-runtime.png` is a
dead file; delete on cleanup.
| 13 | Background pattern motif | inline SVG in `styles.css` `#hud-overlay.home-mode::before` (FTD: paw) | 96×96 SVG tile | vector/SVG | ONE simple silhouette motif (paw → marble, star, gem…). Generated as a shape, hand-tuned into the tiling SVG. Must tile seamlessly; color comes from the scheme, not the asset. |

Optional per game (defaults are fine): shop badge ribbons
(`shop/badges/*-{mint-rose-ticket,gold-candy-tab}.png` 600×176) — generic
"BEST VALUE"/"POPULAR" lettering, only regenerate if the game wants its own
lettering style.

## B. Non-art swaps (no image model)

| Swap | Where | Mechanism |
|---|---|---|
| Title + result copy | `design/copy.ts` (`game.title`, win/fail strings) | edit / design sheet |
| Color scheme | `design/tokens.css` (7 `--fab-*` colors) — **but** `styles.css` has ~245 hardcoded colors vs 4 token usages today | see C |
| Pattern motif color/opacity | the #13 SVG's `fill`/`fill-opacity` | driven by scheme tokens once C lands |
| App icon + splash | `native-resources/` | separate pipeline (existing capacitor assets flow) |

## C. Color-scheme flexibility (the gap to close)

Today a palette change is not possible: `tokens.css` defines 7 colors but
`styles.css` uses them 4 times against ~245 hardcoded hex/hsl values. Plan —
**semantic scheme layer, not full retokenization**:

1. Extend `tokens.css` with ~15–20 semantic slots derived from the 7 base
   colors: home backdrop ramp (3 stops), pattern ink, nav bar fill, CTA green
   ramp (top/bottom/border/shadow — today's `hsl(128…)` quad), reward gold
   ramp (`hsl(38…)`), page background, card surface, danger/fail ramp.
2. Rewire only the high-visibility shell surfaces in `styles.css` to those
   vars (home backdrop + vignette variant, paw/pattern ::before, nav, Play
   pill, balance pills, shop price buttons, win/fail cards). Leave long-tail
   internals hardcoded.
3. The paw-pattern SVG data-URI gets its fill from a token via a small build
   or CSS `mask-image` + `background-color` trick so recoloring is one var.
4. Prove it with one alternate scheme ("mint" or "berry") toggled on device.

## PIPELINE (as built 2026-07-16 — pixelsmith + portal; learned from ai_asset)

Machine truth: `design/style-guide.json` (pinned style) + `design/asset-specs/*.json`
(one per slot; sheets carry `sheet: {cols, rows, names[]}`). Full plan:
`docs/plans/2026-07-16-001-feat-pixelsmith-hitl-asset-pipeline-plan.md`.

1. **Ingest (once per game):**
   `uv run pixelsmith ingest <refs...> --game-root games/<game>` (run in the
   pixelsmith checkout) writes `design/style-guide.json` — phrase tokens +
   ref palette from the reference images, palette ROLES read from
   `design/tokens.css` (tokens keep color authority; the unit test
   `tests/unit/style-guide-alignment.test.ts` fails on drift). Post the guide
   + refs to portal as an `approve` request; hand-apply corrections (incl.
   the per-surface `color_map`), set `pinned: true`. `generate` warns on an
   unpinned guide; ingest refuses to overwrite a pinned one without `--force`.
2. **Generate (per slot batch):**
   `uv run pixelsmith generate --spec design/asset-specs/<slot>.json --out <path> --game-root games/<game> --max-cost <usd>`
   — fans out one call per model in the spec (default gemini-3.1-flash-image
   + gpt-5.4-image-2; `--model` overrides; multi-model outputs get a model
   slug suffix). Prompts are deterministic from style-guide + spec
   (`prompt_extra` for composition notes). Budget is enforced across the
   fan-out. Sheets: `--out` is a directory; cells land as `<name>.png`.
3. **Transparency is automatic:** native alpha (OpenAI `background:
   transparent`) or prompt-requested; outputs without real alpha are matted
   via the pinned ONNX model (`PIXELSMITH_MATTING_MODEL=<path>.onnx`) and
   defringed; every transparent asset must pass the halo-QA gate (specs with
   intentional glow set `"glow": true`). Post-process fits to ship size —
   never stretches — and records provenance + `design/asset-identity.json`.
4. **Review (portal):** post candidates per batch —
   `portal post --stream <game>-assets --kind pick-one --before <current-asset> --manifest <captions>` —
   captions carry model + cost. Keep generating later batches while picks are
   open. Feedback → adjust spec/`prompt_extra`, repost with
   `--supersedes <req> --feedback "<their words>"`.
5. **Install + close:** install the winner to the runtime path, commit
   quoting the portal request id + verdict, then post the on-device capture
   (`verify-device` / `pixelsmith capture`) into the same chain.

6. **Anchored + varied generation (added during the live run):** specs may
   carry `anchors` (paths to picked identity assets — attached as image
   references via the edit path, identity-locked) and `variants` (named
   prompt nudges; the CLI fans out models x variants concurrently). Policy:
   ~4 options per slot — fresh slots 2 models x 2 variants; anchored slots
   4 variants on the winning model.
7. **Color schemes are CSS, not generation:** `--sch-*` tokens in
   styles.css with `html[data-scheme]` palette sets (shop tokens scoped on
   `.home-page-shop`). Scheme previews render the live game per scheme;
   palette-carrying assets regenerate anchored if the scheme demands it.

The agent owns pick/retry/stop; every pixelsmith/portal invocation returns.

## Generation order for the generic set

Style anchor first, then: 3 coin → 4 hint (economy identity anchors everything)
→ 3b/4b tiers → 5a/5b → 8/9/10 nav icons → 11/12 saga nodes → 1 title card →
6/7 title lettering → 2a/2b marks → 13 pattern motif. Scheme work (C) can run
in parallel; #7 carries the fail-screen restyle.
