# ADB Host Troubleshooting

Use this only when the device is visible over USB but ADB is not usable.

## Distinguish The Failure

Run:

```bash
adb devices -l
```

Interpretation:

- `device`: host access is working
- `unauthorized`: host access works, but the phone has not approved the RSA key yet
- `no permissions`: Linux host USB permissions are blocking ADB

## Linux `no permissions`

Typical signs:

- `adb devices -l` shows `no permissions`
- `lsusb` can see the phone
- `/dev/bus/usb/*/*` for that device is owned by `root:root`

Find the vendor id:

```bash
lsusb
```

The first half of the USB id is the vendor id, for example `18d1`.

Create a `udev` rule:

```bash
echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="<vendor-id>", MODE="0666", GROUP="plugdev", TAG+="uaccess"' | sudo tee /etc/udev/rules.d/51-android.rules >/dev/null
sudo chmod 644 /etc/udev/rules.d/51-android.rules
sudo udevadm control --reload-rules
sudo udevadm trigger
adb kill-server
adb start-server
```

Then unplug and replug the phone, keep it unlocked, and check again:

```bash
adb devices -l
```

If needed on Ubuntu-like systems:

```bash
sudo apt install android-sdk-platform-tools-common
```

## Temporary Diagnostic Only

If the rule exists but the current device node still did not update, a temporary diagnostic is:

```bash
sudo chmod 666 /dev/bus/usb/<bus>/<device>
adb kill-server
adb start-server
adb devices -l
```

Use this only to confirm the root cause. Prefer fixing `udev` properly.

## `unauthorized`

If the host is fine but the device is `unauthorized`:

1. unlock the phone
2. accept the RSA debugging prompt
3. if needed, revoke USB debugging authorizations on the phone and reconnect

## Empty Device List

Check:

- cable quality
- USB port
- phone unlocked
- USB debugging enabled
- charge-only USB mode
