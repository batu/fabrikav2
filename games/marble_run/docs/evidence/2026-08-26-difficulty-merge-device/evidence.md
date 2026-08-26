---
status: partial
subject: Marble Run difficulty editor merge — physical iPhone verification
created: 2026-08-26
mode: interactive
---

# Evidence: Marble Run difficulty editor merge — physical iPhone verification

## Verdict

Merged commit `01be553cfecf75f5f79fde207e25ad3c1be45384` builds, installs, launches, and renders the changed Marble Run runtime surfaces on Batu's physical iPhone 12. Manual physical captures show cold startup reaching Home, complete Home/HUD assets, gameplay, and fail UI without a persistent blank shell, missing HUD assets, clipping, or WKWebView offset. The canonical strict XCUITest capture run remains blocked by the Mac's CoreSimulator framework mismatch, so this is a manual physical-device pass rather than a strict runner pass.

## Build identity

- Source: merged `origin/main` commit `01be553cfecf75f5f79fde207e25ad3c1be45384`
- Device: Batu's iPhone 12
- Hardware UDID: `00008101-000410EC3EF9001E`
- CoreDevice ID: `2D894791-A5A3-58BE-9C88-AE0AF08B8C09`
- Bundle: `com.basegamelab.marblerun`
- Signing: Apple Development, team `42L77JAX72`
- Existing App Store install was removed with Batu's explicit approval before the exact development build was installed.

## Automated evidence

| Gate | Result |
|---|---|
| Marble Run typecheck/lint/build | passed |
| Marble Run unit suite | 963 passed, 2 skipped |
| Difficulty editor typecheck/lint/build | passed |
| Difficulty editor tests | 39 Vitest + 2 manifest tests passed |
| Signed generic iPhoneOS build | passed |
| Device install and launch | passed |

## Physical captures

| Capture | Observed state | Result |
|---|---|---|
| [`capture-13.png`](manual-captures/capture-13.png) | cold native startup, black frame | expected transient startup frame |
| [`capture-16.png`](manual-captures/capture-16.png) | shell loading, purple background | expected transient shell frame; later reaches Home |
| [`capture-18.png`](manual-captures/capture-18.png) | Home / level map | logo, coin, settings, board preview, level rail and CTA assets render correctly |
| [`capture-20.png`](manual-captures/capture-20.png) | gameplay | board, marbles, HUD, hearts, coin, settings and tutorial highlight render correctly |
| [`capture-01.png`](manual-captures/capture-01.png) | fail overlay | overlay, background blur, Watch Ad and Retry controls render without clipping |

## Gaps

- Canonical `verify-device --strict` XCUITest orchestration cannot resolve the physical destination because installed CoreSimulator `1051.54.0` is older than Xcode's required `1051.55.0`.
- Manual captures do not prove touch interactions, motion timing, StoreKit, ads, analytics dashboard ingestion, or every settings state.
- Difficulty editor Export Candidate migration into shipped level assets remains explicitly deferred; this merge lands the editor/oracle and runtime preview seams, not a new 110-level production catalog.

## Next action

Before App Store review for version 1.0.1/build 9, update macOS/CoreSimulator and run the canonical strict device suite, or record explicit human interaction checks on the installed physical build. Then produce a provenance-stamped release archive from merged main.
