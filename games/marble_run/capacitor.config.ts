// Capacitor native-shell config skeleton. Typed inline so the template carries
// no build-time dependency on @capacitor/cli; a real native port swaps this for
// `import type { CapacitorConfig } from '@capacitor/cli'`. The actual native
// project (ios/ or android/) is generated on demand, never committed here — see
// native-resources/README.md.
import { computeIncludePlugins } from "./src/sdk/includePlugins";

const config = {
  appId: "com.basegamelab.marblerun",
  appName: "Marble Run",
  webDir: "dist",
  // Explicit native plugin allowlist. @capacitor-firebase/analytics configures
  // Firebase at boot (crashing when no config ships), so it is included ONLY when
  // the Firebase env config is present at sync time. Run ios:sync/android:sync
  // with the same env as the build so this check matches the shipped bundle.
  includePlugins: computeIncludePlugins(process.env),
  ios: {
    // Keep the WKWebView scroll view from applying automatic safe-area content
    // insets. The game owns safe-area rhythm through CSS env(...) probes and
    // Phaser's frozen viewport constants, so native inset adjustment must stay
    // pinned at the Capacitor config level.
    contentInset: "never",
  },
};

export default config;
