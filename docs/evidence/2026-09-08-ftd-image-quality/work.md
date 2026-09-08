# Full-resolution Dog WebP delivery

User approved native-resolution quality-95 WebP and matching CDN update after comparing the shipped 4K image with the original PNG.

- [x] Compare actual files and measure the five bundled packages.
- [x] Encode the 54 approved scenes and restore backgrounds without changing source artwork or placements.
- [x] Validate local manifests, hashes, order and runtime limits (422 unit tests passed; TypeScript checking passed).
- [x] Upload all 108 immutable assets, verify every public GET against size/SHA-256, then publish manifest revision 12 with a rollback copy.
- [x] Build and install with achievements/test harness disabled; inspect physical-device zoom and repeated level transitions.
- [ ] Review and merge the bounded change.

The known-working baseline is 1.0.6 (28). Build 29 was a 4K candidate and was not installed. Initial comparison page: https://portal.basegamelab.com/media/p_bffe39/01_comparison.html . Its top row is actual CDN WebP; bottom is original PNG, not the later q95 WebP encoding.

Revision 12 was temporarily rolled back to revision 11 after builds 30 and 31 terminated the iPhone WebView during level loading. Removing grayscale/reveal CPU copies alone (builds 32/33) was insufficient. Build 34 switched iOS grayscale rendering to a GPU color matrix using the existing color texture and passed physical entry, zoom, and dog-find checks through a preview endpoint. Revision 12 was then republished and read back exactly. Build 35 uses the production origin, removes diagnostics, and preserves the original grayscale luminance coefficients.

Scope: preserve 54-level sequence, the five bundled IDs, level JSON, sprite files, source PNGs and Bird content. Publishing changes the image asset hashes and manifest revision only. Keep existing CDN objects for rollback. No App Store upload or submission in this task.

Full-resolution color/background WebPs total 418,751,562 bytes across the CDN. The five bundled pairs total 40,136,516 bytes; including their unchanged level JSON and sprites, bundled level storage is 48,655,702 bytes. Native candidate build 30 totals 125,546,591 bytes.

Encoding: Pillow WebP, quality 95, method 6, RGB, 2560 x 5600, no resize. Background source is `bg_01.png` for each of these 54 portrait packages; `bg_00.png` is the older 1024 x 2240 source and is not substituted. `encoding-ledger.json` records each original PNG hash and encoded asset hash. The candidate manifest retains every level JSON, sprite descriptor, cohort, bundled flag and progression position.

The first XCUITest zoom attempt was rejected after visual inspection: it selected the home navigation tab, not `Play Level 2 Now`. Its successful test exit is not gameplay evidence. The corrected run targets the actual start button and asserts the home-only controls disappear.

Final device: iPhone 12, installed version 1.0.6 (35), app bundle 125,547,705 bytes. The production build passed three home-to-Carnival entry/zoom cycles; screenshots show actual zoomed gameplay. Achievements were asserted absent on each home visit. Native harness is disabled. Level progress, currency and hints were not reset; dog finding was exercised through normal input.

Review: inline correctness, performance, texture lifecycle, native URL selection and manifest preservation found no blocking issues. No other game files or source artwork changed. Physical checks cover iPhone classic mode; Android and restoration mode were not exercised on device. No App Store archive/upload/submission was performed.
