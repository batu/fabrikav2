# Tap Ten

Tap Ten is the second v2 game scaffolded via `npm run create-game -- tap_ten`.
It exists to prove the platform is game-agnostic beyond `marble_run`.

The game is intentionally tiny: start a level, tap the lit tile ten times to
win, or tap the wrong tile three times to fail. The shell consumes
`@fabrikav2/kernel`, `@fabrikav2/ui`, `@fabrikav2/sdk`, and
`@fabrikav2/testkit`; the debug harness exposes `snapshot`, primitive `verbs`,
solver-bound `winLevel` / `failLevel`, `driveTo`, `capture`, and
`drainEvents`.

Useful checks:

- `npm run typecheck -w @fabrikav2/tap_ten`
- `npm run test:unit -w @fabrikav2/tap_ten`
- `npm run build -w @fabrikav2/tap_ten`
- `npm run audit`

The committed Playwright spec in `tests/e2e/boot.spec.ts` drives the browser
harness through all six canonical states and calls `capture()`. It is a manual
browser diagnostic, not default worker verification; run it only on a host where
Playwright can launch browsers:
`npx playwright test --config games/tap_ten/playwright.config.ts`.
