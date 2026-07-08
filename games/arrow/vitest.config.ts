import { defineConfig } from "vitest/config";

// Unit smoke test lives under tests/unit; co-located src *.test.ts are also
// collected. happy-dom because shell surfaces mount real DOM.
export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["tests/unit/**/*.test.ts", "src/**/*.test.ts"],
  },
});
