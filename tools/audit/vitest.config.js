import { defineConfig } from 'vitest/config';

// Scope the run to this workspace's own tests. Fixture trees under test/fixtures
// are read as text by the linters, never imported, so they are excluded from
// collection.
export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    exclude: ['**/node_modules/**', '**/fixtures/**'],
  },
});
