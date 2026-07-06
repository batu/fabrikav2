# Onboarding And Feedback

## First-Run Flow

- The player should know the goal within 5 seconds.
- The first meaningful action should be available without reading a paragraph.
- Teach with the actual controls and first level, not a detached instruction wall.
- Put detailed help behind a tutorial/help button when the game is for repeated play or a party host.
- For party or shared-screen games, optimize for host control and spectator readability.

## Feedback Minimums

Every action needs one or more immediate responses:

- visual state change
- short motion
- sound or haptic where available
- blocked-action explanation
- score/resource change

Use feedback to confirm intent, not to decorate. A button press should depress, a correct action should land, a wrong action should explain, and a transition should show where the player went.

## Game Feel

- Add juice after controls and readability are correct.
- Prefer short, crisp motion for mobile. Long animations block repeated play.
- Match feedback intensity to consequence: small tap, medium collect, large win/fail.
- Provide reduced-motion fallback for DOM-heavy interfaces when practical.
- Unlock Web Audio on the first user gesture before relying on sound.

## Win, Fail, Continue

- Make retry/next-level the most reachable path after fail/win.
- Do not strand players in modal stacks.
- When ads or rewarded continues exist, separate "real ad flow" from mock/dev flow in copy and tests.
- Preserve momentum: fail -> learn -> retry should take seconds, not navigation.
