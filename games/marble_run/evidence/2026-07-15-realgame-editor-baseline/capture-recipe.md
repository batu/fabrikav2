# Foreground-bound physical Android capture recipe

Set `ADB=/home/batu/android-sdk/platform-tools/adb`, `SERIAL=27091JEGR22183`,
and `PKG=com.appletolye.marblerun.dev` on `ubuntu-server`.

For **every** navigation action and screenshot, run this guard both before and
after the operation and reject the frame unless it reports Marble Run:

```sh
set -eu

foreground() {
  "$ADB" -s "$SERIAL" shell dumpsys window windows \
    | sed -n '/mCurrentFocus/p' | head -1
}
assert_marble_foreground() {
  foreground | grep -F 'com.appletolye.marblerun.dev/.MainActivity' >/dev/null || {
    echo 'capture rejected: Marble Run is not the foreground package' >&2
    return 1
  }
}

assert_marble_foreground &&
  "$ADB" -s "$SERIAL" shell input tap "$X" "$Y" &&
  sleep 4 &&
  assert_marble_foreground &&
  "$ADB" -s "$SERIAL" exec-out screencap -p > "$STATE.png" &&
  assert_marble_foreground
```

Before the sequence, pull the installed APK and record its byte identity:

```sh
APK=$("$ADB" -s "$SERIAL" shell pm path "$PKG" | head -1 | sed 's/^package://')
"$ADB" -s "$SERIAL" pull "$APK" /tmp/marble-run.apk
sha256sum /tmp/marble-run.apk
```

Also record invocation UTC time, device properties, physical size/density,
package version, activity, intended source SHA, build/install command, and each
PNG hash. An APK hash proves installed-byte continuity; it does not prove a git
SHA unless the build emits and records that binding.

## State routes and hard caveat

Capture menu, menu settings, Shop, gameplay HUD, pause, and level settings by
real visible controls. Do not press Android Back in Shop: current behavior exits
Marble Run and may expose a different app underneath. A Shop screenshot is
accepted only while the guard passes immediately before and after capture.

Win, fail, and finale remain required editor targets. Reach them through a real
deterministic harness or gameplay route; otherwise leave them blocked. Never use
blind taps, browser images, old evidence, or another package to fill a gap.
