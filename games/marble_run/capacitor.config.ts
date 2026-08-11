// Capacitor native-shell config skeleton. Typed inline so the template carries
// no build-time dependency on @capacitor/cli; a real native port swaps this for
// `import type { CapacitorConfig } from '@capacitor/cli'`. The actual native
// project (ios/ or android/) is generated on demand, never committed here — see
// native-resources/README.md.
import { computeIncludePlugins } from "./src/sdk/includePlugins";
import { loadCapacitorSyncEnv } from "./src/sdk/capacitorSyncEnv";

const syncEnv = loadCapacitorSyncEnv(process.env, process.cwd());

const config = {
  appId: "com.basegamelab.marblerun",
  appName: "Marble Run",
  webDir: "dist",
  // Explicit native plugin allowlist. @capacitor-firebase/analytics configures
  // Firebase at boot (crashing when no config ships), so it is included ONLY when
  // the Firebase env config is present at sync time. Run ios:sync/android:sync
  // with the same env as the build so this check matches the shipped bundle.
  includePlugins: computeIncludePlugins(syncEnv),
  ios: {
    // Keep the WKWebView scroll view from applying automatic safe-area content
    // insets. The game owns safe-area rhythm through CSS env(...) probes and
    // Phaser's frozen viewport constants, so native inset adjustment must stay
    // pinned at the Capacitor config level.
    contentInset: "never",
    // The publisher reported that in-game windows — and the whole background —
    // could be dragged. CSS cannot fix that: it is the WKWebView's own
    // UIScrollView panning/bouncing the document, which `position: fixed` on
    // body and `touch-action` on the modal layer do not touch. This sets
    // UIScrollView.isScrollEnabled = false. The game never scrolls the
    // document (the shop scrolls its own inner element), so nothing legitimate
    // depends on it.
    scrollEnabled: false,
  },
};

export default config;
