// Per-workspace ESLint entry: re-exports the single shared baseline
// (configs/eslint.config.js). This is what makes `npm run lint` real for this
// workspace and the CI `npm run lint -w <ws> --if-present` step actually run —
// previously the baseline existed but zero workspaces consumed it, so CI lint
// was a silent no-op (research 10 finding 4).
import base from "../../configs/eslint.config.js";

export default [
  ...base,
  {
    files: ["content/level-tools/**/*.{js,mjs,mts,ts}"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        URL: "readonly",
        process: "readonly",
      },
    },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["content/level-tools/gallery/server/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
