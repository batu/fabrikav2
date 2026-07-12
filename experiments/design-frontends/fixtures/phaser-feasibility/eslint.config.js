// Standalone ESLint config on purpose: the fixture is not a root workspace
// member and must stay installable/verifiable offline from its own lockfile,
// so it does not re-export configs/eslint.config.js like workspace games do.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/", "node_modules/", "android/", "evidence/", "report/"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Editor-generated scene/component code is derived output owned by the
    // Phaser Editor scene compiler; its style is a feasibility observation,
    // not something we lint-shape.
    files: ["editor-project/src/**"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-useless-escape": "off",
    },
  },
  {
    // Node evidence tooling; editor-session.mjs also carries page.evaluate
    // callbacks that run in the workbench page (browser globals).
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
        globalThis: "readonly",
        document: "readonly",
        Event: "readonly",
      },
    },
  },
  {
    // Runs inside the Phaser Editor workbench page.
    files: ["editor-plugins/**/*.js"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        Event: "readonly",
        HTMLTextAreaElement: "readonly",
        HTMLInputElement: "readonly",
      },
    },
  }
);
