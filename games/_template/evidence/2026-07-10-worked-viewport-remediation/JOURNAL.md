# Worked-stage template viewport remediation journal

This journal records a browser diagnostic for the editor-neutral template shell. It is not physical-device proof and does not satisfy the later Android/iPhone in-situ gate.

## Capture provenance

- Baseline: unrestricted Chromium run at a 390 x 844 viewport before the remediation. The default 8 px body margin made the rendered document 860 px tall, so the committed `baseline-*.png` files are 390 x 860.
- After: conductor-run unrestricted Chromium capture against the final dirty source at a 390 x 844 viewport. The committed `after-*.png` files are 390 x 844.
- After-state measurements in all six states: `documentScrollHeight = 844`, `bodyScrollHeight = 844`, and computed body margin `0px`.
- All required visible controls measured at least 48 px in both dimensions.
- Real-click sequence passed: Play -> Pause -> Settings -> Back -> Resume -> Win -> Home -> Play -> Lose.

The managed worker sandbox could not launch a browser, so the conductor ran the same diagnostic from its unrestricted context. The screenshots and measurements below are attributed to that run; they remain browser-only evidence.

## Summary

| Task | Result | Before | After |
| --- | --- | --- | --- |
| T1 Remove viewport overflow | passed | [menu](./baseline-menu.png), [level](./baseline-level.png) | [menu](./after-menu.png), [level](./after-level.png) |
| T2 Restore action contrast | passed | [pause](./baseline-pause.png), [settings](./baseline-settings.png) | [pause](./after-pause.png), [settings](./after-settings.png) |
| T3 Keep the fail exit readable | passed | [fail](./baseline-fail.png), [win control](./baseline-win.png) | [fail](./after-fail.png), [win control](./after-win.png) |

## T1 - Remove viewport overflow

**Status: passed**

The template host resets the body margin and gives `body` and `#app` a viewport-height floor. The final menu and gameplay captures fill the 390 x 844 frame without the baseline gutter. Both measured document and body scroll heights equal the 844 px viewport, and the body margin is `0px`.

Acceptance:

- App surface no taller than the viewport: passed.
- No default document-margin gutter: passed.
- Existing shell navigation preserved: passed through the real Play click and the complete click sequence above.

## T2 - Restore navigation-action contrast

**Status: passed**

Template-local semantic surfaces now give the Home Settings control, gameplay Pause control, Pause actions, and Settings Back icon reliable contrast without changing shared UI behavior. The final Pause capture shows all three actions, and the final Settings capture shows the Back icon on its contrasting circular surface.

Acceptance:

- Home Settings, gameplay Pause, and Pause actions visibly contrast: passed.
- Required controls remain at least 48 px: passed by measured geometry.
- Settings Back is visible and returns to Pause: passed through real Settings -> Back and Resume clicks.

## T3 - Keep the fail exit readable

**Status: passed**

The template no longer stretches an action sprite across the result card. The compact result body uses an existing semantic surface, while Retry and Home retain their dedicated actions. The final Fail capture shows both exits clearly, and the click sequence confirms Lose is reachable after returning Home and starting again.

Acceptance:

- Readable result surface without a stretched button sprite: passed.
- Retry and Home visible, distinct, and at least 48 px: passed.
- Lose flow remains reachable without altering the shell state contract: passed by real-click traversal and unit coverage.

## Verification boundary

These captures prove the requested browser-level layout and click diagnostics only. Physical Android/iPhone rendering, safe areas, fonts, touch behavior, and performance remain unverified at this Worked stage and must be handled by the later in-situ card/stage.
