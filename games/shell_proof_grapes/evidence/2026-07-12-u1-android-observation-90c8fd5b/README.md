# U1 Android observation — Grapes lane

Live-device evidence for card `qWCv9tUo`, captured from implementation commit
`90c8fd5b0d75646518a9e129be5669c3e800d438` on the Ubuntu-connected Pixel 6a
(device serial redacted from this public artifact).

The production APK was built, installed, launched, and driven through the frozen
protocol order: Menu, Level, Shop, Settings, Pause, Win, and Fail. Every frame was
host-sentinel gated; the run reported zero capture failures and an empty
`hardIntegrity` list. The raw capture was cropped by the measured 72 physical-pixel
status-bar inset and 96 physical-pixel navigation-bar inset for judged artifacts.

`observation.json` records `lane=device`, `provenance=live-device`, and
`runKind=no-applicable-evidence`. Its canonical input hash is
`8064e1b3e6c15df4485ab6be23170ff7a9470b7ac071d3f8bfe6562ffef19e2f`;
the landing gate independently recomputes that hash and every raw-capture SHA-256.

This is proof that all seven current surfaces were observed on real hardware. It
is not a visual-fidelity pass: this neutral proof game intentionally has no trusted
reference images, so there was nothing legitimate for the vision panel to score.

- `raw-captures/`: unmodified 1080x2400 Pixel screenshots used by the observation contract
- `judged-captures/`: status/navigation-bar-cropped screenshots
- `android-captures/`: direct ADB capture output
- `grid.html`: human review surface for all seven states
- `summary.json`: typed run verdict and per-state capture status
- `observation.json`: source-bound, capture-hashed landing evidence
