# Block Blast

`block_blast` is the v2 port of the v1 Phaser Block Blast game.

It carries the endless procedural ramp into a v2 Canvas2D game shell and adds a
20-node saga over the same dials. Keep gameplay code in `src/`, stage/content
data in `content/`, source references in `refs/`, promoted evidence in
`evidence/`, and design-owned copy, tokens, and assets in `design/`.

The harness exposes `snapshot`, primitive input verbs, deterministic
`winLevel`/`failLevel`, `driveTo`, `capture`, and analytics draining.

Useful checks:

- `npm run typecheck -w @fabrikav2/block_blast`
- `npm run test:unit -w @fabrikav2/block_blast`
- `npm run build -w @fabrikav2/block_blast`
- `npm run audit`
