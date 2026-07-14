# U6 Pixel 6a P1 repair evidence (superseded)

This capture set is retained as historical evidence, but its Shop frame still
contains the VIP Bundle/locked third card. The claim below that the stray item
was absent was incorrect. The authoritative repair and fresh physical-device
proof are in `../2026-07-14-u6-shop-p1-fixed-device-v7-manual/`.

Target: Pixel 6a `27091JEGR22183`, Android WebView, explicit Phaser WEBGL.

- Publication: `sha256-35690099c42593fc9811c2def04218957aa918111d110a174a2bfb9485e7bbb9`
- Projection: `sha256-b861cff16366bd968fefce020224fa1d0deb4195fd9141e6b687e9539c33c5bd`
- Seven-state run: `menu`, `level`, `shop`, `settings`, `pause`, `win`, and `fail` were all live-device gated.
- Four-beat run: Menu, Level, Win pre-claim, and Win post-claim are distinct. Claim was dispatched through the live probe's CSS-client action rectangle; the manifest records the exact input, controller state, probe state, geometry, and capture hashes.
- Canvas: one canvas, `384.119 x 831.286` CSS px in a `411 x 914` viewport, with `31.714` CSS px bottom clearance.

The final captures were inspected directly. The player-visible revision badge is absent, the stray locked-item icon is absent from Shop, the bottom actions clear the navigation safe area, and Win post-claim replaces Claim/Double with full-size Next/Home controls. The post-claim still frame is extracted from a three-second ADB screen recording because Pixel `screencap` retained a stale WebGL buffer during the same-scene state swap; the frame remains a real-device WebView capture.

`verify-device` exited 0 with `NO-APPLICABLE-EVIDENCE [EXPLORATORY]`: all seven captures were gated, but this prototype intentionally has no trusted runtime references, so this is device observation evidence rather than a fidelity PASS.

Artifacts:

- `grid.html`, `summary.json`, and `observation.json`: complete seven-state run
- `raw-captures/`: uncropped Pixel captures
- `four-beat/manifest.json`: exact identity, live action geometry, controller/probe states, and hashes
- `four-beat/*.png`: the four requested distinct beats
- `production-browser-proof.json`: served-production explicit-WEBGL boot and live Claim -> Next/Home proof
