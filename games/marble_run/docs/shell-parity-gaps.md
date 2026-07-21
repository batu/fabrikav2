# Marble Run shell — parity gaps & deviations (MRV2-5)

Recorded per the card's scope-fence rule: where the @fabrikav2/ui supported
theming surface (tokens / props / game-owned slot art) could not reach v1
sugar3d parity without forking or hacking kit internals, or where a conductor
ruling / architecture decision deviated from the plan. ZERO edits were made to
`packages/ui/**`.

## Architecture / ruling deviations (intentional)

- **No FlowMachine App (architecture decision).** The plan's U2 `src/shell/App.ts`
  FlowMachine approach was NOT used. marble_run is Phaser-scene driven; the shell
  DOM surfaces were swapped surgically inside the existing scenes/overlays. New
  mount helpers live under `src/menu/**` (not `src/shell/**`) so the audit
  no-literals linter (`tools/audit/src/no-literals.js`, which scans only
  `games/*/src/shell/**` + `packages/ui`) does not force token-only copy on the
  rest of the scaffold, whose established convention keeps copy inline.
- **No shop surface (conductor ruling 2a / plan U5 skipped).** v1 marble_run has
  no shop. All visible shop entry points were removed from the shell UI: the home
  nav bar (and its Shop button) is gone with the home rewrite; the HUD coin/hint
  "+" pills were removed (`src/ui/HUD.ts`); the hint-booster modal's "Visit shop"
  option was removed. The scaffold's shop plumbing (`src/shop/**`, `IapService`,
  and `openPage`/shop rendering in `HUD.ts`) is left intact but unreachable.
  `openPage`/`closePage` remain exported/dormant in `HUD.ts`.
- **Pause == settings modal (conductor ruling 2b / KTD2).** No kit `PauseOverlay`
  is used. The in-game HUD pause/settings button opens the SAME sugar settings
  modal with the in-game variant (Restart + Home rows) — `openSettingsModal(true)`
  in `src/ui/HUD.ts`, `mountSettings({ inGame })` in `src/menu/settings.ts`.

## Visual parity gaps (kit surface could not fully express v1)

1. **Win-card coin count-up / reward-reveal animation dropped.**
   `src/ui/LevelCompleteOverlay.ts` — the v1core `mountLevelComplete` ran a timed
   coin count-up + staged reward reveal (`--fab-complete-*` tokens). The kit
   `mountResultCard` reward slot is static, so the win card shows the reward row
   immediately with no count-up. The claim-×2 rewarded-ad ECONOMY is preserved
   (green "Claim 2x" action → `onClaimX2`), but its animated CLAIM sequence is
   not. Correctness kept over visual per the card. Repro: complete a level →
   reward row appears without the flying-coin count-up.

2. **Lose-card economy is coin-continue + bundle + retry, not v1's "Watch Ad +
   Retry".** `src/ui/LevelFailedOverlay.ts` — the card's stated lose target was
   "Watch Ad (green) + Retry (orange)". The scaffold's actual monetization is
   `coinContinue` + `egoOffer` (IAP bundle) + `retry` (from `FailContinueOffers`
   / `GameScene`). Those callbacks and the full pending/refresh state machine were
   PRESERVED unchanged, rendered into the ResultCard's game-owned actions slot; a
   literal "Watch Ad" button was not substituted because that would sever the
   real offer economy. Repro: fail a level → Continue (coins) + Retry, not a
   rewarded-ad button.

3. **Fail-card offer buttons keep their scaffold DOM (not vida Button sprites).**
   The preserved `buttonForOffer` builder renders the existing icon/copy/state
   button structure inside the ResultCard; they are not re-skinned to
   `Button_Green`/`Button_Orange` sprites, to avoid rewriting the offer render
   path. Only the surrounding chrome (Ribbon_Failed, Icon_Failed, Popup card,
   v1 copy) is the sugar kit surface.

4. **No live 3D wooden board behind the menu (plan KTD6).** The gameplay/3D board
   port is a separate MRV2 card. The menu renders over the existing scaffold
   canvas; no v1 wooden-board decor is present behind the DOM shell.

5. **v1 fabrika source not present in this worktree.** The plan cited
   `fabrika/games/marble_run/sugar3d/src/**` for verbatim porting of `style.css`
   `.vida-*`/`.menu-*`/`.settings-*` rules and `shellTheme.ts`/`saga.ts`. That
   tree does not exist in this worktree, so `installShellArt()` CSS and the sugar
   token values were reconstructed from the ported asset set
   (`public/v1/ui/**`) + the plan's cited hex/spec values (purple bubble
   `#9b7bcd→#6b568e`, shadow tile @0.46, scrim `rgba(17,14,18,0.66)`, switch
   `#7d879a` / `#55f464→#10b535`, settings-row `rgba(255,255,255,0.54)`, node
   colors `#6a3016`/`#5b4636`, 56/100px menu node sizes). Exact per-layer
   pixel positioning is unverified here and is the conductor's on-device
   Pixelsmith gate to judge.

## Audit note

`node tools/audit/src/cli.js` reports pre-existing repo-wide `orphaned-token`
warnings (also for untouched games tap_ten, shell_template). The three sugar
font tokens added to `games/marble_run/design/tokens.css`
(`--fab-font-display`, `--fab-font-body`, `--fab-font-number`) are flagged the
same way because they are consumed only from `design/theme.ts`'s injected CSS,
which is outside the audit's `src/` + `packages/ui` var() scan — the same class
as the pre-existing `--fab-font-display`/`--fab-font-body` entries. Required
gates (typecheck, test:unit, eslint) are green.
