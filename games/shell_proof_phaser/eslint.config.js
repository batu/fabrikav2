// Per-workspace ESLint entry: re-exports the single shared baseline
// (configs/eslint.config.js). This is what makes `npm run lint` real for this
// workspace and the CI `npm run lint -w <ws> --if-present` step actually run —
// previously the baseline existed but zero workspaces consumed it, so CI lint
// was a silent no-op (research 10 finding 4).
import base from "../../configs/eslint.config.js";

export default [
  ...base,
  {
    // Phaser Editor emits this component bridge with `any` at its engine
    // boundary. The live generated copy and immutable publication snapshots
    // are validated by the authoring AST/manifest gates and must not be
    // hand-edited to satisfy runtime-source lint rules.
    ignores: [
      "authoring/phaser-editor/src/components/*.ts",
      "authoring/publications/*/source/components/*.ts",
    ],
  },
];
