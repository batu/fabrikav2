# Wooden Modal Backdrop Task Pack

Status: active

Goal: Reference settings, win, and fail modals should sit over a visible brown board/tray layer while the live game scene remains dimly visible behind the dialog.

Why now: Fidelity panel findings repeatedly call out flat purple behind the shared modal shell and missing wood behind result/settings cards.

User lens: A phone player should read the modal as part of the Marble Run board world, not as a detached web dialog.

Pre-shot targets: menu settings, in-level settings, win result, fail result at a phone viewport.

Repro setup: Vite dev server for `games/marble_run`, Playwright Chromium, viewport `405x900`, harness states `settings`, `level` plus pause settings, `win`, and `fail`.

Acceptance criteria:
- The modal scrim is translucent enough that the live/menu scene remains visible behind the dialog.
- Win/fail and in-level settings show a brown wooden board/backing behind the blue popup card edges.
- The shared `@fabrikav2/ui` modal shell stays token/asset driven; no game asset paths or literal game colors leak into the package.
- Modal controls remain clickable and visible at phone size.

Expected visual result: The blue popup card and ribbon remain unchanged, but sit in front of a darker wood layer; the purple background or game scene is dimmed, not replaced.

Constraints: Do not change gameplay rules, scoring, win/fail timing, economy, or ad behavior.

Out of scope: Full result-card scaling/alignment parity, emoji replacement, button text sprite swaps, and real-device close-out.

Verification: Unit/type checks plus phone-sized Playwright screenshots of the affected modal states. Real-device verification remains for the later pipeline stage.

Spawn rules: If screenshots expose unrelated layout drift, record it as a follow-up rather than expanding this task.
