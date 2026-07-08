# tests/e2e/

Manual Playwright end-to-end specs (`*.spec.ts`) against the vite dev server
(see `playwright.config.ts`). Run only when explicitly useful, from the repo root:
`npx playwright test --config games/block_blast/playwright.config.ts`.

`boot.spec.ts` loads the game, checks the visible shell, and drives the harness
to the level state. Playwright output (`test-results/`, traces, screenshots) is
gitignored — never commit run artifacts back into the game.
