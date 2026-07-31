# refs/ — HUMAN SEAM

Human-provided reference material: inspiration art, competitor screenshots,
video captures, hand-written design notes. **Agents read from `refs/` but never
clean, rewrite, ship, or delete it** — it is a human input surface, not agent
output. Nothing here is bundled into the game; shippable design assets live in
`design/assets/`. Organized into `art/`, `video/`, and `notes/`.

## Generated asset normalization

Normalize generated PNGs before review-sheet composition or runtime wiring:

1. Crop to pixels with alpha >= 8.
2. Retain 4 px of transparent safety padding for antialiased edges.
3. Write the same normalized bytes to the design, source, and runtime paths in
   `design/asset-identity.json`.
4. Validate transparency and inspect the asset in its real UI slot.

Crop before composition; position from rendered pixels, not from the source
canvas.
