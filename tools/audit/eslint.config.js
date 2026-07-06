// Per-workspace ESLint entry for a Node tool. The shared baseline
// (configs/eslint.config.js) declares browser globals only; this CLI runs on
// Node, so the Node globals it uses are added on top. See research 10 finding 4.
import base from "../../configs/eslint.config.js";

export default [
  ...base,
  // Fixture trees are deliberate violation data (they contain planted bad code
  // the linters read as text) — not lintable source. The linters' SKIP_DIRS and
  // vitest already exclude them; eslint should too.
  { ignores: ["test/fixtures/**"] },
  {
    languageOptions: {
      globals: {
        process: "readonly",
        Buffer: "readonly",
        console: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        global: "readonly",
        URL: "readonly",
      },
    },
  },
];
