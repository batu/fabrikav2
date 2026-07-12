# U6 conductor runbook — Android WebView boot over adb reverse

Conductor-run on the Ubuntu ADB host (plan U6). The worker cannot reach the
device from the macOS worktree; an unreachable device lane is recorded as
`blocked` in `report/report.json`, never converted to a pass.

## Steps

1. Sync this fixture directory to the Ubuntu host (rsync the fixture only;
   `node_modules/`, `dist/`, `android/` excluded — they are regenerated).
2. `npm ci` inside the fixture, then `npm run build` (dist/ appears).
3. Serve the built bundle on the fixed probe port:
   `npx vite preview --port 8843 --strictPort`
4. Connect the phone, then: `adb reverse tcp:8843 tcp:8843`
5. Generate the throwaway native project (never committed):
   `npx cap add android && npx cap sync android`
6. Install and boot: `npx cap run android --target <device>` (or
   `cd android && ./gradlew installDebug` + launch the
   `com.basegamelab.phaser_feasibility.dev` main activity).
7. Wait for the probe scene, then capture host-side evidence:
   - `adb exec-out screencap -p > evidence/device/boot.png`
   - `adb logcat -d | grep -iE 'webgl|chromium|console' > evidence/device/logcat-webgl.txt`
     (scrub any device serial before committing)
8. Fill `evidence/device/device-boot.json`:

```json
{
  "timestamp": "<iso8601>",
  "deviceProfile": { "model": "<model name only, no serial>", "androidVersion": "<v>", "webviewVersion": "<v>" },
  "transport": "adb reverse tcp:8843",
  "screenshot": "evidence/device/boot.png",
  "logcat": "evidence/device/logcat-webgl.txt",
  "sentinelVisible": true,
  "webglContextCreated": true,
  "verdict": "pass"
}
```

## Pass criteria (AE4)

- The screenshot shows the rendered probe scene sentinel `PROBE-43QVBIH7`
  drawn by the Phaser 4 WebGL canvas — a blank/black WebView is a fail.
- Logcat shows no WebGL context-creation failure.
- The generated `android/` tree stays untracked (`git status` clean).

After the run, update `report/report.json` acceptance
`android-webview-boot` (pass with the two evidence pointers, or the honest
`no-go`/`blocked`), re-run `node scripts/hash.mjs`, and re-run verify.
