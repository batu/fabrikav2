# games/

One workspace per game (`games/<name>/`, matched by the `games/*` npm-workspace glob).
Each game is gameplay canvas plus declarative config, nothing more: `src/` holds gameplay
only (Phaser, Three.js, or Canvas2D — the substrate is free); `game.config.ts` declares the
screens used, saga shape, economy, ad placements, product catalog, and analytics events
that the DOM shell consumes (the game never touches shell internals); and `design/` holds
the **generated, git-committed, never hand-edited** `tokens.css` / `copy.ts` / `assets.ts`
produced by the design-sheets round-trip.

`_template/` is the canonical skeleton (every dir carries a README stating its contract,
including the human seams `refs/`, `evidence/`, `.work/`); it is a real workspace so the
gate keeps it green. Real games are added by `npm run create-game -- <name>`, which copies
`_template` and substitutes the name. A game's top-level shape is enforced by the audit
`structure` linter against the `_template` whitelist. The pilot port is marble_run
(sugar3d). See `docs/architecture/v2-architecture.md` §games/<name>.
