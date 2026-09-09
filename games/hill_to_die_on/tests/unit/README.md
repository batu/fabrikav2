# tests/unit/

Vitest unit tests (`*.test.ts`), run by `npm run test:unit` and the repo gate.
`smoke.test.ts` boots the game headlessly (happy-dom) and asserts the kernel flow
machine plus a mounted shell screen — every game inherits it, so a fresh
`create-game` output is green from its first commit. Co-located `src/**/*.test.ts`
are also collected (see `vitest.config.ts`).
