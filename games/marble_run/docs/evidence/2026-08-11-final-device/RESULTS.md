# Marble Run iPhone 12 final device evidence

Device: iPhone 12 (`00008101-000410EC3EF9001E` hardware UDID)

Bundle: `com.basegamelab.marblerun`

Branch: `optimize/marble-run-device-performance`

## Performance plateau

- Physical sustained profiles covered levels 1, 20, 21, 30, 68, and 106.
- Accepted steady-state result across three consecutive hot runs: p95 17-18 ms,
  12 static WebGL renders per 12-second sample, 643 maximum draw calls, and
  78,426 maximum submitted triangles.
- Relative to the late-game baseline: static renders 720 to 12 (-98.3%), draw
  calls 802 to 643 (-19.8%), and triangles 232,946 to 78,426 (-66.3%).
- Plateau was declared after two consecutive rejected experiments: WebGL
  `low-power` preference produced no gain and a worse worst frame; a 512px
  shadow map produced no measured gain and reduced visual-fidelity headroom.

## Publisher regressions

- Menu: raw `menu.png` shows the rotated preview board with a current shadow.
- Long press: raw `level.png` shows the retained route preview on the physical
  device; it was not removed.
- Fail reward: raw `fail.png` shows `Watch an ad to continue` and `WATCH AD`.
- In-game modal: raw `pause.png` shows the fixed settings surface. The user also
  directly confirmed on the device that the whole window no longer drags.
- Tap projection: `cellClientPoint()` projects the current marble mesh world
  position, not an ideal grid point. The device capture places the tutorial cue
  on the drawn sphere center, and the real-input playthrough completed levels 1
  and 2 with zero off-target taps. No constant vertical projection offset was
  observed.
- Level 2 diagnosis: the earlier exhaustion was a harness defect. Synthetic
  gameplay taps triggered the dev-only four-tap SDK Verifier gesture, whose
  full-screen overlay intercepted later taps. Automated probes now suppress
  verifier automount and the gesture. The corrected physical run won level 1 in
  16 taps and level 2 in 14 taps, both with `offTarget: []`.
- Probe ad safety: automated probes install the disabled provider into both the
  ad facade and SDK context. The corrected playthrough initialized or displayed
  no ad SDK.

The OpenRouter vision panel was unavailable, so the canonical run is correctly
recorded as `UNVERIFIED` by that optional panel. The raw captures are fresh
XCUITest screenshots from the named physical iPhone and were inspected directly.

## External limitation

The reported iPhone 12 mini thermal behavior remains unverified because that
model was not available. The iPhone 12 reproduced hot-run degradation before
optimization and supplied all measurements above.
