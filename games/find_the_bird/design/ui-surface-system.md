# Cozy Garden 3D UI surface system

The original Cozy Garden set established characters and icons but left many
large UI areas as unrelated CSS gradients. The runtime now uses a small surface
kit so every screen can share the same materials without baking English text
into dozens of one-off bitmaps.

## Source materials

- `canvas-cream`: quiet woven canvas for panel interiors and page bodies.
- `painted-olive`: sage painted wood for secondary and navigation surfaces.
- `wood-honey`: warm carved wood for panel rims, saga paths and trays.
- `painted-sky`: deterministic sky-blue tint derived from painted olive for
  primary actions.

The three authored source paintings are retained in `design/source-textures/`.
`scripts/build_ui_surfaces.py` converts them into exact 256 px seamless tiles.
The mirroring construction makes opposite edges pixel-identical rather than
trusting a model's claim that an image is tileable.

## Nine-slice contract

`design/ui-surfaces.json` is authoritative for slice insets, source dimensions,
runtime URLs and hashes. Nine-slice frames have transparent centers; the
component supplies its live, repeating texture beneath the border. This keeps
corners stable at arbitrary aspect ratios and avoids stretching the woven or
painted material.

Text, prices, accessibility labels and button states remain semantic HTML.
Generated art supplies material and ornament, not language.

## Coverage target

The shared kit must cover:

- Settings page shell, rows, toggles and Restore/Privacy footer actions.
- Shop header, featured cards, section headers, product cards and price buttons.
- Home saga support surfaces, Play Now and bottom navigation.
- Achievements cards, unavailable states and progress surfaces.
- Pause, fail and level-complete cards and their action buttons.
- HUD pills and reusable modal/card containers.

Icons and product illustrations remain individual assets because their
silhouettes carry meaning. Background divs and button bodies must use this
surface kit unless a documented visual exception is necessary.
