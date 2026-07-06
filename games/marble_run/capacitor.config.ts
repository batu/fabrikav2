import type { CapacitorConfig } from '@capacitor/cli';

// Dev/test shell: signed with the studio dev team (test-credentials decision,
// docs/DECISIONS-2026-07-06-v2-kickoff.md). Store-facing config comes with the
// SDK-wiring/native card, not this file.
const config: CapacitorConfig = {
  appId: 'com.appletolye.marblerun.dev',
  appName: 'Marble Run',
  webDir: 'dist',
};

export default config;
