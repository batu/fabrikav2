# @fabrikav2/grapes-shell

Constrained GrapesJS editor and immutable portable publisher for the `dom-css`
lane of the dual-design-frontends experiment.

The editor exposes only the frozen shell pages, semantic layers, supported
presentation properties, and slot-compatible assets. It validates through the
kernel's shell-presentation-v2 contract; raw HTML/CSS editing and unconstrained
GrapesJS panels are not part of the authoring surface. Publication is one-shot
and content-addressed: callers must provide the reviewed project and asset-catalog
hashes, and divergent inputs fail before any publication bytes are written.

Useful commands:

```sh
npm run dev -w @fabrikav2/grapes-shell
npm run typecheck -w @fabrikav2/grapes-shell
npm run test:unit -w @fabrikav2/grapes-shell
npm run test:render -w @fabrikav2/grapes-shell
npm run build -w @fabrikav2/grapes-shell
node tools/grapes-shell/cli.mjs --help
```

Lane ownership and cross-lane exclusions remain defined in
`experiments/design-frontends/fences.json`.
