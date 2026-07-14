// Per-workspace ESLint entry: re-exports the single shared baseline
// (configs/eslint.config.js). This is what makes `npm run lint` real for this
// workspace and the CI `npm run lint -w <ws> --if-present` step actually run —
// previously the baseline existed but zero workspaces consumed it, so CI lint
// was a silent no-op (research 10 finding 4).
import base from "../../configs/eslint.config.js";

export default [
  ...base,
  {
    // Phaser Editor-generated TypeScript (the live editor project graph) and the
    // immutable U5 publication snapshots are validated by the phaser authoring
    // AST/manifest + provenance gates in tools/phaser-shell, NOT rewritten to
    // satisfy this game workspace's runtime-source lint rules (e.g. no-explicit-any
    // on Editor-emitted component `.ts`). They are never hand-edited, so the
    // publication snapshots in particular must never be modified to appease lint.
    ignores: [
      "authoring/phaser-editor/src/**/*.ts",
      "authoring/publications/**",
    ],
  },
];
