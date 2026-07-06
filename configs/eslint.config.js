// Shared ESLint flat config for all fabrika v2 workspaces.
//
// Consume from a workspace's own eslint.config.js:
//   import base from "../../configs/eslint.config.js";
//   export default [...base, /* workspace-specific overrides */];
//
// This is the single lint baseline (one eslint major, pinned at root) — v1
// drifted across per-game configs (docs/research/06-shared-package-audit.md §3).
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "**/design/**", "android/**", "ios/**", "**/.work/**", "**/test-results/**", "**/evidence/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        performance: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
