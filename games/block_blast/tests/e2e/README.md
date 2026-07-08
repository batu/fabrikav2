# tests/e2e/

Playwright end-to-end specs (`*.spec.ts`), run by `npm run test:e2e` against the
vite dev server (see `playwright.config.ts`). `boot.spec.ts` loads the game,
checks the visible shell, and drives the harness to the level state. Playwright output
(`test-results/`, traces, screenshots) is gitignored — never commit run artifacts
back into the game.
