import { defineConfig } from "vitest/config";

// Unit and runtime integration tests mount the functional DOM shell in happy-dom.
export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["tests/unit/**/*.test.ts", "tests/runtime/**/*.test.ts", "src/**/*.test.ts"],
  },
});
