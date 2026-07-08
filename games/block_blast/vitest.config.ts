import { defineConfig } from "vitest/config";

// Unit smoke tests live under tests/unit; co-located src *.test.ts are also
// collected. happy-dom because the shell mounts real DOM.
export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["tests/unit/**/*.test.ts", "src/**/*.test.ts"],
  },
});
