# Find the Bird: shorter tutorial on iPhone

## Requested behavior

- Remove the final objective text and "Let's play" button.
- Explain the camera with "Drag to move the camera" and accept either horizontal direction.
- Demonstrate a smooth left/right motion; finish the lesson after finger release.
- Preserve upright, directional tap artwork and smooth transitions between targets.
- Verify the unclaimed hot-streak reward dot is circular.

## Source and device

Worktree: `.worktrees/ftb-ads-achievements-hud-audio`.
Branch: `fix/ftb-ios-tutorial-and-streak-dot`, based on main `51c54a44e898e38a6cd2e2b846f6234986b94897`.
Device: physical iPhone 12, iOS 26.6.1.
Fresh-run testing uses `com.basegamelab.findthebird.onboardingfresh`; the ordinary player identity is not reset.

Local evidence root: `/Users/base/store-review/find-games/ftb-apple-tutorial-20260914/`.
The ordinary app's Library was backed up to `save-before/Library` before testing.

## Verification

- Unit suite: 590 passed, 3 existing skips. Typecheck and ESLint passed.
- After removing the obsolete objective-count parameter: typecheck, ESLint, and 19 focused tests passed.
- `tutorial-v2.xcresult`: physical guided finds, pinch, leftward drag, hint, automatic completion, immediate relaunch and returning-player gameplay passed.
- `captures-v2/`: inspected the pan frame sequence, upright hint hand, normal gameplay with remaining birds, and returning-player screenshot without tutorial.
- The initial main-build run failed its immediate-relaunch assertion. The revised automatic-completion flow passed the same relaunch assertion; no delay was added to hide the failure. A diagnostic storage observer recorded `ftd_tutorial_shown=1` during the hinted-bird tap.
- `tutorial-v3-right.xcresult`: the same physical journey passed with a rightward drag; immediate relaunch also passed. The final QA artifact has no diagnostic relay or storage observer.
- `captures-v3/DC2B14D6-DE2E-4444-A0A7-7E2AEC4AC388.mp4`: retained full native video, 154.64 seconds. Inspected the full-run contact sheet and consecutive frames at 10 fps around both hand reversals, plus 6 fps around the rightward drag and transition to the hint. No hand reset/snap or camera jump was observed.

## Hot-streak dot

The existing main correction (`f1dfecf28d`, `min-width: 0`) is present. A claimable reward was created only in the dedicated QA identity. The actual iPhone WKWebView reported 14 x 14 CSS pixels, zero padding, and equal transformed bounds (14.540115 x 14.540115) during animation. `streak-before.png` and a magnified crop were inspected: the dot is circular. No speculative CSS change was added.

## Post-fix quality

Scope: only this branch's tutorial and recording-runner changes.
Simplify: independent reuse, quality and efficiency reviews ran. Removed obsolete `TutorialAnchor.total`; retained the directional input signature to preserve the existing handle contract and directional scene assertions. No reuse or efficiency findings.
Code review: inline correctness, testing, and project-standards review; no remaining code findings. Physical video acceptance passed. All changed code is local to Bird; the shared runner change only retains successful capture output.
The test plan now uses `uiTestingScreenshotsLifetime` so successful runs retain recordings. The previous `systemAttachmentLifetime` entry did not retain a successful run's video.

## Delivery status

Ordinary iOS web/native build succeeded. Installed and launched `com.basegamelab.findthebird` from `/private/tmp/ftb-apple-main-build/Build/Products/Debug-iphoneos/App.app`; inspected `ordinary-final-settled.png`. No TestHarness asset ships in this artifact. Comparing all 27 Bird/Dog-prefixed saved keys before and after found only the ordinary notification launch counter changed; wallet, progress and tutorial state were preserved.

Portal recording: https://portal.basegamelab.com/media/p_339a7b/01_recording.html

The complete recording was compressed to 720px width without cuts or retiming. SHA-256: `a1615e5549c973981bc4e5e36f0d85a77e066f6dc802733a61df099c3ef4e99c`. Portal readback matched the hash; HTTP 200, video/mp4, 9,587,150 bytes. Playback advanced and desktop/mobile report screenshots were inspected. Native XCTest recording contains no audio. The report includes jump buttons for the pan loop and drag transition.

This latest revision was physically verified on iPhone. Android source receives the same tutorial changes but was not rebuilt or re-tested in this pass.
