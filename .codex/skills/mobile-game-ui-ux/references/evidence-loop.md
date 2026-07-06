# Evidence Loop

## Mode-Aware Evidence Ladder

Choose the lightest evidence mode that honestly proves the UI/UX change:

### Human-Present / Batu-Driving

Use when Batu is actively watching, steering, or validating a small UI/UX tweak.
Minimum acceptable proof:

- phone screenshot, phone-sized browser screenshot, or live preview of the changed surface
- a behavior check for the touched action, or explicit user feedback that the change is accepted
- a short note naming the device/viewport and any gaps

This mode makes fast human validation legitimate. It does not require a real-device run for every small copy, spacing, color, or layout tweak when the user is directly validating the result.

### TWF / Unattended

Use when an agent is declaring mobile game UI/UX work done without live user validation.
Minimum acceptable proof:

- phone-sized screenshot of the affected surface
- behavior proof for the touched flow: Playwright mobile tap, canvas pointer event, video, or equivalent command output
- for UI/control changes, the proof must exercise the rendered input path; direct state mutation or scene-start shortcuts are acceptable only as setup or for non-input behavior, not as the behavior proof itself
- explicit gaps for untested devices, orientation, audio, or release-only surfaces

This mode prevents fake UI/UX completion: a desktop screenshot or typecheck alone is not enough.

### Release / Device-Sensitive

Use before release, or when the change can differ between browser emulation and mobile runtime.
Require real-device proof when the change touches:

- safe area, notch, browser chrome, or WebView viewport behavior
- touch feel, drag/swipe responsiveness, or multi-touch behavior
- animation feel, frame pacing, FPS, or thermal/performance risk
- audio unlock, mute, resume, or background/foreground behavior
- Capacitor build paths, permissions, plugins, native wrappers, or build-only bugs

Playwright mobile viewport evidence can still support this mode, but it does not replace the real device for device-sensitive risks.

## Minimum Evidence

Before calling mobile game UI/UX done, capture:

- a phone-sized screenshot of the changed surface
- a behavior check for the main flow touched
- the exact command or device used
- remaining gaps or untested devices

Apply the ladder above when deciding whether this minimum evidence is enough.

## Better Evidence

Use the strongest available proof for the risk:

- Playwright mobile viewport for DOM/canvas layout and scripted flows.
- Pixel or bounding-box assertions for HUD alignment and no-overlap checks.
- Real Android device via ADB for WebView, browser chrome, safe area, keyboard, performance, and touch behavior.
- Simulator/iOS build host for iOS-specific safe-area and App Store build paths.
- Short video/GIF for motion, transitions, or game-feel changes.

## Screenshot Checklist

Capture at least the affected states:

- first screen or menu
- in-game normal state
- in-game stressed state: long label, low timer, high score, many HUD items, smallest/longest word, dense board, etc.
- win/fail/continue state when touched

For each screenshot, check:

- no overlapping text
- no critical UI outside safe areas
- controls remain tappable
- gameplay target remains visible
- score/timer/currency values do not shift layout

## Final Report Shape

Use this compact closeout:

```text
Mobile UI/UX evidence:
- Mode: <human-present/Batu-driving | TWF/unattended | release/device-sensitive>
- Surface: <HUD/menu/onboarding/etc.>
- Viewports/devices: <list>
- Commands: <commands>
- Screenshots/videos: <paths>
- Result: passed | partial | failed
- Gaps: <none or explicit remaining risk>
```
