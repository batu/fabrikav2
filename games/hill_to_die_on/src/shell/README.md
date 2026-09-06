# src/shell/

`HillShell.ts` displays the simulation's home/combat/card/ready/result states,
creates buttons with `@fabrikav2/ui`, and owns the floating aim joystick. It
pauses on backgrounding and updates HUD text at 10 Hz. Palette values live in
`design/tokens.css`; critical action copy lives in `design/ui-copy.ts`.

`harness.ts` implements the shared testkit contract. Its goal methods make one
bounded action per call and cannot fabricate completed waves. Native XCTest
reads shared accessibility markers and performs actual screen taps and drags.
