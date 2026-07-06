---
name: android-adb-real-device-testing
description: General real-device Android testing via ADB for web apps, WebViews, and native apps.
scope: optional
---

# Android ADB Real Device Testing

Use a connected Android device as the source of truth for mobile behavior that desktop emulation may miss. Prefer deterministic routes, package launches, and screenshot evidence over coordinate-driven ADB gestures.

## When To Use

- validating a mobile UI or UX change on a real Android phone
- reproducing viewport, keyboard, scrolling, media, touch, or rendering issues that only appear on device
- testing a localhost web app on phone with `adb reverse`
- opening a native app, activity, or browser URL on a specific device
- capturing before/after screenshots or short recordings as evidence
- diagnosing `adb devices -l` states like `unauthorized` or `no permissions`

## Preconditions

1. Require `adb` on `PATH`.
2. Run `adb devices -l` and require at least one device in `device` state.
3. Keep the phone unlocked and awake. Do not assume ADB can bypass the lock screen.
4. If more than one phone is attached, always use `-s <serial>`.
5. Decide the target state before touching the device:
   - web URL
   - native package/activity
   - current foreground screen
6. Pick an artifact path before capture.

If `adb devices -l` does not show `device`, stop and fix that first.

## Failure States

Use `adb devices -l` as the first branch:

- `device`: proceed
- `unauthorized`: unlock the phone and accept the RSA debugging prompt
- `no permissions`: this is a host USB permission problem, not a phone-settings problem
- empty list: bad cable, bad port, missing debugging authorization, or disconnected device

For host-side recovery, especially Linux `udev` issues, read [references/adb-host-troubleshooting.md](references/adb-host-troubleshooting.md).

## Default Workflow

### 1. Establish the device

```bash
adb devices -l
```

If multiple devices are attached:

```bash
adb -s <serial> devices -l
```

### 2. Open the target state

For a web app on localhost:

```bash
adb -s <serial> reverse tcp:<port> tcp:<port>
adb -s <serial> shell am start \
  -a android.intent.action.VIEW \
  -d "http://127.0.0.1:<port>/<path>" \
  com.android.chrome
```

For a native app:

```bash
adb -s <serial> shell monkey -p <package.name> 1
```

Or with an explicit activity:

```bash
adb -s <serial> shell am start -n <package.name>/<activity.name>
```

### 3. Capture baseline before changing anything

Use this before any code or config change:

```bash
adb -s <serial> exec-out screencap -p > /abs/path/to/before.png
```

Immediately describe the baseline in 3 to 6 short points:

- what screen this is
- what state the app is in
- what the user can currently see
- what looks wrong or what needs to improve
- any uncertainty about whether this is the intended screen

If the screen is not deterministic, manually put the phone in the desired state first, then use current-screen capture.

### 4. Make the change

Apply the feature, fix, or styling change outside this skill.

### 5. Reopen the same state and capture after

Use the same route, package, and phone orientation whenever possible.

```bash
adb -s <serial> exec-out screencap -p > /abs/path/to/after.png
```

Then describe the after-state in 3 to 6 short points:

- what changed
- what improved
- what stayed broken
- whether the result is closer to the target
- any residual risks

### 6. Compare before and after explicitly

Do not just attach two images. Write the delta:

- spacing/layout change
- readability change
- interaction/control change
- regressions introduced
- whether another pass is needed

If motion is part of the bug, add a short recording:

```bash
adb -s <serial> shell screenrecord --time-limit 4 /sdcard/Download/capture.mp4
adb -s <serial> pull /sdcard/Download/capture.mp4 /abs/path/to/capture.mp4
adb -s <serial> shell rm /sdcard/Download/capture.mp4
```

## Preferred Commands

List devices:

```bash
adb devices -l
```

Forward localhost to phone:

```bash
adb -s <serial> reverse tcp:<port> tcp:<port>
```

Open a browser URL:

```bash
adb -s <serial> shell am start \
  -a android.intent.action.VIEW \
  -d "http://127.0.0.1:<port>/<path>" \
  com.android.chrome
```

Capture the current screen:

```bash
adb -s <serial> exec-out screencap -p > /abs/path/to/capture.png
```

Record a short video:

```bash
adb -s <serial> shell screenrecord --time-limit 4 /sdcard/Download/capture.mp4
adb -s <serial> pull /sdcard/Download/capture.mp4 /abs/path/to/capture.mp4
adb -s <serial> shell rm /sdcard/Download/capture.mp4
```

Inspect browser pages from desktop:

- open `chrome://inspect/#devices`
- keep the phone page open
- inspect DOM, CSS, console, and network from desktop Chrome

## Rules

- Prefer `adb reverse` and `127.0.0.1` over LAN URLs.
- Prefer deterministic URLs, package launches, and app state over raw coordinate taps or swipes.
- Treat screenshots from the phone as authoritative when they disagree with desktop emulation.
- If you manually interact on the device, use current-screen capture afterward instead of pretending the state is deterministic.
- If another project or person currently owns the phone, stop using ADB and switch to non-device validation.
- Save before/after artifacts with names that preserve ordering, for example:
  - `feature-x-before.png`
  - `feature-x-after.png`

## What Not To Do

- Do not depend on `adb shell input swipe` as the default validation path.
- Do not assume `USB debugging enabled` means the host can actually talk to the device.
- Do not compare screenshots from different routes, orientations, or app states and call that a visual diff.
- Do not trust only emulator behavior when the bug is reported on a real phone.

## Read More Only When Needed

Read [references/adb-host-troubleshooting.md](references/adb-host-troubleshooting.md) when:

- `adb devices -l` shows `no permissions`
- Linux USB device nodes are owned by `root:root`
- you need to distinguish host permission issues from phone authorization issues
- `adb` can see the phone but cannot use it
