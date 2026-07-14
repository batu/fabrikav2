// Per-workspace ESLint entry for the Phaser lane authoring/publisher tooling.
// The shared baseline (configs/eslint.config.js) declares browser globals; this
// package is Node tooling (deterministic authoring + publisher CLI) plus a small
// browser-side render-proof harness, so both global sets are declared. Mirrors
// tools/verify-gate and tools/verify-device.
import base from "../../configs/eslint.config.js";

export default [
  ...base,
  {
    ignores: ["**/node_modules/**", "**/fixtures/**/*.scene", "**/dist/**"],
  },
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
        URLSearchParams: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        fetch: "readonly",
      },
    },
  },
];
