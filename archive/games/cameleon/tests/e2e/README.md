# tests/e2e/

Manual Playwright end-to-end specs (`*.spec.ts`) against the vite dev server
(see `playwright.config.ts`). Run only when explicitly useful, from the repo root:
`npx playwright test --config games/<game>/playwright.config.ts`.

`boot.spec.ts` is a real skeleton: it loads the game and asserts the placeholder
screen mounts. Playwright output (`test-results/`, traces, screenshots) is
gitignored — never commit run artifacts back into the game.
