# fabrika v2 — kickoff decisions (locked with Batu, 2026-07-06)

Interview-confirmed decisions that govern the v2 design and the overnight TWF run.
Source: conductor session 2026-07-06. Do not re-litigate without Batu.

## Goal ordering
1. **Time-to-ship a new game** (primary metric).
2. **Correction burden** — integrate per-customer feedback changes fast; agent output should land right first time.
3. **Reskin turnaround** — lower priority as re-skinning shipped games, BUT every new game
   gets its own color scheme/assets at build time, so theming-at-creation is on the
   time-to-ship critical path.

## Portfolio model
Steady stream of **new mechanics** (not many reskins of few mechanics).
→ Kernel stays thin; shared shell (screens/SDKs/services) gets strict contracts;
gameplay layer stays maximally free.

## Substrate rule
**DOM shell, free canvas.** All meta-UI (menu/saga, shop, settings, win/lose, toasts,
modals) is DOM — one themeable implementation, integrating with cloud design
(claude.ai/design) via design-sheets. Gameplay canvas per game: Phaser, Three.js, or
Canvas2D. IDEAL end state: an external designer works in Claude design and updates the
game with no engineer in the loop.

## Reskin bar
**Zero code edits.** Designer/agent edits sheets → ingester/apply regenerates
tokens/assets/copy/config → build passes. Any hand-edit of TS/CSS for a design change
is a defect. (Implication: design-sheets needs copy/text + asset-binding coverage, not
just color tokens — schema changes to design-sheets are ALLOWED.)

## Design actors
Batu + agents both edit sheets. Pipeline must be safe for programmatic edits.

## v2 home & migration
- Fresh repo: `/Users/base/dev/appletolye/fabrikav2` (this repo). v1 stays runnable, **strictly read-only**.
- Evidence for "where time went": repo archaeology (retros/todos/features + git churn),
  NOT session-history parsing (extraction skills unavailable; failed loudly, Batu chose fallback).
- **Pilot port: marble_run (sugar3d)** — in progress, simple, and needs the SDKs added,
  so it exercises the full sdk layer.

## Pilot SDK bar — full implementation test (ALL of):
- Ads: provider-agnostic service, AdMob + AppLovin MAX adapters, rewarded + interstitial.
- Analytics: shared event contract + pluggable sinks (Firebase + owned mirror worker).
- IAP: shared product-catalog schema + RevenueCat purchase/restore flow.
- Attribution: Adjust (generalize v1 core's currently-dead attribution module).

## Overnight write boundaries
- May commit: **fabrikav2** and **design-sheets**.
- fabrika v1: read-only, always.
- No deploys, no store actions, no publishing, no external side effects.
- TWF board: **new Trello board** (or an unused scratch board) — not v1's "Fabrika Codex".

## Deliverables (done bar from Batu's brief)
1. Ranked bottleneck list (evidence-cited) with concrete v2 fixes.
2. v2 architecture concrete enough to scaffold from: kernel/game boundary, shared
   screens + SDKs + subsystems + builds.
3. Full extraction backlog (nothing reusable left buried in HUD.ts/GameScene.ts).
4. Explicit design-sheets wiring: mechanism making a reskin one round-trip.
5. Ordered migration path + list of decisions that are Batu's.
- Independent grader verifies each item vs the bar; for (3) the grader must re-open the
  god-files itself. Placeholder data in any source = failed source, fail loudly.
- Output: self-contained shareable HTML report, leading with findings that contradict
  Batu's starting assumptions.
- Then: scaffold v2 skeleton + start extraction/pilot cards via TWF board mode.
