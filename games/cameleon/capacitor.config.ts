// Capacitor native-shell config skeleton. Typed inline so the template carries
// no build-time dependency on @capacitor/cli; a real native port swaps this for
// `import type { CapacitorConfig } from '@capacitor/cli'`. The actual native
// project (ios/ or android/) is generated on demand, never committed here — see
// native-resources/README.md.
const config = {
  appId: "com.fabrika.cameleon",
  appName: "Cameleon",
  webDir: "dist",
  ios: {
    // Keep the WKWebView full-bleed. The app layer owns safe-area consumption
    // through viewport-fit=cover plus CSS env(safe-area-inset-*) padding.
    contentInset: "never",
  },
};

export default config;
