// Throwaway dev-only Capacitor wrapper for the U6 Android WebView boot
// (plan KTD6). Disposable feasibility evidence, NOT the goal-U10 vehicle:
// the app id is probe-scoped, the dev server URL only works over
// `adb reverse tcp:8843 tcp:8843`, and the generated android/ tree is
// gitignored and never committed. Typed inline so the config carries no
// build-time dependency, mirroring games/find_the_dog/capacitor.config.ts.
const config = {
  appId: "com.basegamelab.phaser_feasibility.dev",
  appName: "Phaser Feasibility Probe",
  webDir: "dist",
  server: {
    // Reaches the host's vite preview through adb reverse; dev-only, no
    // production trust material. Delete this block for a bundled build.
    url: "http://localhost:8843",
    cleartext: true,
  },
};

export default config;
