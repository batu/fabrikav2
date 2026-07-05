# @fabrikav2/kernel

Zero-dependency runtime primitives — no DOM, no Phaser. Provides the typed event
emitter, persisted-state (guarded `localStorage` blob), seeded RNG,
responsive/safe-area helpers, and the **screen flow machine** (the open/close/back-stack
contract that `@fabrikav2/ui` screens implement). Carried from v1 core `runtime`
mostly as-is; v1's dead `shell/flow-machine.ts` is the starting point for the flow
machine, rewritten this time against real consumers. Source-shipped (`main: src/index.ts`,
no build step) — see the migration order in `docs/architecture/v2-architecture.md`.

Subpath exports: `./emitter`, `./persist`, `./rand`, `./responsive`, `./flow`. The
`./flow` machine is `@experimental` — a v1 seed with zero consumers, carried in
quarantined and slated for rewrite against the real UI consumers.
