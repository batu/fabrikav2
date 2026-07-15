import baseConfig from "../../configs/eslint.config.js";

export default [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        Buffer: "readonly",
        process: "readonly",
      },
    },
  },
];
