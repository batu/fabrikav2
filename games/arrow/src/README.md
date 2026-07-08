# src/

Game code, and only game code. `main.ts` is the browser entrypoint: it boots the
kernel screen-flow machine and mounts the shell. `game/` holds the gameplay
canvas (Phaser / Three.js / Canvas2D — the substrate is free); `shell/` holds the
thin DOM glue between the game and `@fabrikav2/ui`. The game consumes the DOM
shell through `game.config.ts` and never reaches into shell internals.
