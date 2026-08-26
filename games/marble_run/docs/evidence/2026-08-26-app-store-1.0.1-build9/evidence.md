---
status: passed
subject: Marble Run 1.0.1 build 9 App Store submission
created: 2026-08-26
mode: pipeline
---

# Evidence: Marble Run 1.0.1 build 9 App Store submission

## Verdict

Marble Run version 1.0.1 build 9 was produced from clean merged source `ba4759b06f`, validated by Apple, uploaded, attached to a complete 1.0.1 listing, and submitted. App Store Connect readback reports version and review submission `WAITING_FOR_REVIEW`; live version 1.0 build 8 remains `READY_FOR_SALE`.

## Source and artifact

- Source commit: `ba4759b06f43d7a990735a20f7aeb8b9ffaf3fc8`
- Production build manifest: `sha=ba4759b06f`, `dirty=false`
- Bundle: `com.basegamelab.marblerun`
- Version/build: `1.0.1 (9)`
- Minimum iOS: 15.0
- Signing: Apple Distribution, team `42L77JAX72`
- `get-task-allow=false`
- Production test-harness gate compiled false; no active allstates trigger
- IPA SHA-256: `9d104f9587a84dc9f62c4d77001019d160d9f31a40824626ca61b06691207ef7`
- IPA size: 41,578,296 bytes
- Upload delivery UUID / build resource ID: `003f8f63-9729-41ab-9c6c-4228126f0544`

## Verification

- Marble Run: typecheck, lint, production build passed; 963 tests passed, 2 skipped.
- Difficulty editor: typecheck, lint, production build passed; 39 Vitest and 2 manifest tests passed.
- Signed merged development build installed and launched on Batu's physical iPhone 12.
- Manual physical captures cover cold startup, shell loading, Home/level map, gameplay HUD/board, and fail overlay without a persistent blank shell, missing HUD assets, clipping, or obvious WKWebView offset. See sibling evidence `../2026-08-26-difficulty-merge-device/evidence.md`.
- Apple archive and export succeeded.
- Apple server validation: `VERIFY SUCCEEDED with no errors`.
- Processing: build 9 `VALID`.

## App Store readback

- Version 1.0: `READY_FOR_SALE`, build 8 `VALID`.
- Version 1.0.1: `WAITING_FOR_REVIEW`, build 9 `VALID`.
- Review submission: `WAITING_FOR_REVIEW`.
- Review item: one item, `READY_FOR_REVIEW`.
- en-US metadata, four carried screenshots, review contact, and provenance notes are present.

## Boundaries

- Difficulty editor Export Candidate migration into the shipped 110-level catalog remains deferred; version 1.0.1 retains the production level catalog and ships runtime performance/asset/lifecycle improvements.
- Canonical strict XCUITest capture remained blocked by the Mac CoreSimulator framework mismatch. Manual physical-device capture is retained and the limitation is explicit.
- The physical iPhone currently has the merged development build installed, not the App Store build 8.
