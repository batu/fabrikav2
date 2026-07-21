// Capacitor native-shell config skeleton. Typed inline so the template carries
// no build-time dependency on @capacitor/cli; a real native port swaps this for
// `import type { CapacitorConfig } from '@capacitor/cli'`. The actual native
// project (ios/ or android/) is generated on demand, never committed here — see
// native-resources/README.md.
const config = {
  appId: "com.basegamelab.marblerun",
  appName: "Marble Run",
  webDir: "dist",
  ios: {
    // Keep the WKWebView scroll view from applying automatic safe-area content
    // insets. The game owns safe-area rhythm through CSS env(...) probes and
    // Phaser's frozen viewport constants, so native inset adjustment must stay
    // pinned at the Capacitor config level.
    contentInset: "never",
  },
};

export default config;
