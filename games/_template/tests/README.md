# tests/

The single home for tests, split into exactly two kinds: `unit/` (vitest, run in
`npm run test:unit`) and `e2e/` (Playwright, run in `npm run test:e2e`). v1
scattered tests across five-plus locations (`src/testing/`, `tests/`,
`test-results/`, per-tool suites) — here there are two, and nothing else. Test
run artifacts (`test-results/`, snapshots-under-review) are gitignored build
output and must never be committed at the game top level.
