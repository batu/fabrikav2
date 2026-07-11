import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/render/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
