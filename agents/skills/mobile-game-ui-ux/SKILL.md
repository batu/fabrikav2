---
name: mobile-game-ui-ux
description: >
  Design, review, and improve mobile game UI/UX for casual, puzzle, Phaser, Three.js,
  Canvas, WebView, and Capacitor games. Use when work touches mobile game HUDs, menus,
  onboarding, first-run flow, touch controls, thumb-zone layout, feedback/juice,
  game overlays, portrait/landscape behavior, responsive canvas sizing, phone screenshots,
  Playwright mobile tests, real-device validation, or when a user says the game UI/UX,
  frontend, polish, feel, readability, or controls are weak.
---

# Mobile Game UI/UX

## Overview

Own the phone-player experience, not just the web frontend. Use this as the
router skill for mobile game interface work, then load narrower skills when the
task requires implementation or verification detail.

## Route Adjacent Skills

- Use `phaser-core` for Phaser scene architecture, scaling, input, and game state.
- Use `game-polish` when mechanics work but feel flat.
- Use `game-qa` for Phaser/mobile browser test coverage.
- Use `iterative-visual-review` for screenshot-driven design loops.
- Use `android-adb-real-device-testing` when a connected Android phone is available or requested.
- Use `frontend-design`, `frontend-polish`, `frontend-review`, or `frontend-adapt` only for DOM-heavy menus, overlays, stores, settings, or responsive shell UI. Do not let generic web-app patterns dominate gameplay.

## Default Workflow

1. Classify the surface:
   - core gameplay HUD
   - menu/level select/shop/settings
   - onboarding/tutorial
   - game-over/win/fail flow
   - editor/tooling UI for game content
   - marketing/broadcast overlay around a game

2. Establish the phone contract before coding:
   - target devices and orientation
   - engine stack and rendering surface
   - primary player action loop
   - first 30 seconds of play
   - reachable controls for one-handed and two-handed use
   - safe areas, notches, browser chrome, WebView constraints
   - evidence mode: human-present/Batu-driving, TWF/unattended, or release/device-sensitive

3. Audit the current state before changing it. Use [references/audit-rubric.md](references/audit-rubric.md) and produce a short scorecard with the top fixes.

4. Fix in player-impact order:
   - understandability: can a new player start and know the next action?
   - controls: are tap zones large, reachable, and unambiguous?
   - HUD: can the player read state without covering play?
   - feedback: does every action answer immediately?
   - flow: do win/fail/retry/continue states preserve momentum?
   - performance: does the UI stay smooth on mobile-sized screens?

5. Verify with evidence. Use the mode-aware ladder in [references/evidence-loop.md](references/evidence-loop.md). Do not call mobile game UI/UX done from desktop inspection alone.

## Hard Rules

- Preserve gameplay logic unless the user asked for design plus mechanics. If a UX fix changes scoring, input validity, win/fail conditions, level order, economy, or physics, stop and name the tradeoff.
- Do not build a landing page, generic SaaS dashboard, card grid, hero section, or centered web-app composition when the target is gameplay.
- Do not hide critical game actions behind hover, tiny icons, keyboard-only shortcuts, or desktop-only controls.
- Do not rely on a single desktop screenshot. At minimum capture a phone-sized viewport. Prefer real-device proof for shipped mobile games.
- Do not turn every small human-present tweak into a real-device release gate; match the evidence depth to the mode and risk.
- Do not add decorative motion before tap/readability/flow issues are solved.

## Reference Loading

- Read [references/touch-layout-hud.md](references/touch-layout-hud.md) for HUD, thumb-zone, safe-area, and canvas layout decisions.
- Read [references/onboarding-feedback.md](references/onboarding-feedback.md) for first-run, tutorial, action feedback, and game-feel checks.
- Read [references/evidence-loop.md](references/evidence-loop.md) before final verification.
