import base from '../../configs/eslint.config.js';

export default [
  ...base,
  {
    languageOptions: {
      globals: {
        AbortSignal: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        process: 'readonly',
      },
    },
  },
];
