# src/game/

The gameplay layer — the one maximally free part of the codebase. Put the canvas
engine, scenes, systems, and mechanics here (Phaser, Three.js, or Canvas2D). It
may read `game.config.ts` and emit lifecycle events into the kernel flow machine,
but it must not implement meta-UI (menus, shop, settings, win/lose) — that lives
in the shared DOM shell (`@fabrikav2/ui`), consumed via `src/shell/`.
