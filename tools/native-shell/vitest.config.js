export default {
  root: new URL('.', import.meta.url).pathname,
  test: {
    include: ['test/**/*.test.mjs'],
    exclude: ['**/node_modules/**'],
  },
};
