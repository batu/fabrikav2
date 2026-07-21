import base from '../../configs/eslint.config.js';

export default [
  ...base,
  {
    languageOptions: {
      globals: {
        Headers: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
      },
    },
  },
];
