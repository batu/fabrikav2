# tests/

The single home for tests, split into exactly two kinds: `unit/` (vitest, run in
`npm run test:unit`) and `e2e/` (manual Playwright specs). Browser e2e is kept
for explicit diagnostics. Run it from the repo root on hosts where browsers
launch: `npx playwright test --config games/find_the_dog/playwright.config.ts`.
It is not part of default game worker verification or mobile close-out proof.

Mobile-game close-out is device-first. Use `npm run verify-device -- --game
<game>` and commit the resulting on-device capture/evidence when a card changes
mobile runtime behavior; browser smoke, simulator output, or passing unit tests
must not be reported as device verification.

v1 scattered tests across five-plus locations (`src/testing/`, `tests/`,
`test-results/`, per-tool suites) — here there are two, and nothing else. Test
run artifacts (`test-results/`, snapshots-under-review) are gitignored build
output and must never be committed at the game top level.
