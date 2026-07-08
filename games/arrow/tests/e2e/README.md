# tests/e2e/

Playwright end-to-end specs (`*.spec.ts`), run by `npm run test:e2e` against the
vite dev server (see `playwright.config.ts`). `boot.spec.ts` is a real skeleton:
it loads the game and asserts the shell menu mounts. Playwright output
(`test-results/`, traces, screenshots) is gitignored — never commit run artifacts
back into the game.
