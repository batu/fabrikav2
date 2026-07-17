import base from '../../configs/eslint.config.js';

export default [
  ...base,
  {
    languageOptions: {
      globals: {
        process: 'readonly',
      },
    },
  },
];
