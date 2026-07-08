// Capacitor native-shell config skeleton. Typed inline so the template carries
// no build-time dependency on @capacitor/cli; a real native port swaps this for
// `import type { CapacitorConfig } from '@capacitor/cli'`. The actual native
// project (ios/ or android/) is generated on demand, never committed here — see
// native-resources/README.md.
const config = {
  appId: "com.basegamelab.arrow.dev",
  appName: "Arrow",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
