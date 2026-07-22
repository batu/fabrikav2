// Per-workspace ESLint entry for a Node tool. The shared baseline
// (configs/eslint.config.js) declares browser globals only; this CLI runs on
// Node, so the Node globals it uses are added on top.
import base from '../../configs/eslint.config.js';

export default [
  ...base,
  {
    languageOptions: {
      globals: {
        process: 'readonly',
        URL: 'readonly',
      },
    },
  },
];
