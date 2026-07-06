import type { CapacitorConfig } from '@capacitor/cli';

// Dev/test shell: signed with the studio dev team (test-credentials decision,
// docs/DECISIONS-2026-07-06-v2-kickoff.md). Store-facing config comes with the
// SDK-wiring/native card, not this file.
const config: CapacitorConfig = {
  appId: 'com.appletolye.marblerun.dev',
  appName: 'Marble Run',
  webDir: 'dist',
  plugins: {
    // StatusBar: light-content text (white glyphs read on the purple theme —
    // the reference shows dark glyphs, low-contrast, N5) + overlaysWebView so
    // the webview draws full-bleed under the bar and the top chrome owns the gap
    // via the --fab-safe-top (env(safe-area-inset-top)) insets added this card.
    //
    // NOTE: this block is INERT until @capacitor/status-bar is added as a
    // dependency and a runtime init calls StatusBar.setStyle/setOverlaysWebView.
    // The plugin is NOT yet installed (only @capacitor/core + haptics ship
    // today), and adding a native dependency + the iOS platform belongs to the
    // SDK-wiring/native card, not this design-layer fix. Capacitor ignores
    // config for uninstalled plugins, so this is safe forward-looking intent.
    StatusBar: {
      style: 'LIGHT',
      overlaysWebView: true,
    },
  },
};

export default config;
