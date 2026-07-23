import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit smoke test lives under tests/unit; co-located src *.test.ts are also
// collected. happy-dom because the placeholder screen mounts real DOM.
// AdMob alias mirrors vite.config.ts: the SDK package's optional native import
// resolves to a web stub so tests never require the native-only plugin.
const admobStub = fileURLToPath(new URL("./src/sdk/shims/capacitor-community-admob.ts", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@capacitor-community/admob": admobStub } },
  test: {
    environment: "happy-dom",
    include: ["tests/unit/**/*.test.ts", "src/**/*.test.ts"],
  },
});
