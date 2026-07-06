# Touch Layout And HUD

## Phone Layout

- Design the first pass for the smallest supported phone, then verify larger phones/tablets.
- Keep primary touch targets at least 44 CSS pixels, larger for fast action games.
- Keep destructive or secondary actions away from primary tap lanes.
- Leave safe-area room for notches, home indicators, browser chrome, and Capacitor status bars.
- Test portrait and landscape only when both are intentionally supported. If only one orientation is supported, make that explicit.

## Thumb Zones

- Put frequent actions near natural thumb reach.
- Put low-frequency controls in corners only if they are not needed during high-pressure play.
- Avoid narrow vertical stacks of small controls near screen edges.
- Avoid gestures that conflict with browser back, system home, or scroll unless the app is wrapped and tested.

## HUD

- HUD state must answer: Where am I? How am I doing? What can I do next?
- Do not cover the object the player must inspect, aim at, drag, or tap.
- Group related state: lives/hearts, currency, timer, level, settings.
- Use stable dimensions for HUD elements so score changes, timers, labels, and icons do not shift layout.
- Use icon buttons for common game actions where icons are standard, with accessible labels/tooltips where relevant.

## Canvas And DOM Overlay

- If gameplay is canvas/WebGL, decide which UI belongs in-engine and which belongs in DOM.
- Keep coordinate transforms explicit when DOM overlays refer to canvas objects.
- For Phaser/Canvas games, validate at real device DPR. CSS-correct layout can still produce blurry or oversized render targets.
- For overlays on camera/video, place graphics relative to the scene composition, not an abstract centered web layout.

## Common Failure Patterns

- Desktop-centered HUD copied to mobile.
- Menu cards that look polished but slow the path to play.
- Timer/score readable on desktop but tiny on phone.
- Button labels that wrap unpredictably in Turkish or long localized strings.
- Touch zones that move when score/timer text changes.
