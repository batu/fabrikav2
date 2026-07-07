# Settings Rebuild Local Visual Review Journal

## Task Snapshot

Surface: Marble Run settings modal opened from the menu gear.

Reference: `games/marble_run/refs/captures/android-basegamelab/settings-from-menu.png`.

Expected result: blue popup card over dim scene, orange SETTINGS ribbon, blue X close, light rows with navy labels, glossy green toggles, yellow RESTART and green HOME buttons.

Evidence mode: TWF unattended, local-only. Real device panel remains required by the card.

MOBILE GAME UI/UX AUDIT - marble_run/settings
First 30 seconds: 4/5 - settings is reachable from the menu gear; the task is visual fidelity, not initial onboarding.
Touch ergonomics: 3/5 - old modal had reachable controls but the required restart/home actions were absent.
HUD readability: 4/5 - settings overlay does not obscure critical HUD in the menu path.
Gameplay focus: 3/5 - old beige card did not match the reference game chrome.
Feedback: 3/5 - toggles persisted, but restart/home behaviors needed real actions.
Flow momentum: 2/5 - old CLOSE plus Reset Progress did not provide the reference restart/home flow.
Responsive canvas: 3/5 - modal was phone-sized, but the reference shape/ribbon/buttons were missing.
Evidence: 2/5 - local static checks passed; browser/device screenshots are blocked in this worker.

Priority fixes:
1. Replace title/CLOSE/reset with orange ribbon, X, RESTART, and HOME.
2. Use reference popup/button/ribbon assets from `assetUrls`.
3. Retheme rows and toggles to the light-blue/navy/glossy reference treatment.

## Iteration 1

Planned result: Implement the settings reference rebuild with existing shared UI primitives and Marble Run assets.

Capture setup: Menu gear to settings in portrait phone viewport. Pre-change runtime capture could not be taken because Playwright browser launch is blocked on this host.

Pre-change evidence: Trello card YXyPXZKs and panel report findings identify the old settings modal as missing the ribbon/X, missing restart/home, beige/brown rows, and flat beige card. Code audit confirmed `App.openSettings()` mounted `title`, one CLOSE action, and conditional Reset Progress.

Change explanation: Added optional close-button support and visible-title image-ribbon support to `mountModalShell`; rewired Marble Run settings to use `ribbon-orange.png`, `popup-card.png`, `button-orange.png`, and `button-green.png`; replaced reset/close actions with restart/home; added shared testkit hooks for settings actions; updated e2e specs to assert the new controls.

Post-change evidence: No post-change screenshot could be captured locally. Chromium failed at launch with `bootstrap_check_in ... MachPortRendezvousServer ... Permission denied`; WebKit installed successfully but failed at launch with `Abort trap: 6`.

Acceptance check:

- Orange SETTINGS ribbon: code path met; visual runtime unverified locally.
- Blue X close button: code path met; unit-tested modal close lifecycle; visual runtime unverified locally.
- RESTART/HOME replace CLOSE/reset: code path met; e2e assertions added but browser execution blocked before app load.
- Light-blue/navy rows and glossy toggles: CSS path met; visual runtime unverified locally.
- Blue rounded popup card: asset path met in build output; visual runtime unverified locally.
- Restart/Home behavior: code path wired and e2e tests added; browser execution blocked before app load.

Decision: partial.

Next action: Conductor must run the required verify-device panel and inspect the on-device settings capture against `settings-from-menu.png`.

## Attempted Local Checks

- `npm run test:unit --workspace @fabrikav2/ui`: passed, 112 tests.
- `npm run test:unit --workspace @fabrikav2/testkit`: passed, 34 tests.
- `npm run test:unit --workspace @fabrikav2/marble_run`: passed, 75 tests.
- `npm run typecheck`: passed.
- `npm run audit`: passed with existing warning in `games/marble_run/game.config.ts:13`.
- `npm run lint --workspace @fabrikav2/ui && npm run lint --workspace @fabrikav2/testkit && npm run lint --workspace @fabrikav2/marble_run`: passed with existing warning in `games/marble_run/src/game/Stage.ts:7`.
- `npm run build --workspace @fabrikav2/marble_run`: passed.
- `npx playwright test tests/e2e/menu-clicks.spec.ts tests/e2e/real-clicks.spec.ts`: blocked before app load by Chromium launch permission failure.
- `npx playwright test tests/e2e/menu-clicks.spec.ts tests/e2e/real-clicks.spec.ts --browser=webkit`: blocked before app load by WebKit abort.
- `npx eslint .`: not a valid repo command here; root has no ESLint v9 flat config. Workspace lint scripts are the configured lint path and passed as noted above.

## Spawned Follow-Up Candidates

- Device-panel tune: adjust settings card/ribbon/button sizing only if the real device capture shows drift.
- Reference README cleanup: update `games/marble_run/refs/captures/android-basegamelab/README.md` to distinguish older `settings.png` from `settings-from-menu.png`.
