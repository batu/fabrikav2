# tests/

The single home for tests, split into exactly two kinds: `unit/` (vitest, run in
`npm run test:unit`) and `e2e/` (Playwright, run in `npm run test:e2e`). The
Playwright suite is browser-smoke only: it can prove the scaffold boots in a
desktop browser, but it is not mobile close-out proof.

Mobile-game close-out is device-first. Use `npm run verify-device -- --game
<game>` and commit the resulting on-device capture/evidence when a card changes
mobile runtime behavior; browser smoke, simulator output, or passing unit tests
must not be reported as device verification.

v1 scattered tests across five-plus locations (`src/testing/`, `tests/`,
`test-results/`, per-tool suites) — here there are two, and nothing else. Test
run artifacts (`test-results/`, snapshots-under-review) are gitignored build
output and must never be committed at the game top level.
