# Settings Rebuild Local Visual Review Task Pack

## Task: Settings Modal Reference Rebuild

Status: partial

Goal: Rebuild Marble Run settings to match `games/marble_run/refs/captures/android-basegamelab/settings-from-menu.png`.

Why now: Trello card YXyPXZKs identifies settings as the largest remaining fidelity win after the panel report.

User lens: A phone player opening the gear from the menu should see the same candy-popup language as the Android reference, not a beige modal with a generic close button and reset link.

Pre-shot targets: Authoritative reference image at `games/marble_run/refs/captures/android-basegamelab/settings-from-menu.png`; live pre-change screenshot was not captured in this worker because browser launch is blocked in the host.

Repro setup: Marble Run menu, portrait phone viewport or real device, tap top-right settings gear.

Acceptance criteria:

- Orange `SETTINGS` ribbon using the exported orange ribbon art.
- Blue top-right X close button.
- RESTART yellow button and HOME green button replace the old CLOSE button and Reset Progress link.
- Three settings rows are light blue/white with dark navy labels.
- Toggles are large glossy green switches.
- Popup card uses the blue rounded reference panel over a dimmed scene.
- Restart from menu settings starts the current level; Home from paused settings returns to menu.

Constraints:

- Preserve the existing settings persistence path for music, sfx, and haptics.
- Do not add gameplay-state changes beyond restart/home navigation.
- Real-device verification is reserved for the conductor panel run per the card comment.

Out of scope:

- Updating the older `settings.png` reference README text.
- Rebuilding non-settings overlays.
- Device capture in this worker; this sandbox has no device and browser launch is blocked.

Verification:

- Static checks, unit tests, typecheck, audit, lint, and production build.
- Browser real-click specs were attempted in Chromium and WebKit but both engines failed before app code ran due host browser-launch restrictions.

Spawn rules:

- If device panel shows layout drift, fix only settings sizing/spacing first.
- If restart/home behavior fails on device, route to `App.openSettings()` action wiring.
