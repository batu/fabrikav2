# Wooden Modal Backdrop Journal

## Task Snapshot

The active problem is a shared modal presentation mismatch: settings/win/fail currently use the reference blue popup and ribbon assets, but the layer behind them reads as flat purple instead of a dimmed live scene with a wooden board/tray visible behind the card.

MOBILE GAME UI/UX AUDIT - marble_run modal overlays
First 30 seconds: 4/5 - Out of scope; menu/start flow already exists and remains untouched.
Touch ergonomics: 4/5 - Existing buttons are large; this pass must preserve clickability.
HUD readability: 4/5 - HUD is not the target, but in-level settings must not hide required modal controls.
Gameplay focus: 3/5 - Current modal backdrop breaks world continuity by blanking the board behind terminal overlays.
Feedback: 4/5 - Existing transition and button feedback remain in place.
Flow momentum: 4/5 - Win/fail/settings actions are present; this pass must not change flow.
Responsive canvas: 3/5 - Phone viewport screenshots are required because modal framing is size-sensitive.
Evidence: 2/5 - Baseline refs exist, but this pass still needs current before/after phone-sized screenshots.

Priority fixes:
1. Reveal the dimmed scene behind ModalShell instead of painting an opaque purple scrim.
2. Add an asset-driven wood board layer behind the modal card.
3. Verify settings/win/fail at a phone viewport with real rendered controls.

## Iteration 1

Planned result: Add a shell-level board element behind the modal card, feed it from Marble Run's design assets, and switch Marble Run's overlay scrim to translucent dimming.

Capture setup: Playwright Chromium, `405x900`, Vite dev server; targets are menu settings, in-level settings, win, and fail.

Pre-change evidence: Blocked in this worker. Vite launched at `http://127.0.0.1:5210/`, but Playwright Chromium and WebKit both aborted under the macOS sandbox before opening a page. Chromium failed with `MachPortRendezvousServer ... Permission denied`; WebKit failed with `Abort trap: 6`. No baseline screenshots were written.

Change explanation: Added an optional `backplateImage` / `backplateClassName` layer to `mountModalShell` and forwarded it through `mountResultCard`. Marble Run now imports the legacy `marble-shadow-tile.png` texture through `assetUrls.modalBackplate`, passes it to settings and result modals, and styles it as a brown board behind the blue popup. The scrim token changed from opaque purple to `rgba(31, 24, 46, 0.62)`, so the live/menu scene can show through dimly.

Post-change evidence: Screenshot capture remains blocked by the local browser sandbox. Command verification passed:
`npm run typecheck --workspace @fabrikav2/ui`;
`npm run test:unit --workspace @fabrikav2/ui -- ModalShell ResultCard`;
`npm run typecheck --workspace @fabrikav2/marble_run`;
`npm run test:unit --workspace @fabrikav2/marble_run -- App.settings-actions App.drive-to`;
`npm run build --workspace @fabrikav2/marble_run`;
`npm run lint --workspace @fabrikav2/ui`;
`npm run lint --workspace @fabrikav2/marble_run`.

Acceptance check: Criterion 1 code-level partial, because the scrim is now translucent but no rendered screenshot was possible here. Criterion 2 code-level partial, because settings/win/fail now receive a board layer but need device/browser capture. Criterion 3 met by package API: assets are injected by the game and the shared package has no game asset paths. Criterion 4 partially met by unit/real wiring checks and lint/build, but rendered clickability still needs browser/device proof.

Decision: partial.

Next action: Advance to the next pipeline stage for visual/device verification; the later worker must run the required real-device panel capture.
