---
status: partial
subject: FTD ACH-2 achievement collection and unlock flow
created: 2026-07-21
mode: pipeline
---

# Evidence: FTD ACH-2 achievement collection and unlock flow

## Verdict

**PARTIAL — acceptable for PR review.** Nine unique physical-iPhone-12 frames and four gated runtime markers now prove the collection, real completion unlock, compact multi-unlock callout, unblocked Claim/coin/Next presentation, sequenced post-dismissal toast, persistence, and clean-build relaunch without replay. No reviewer found a P1 or broken core loop. Remaining gaps are explicit non-blocking presentation and runtime-depth risks for PR review.

## What Changed

- Added the accessible Home-rail Achievements entry and existing-shell collection page with deterministic catalog states, progress, rewards, and analytics.
- Added the compact completion-card unlock callout and delayed the noninteractive toast until the completion overlay is dismissed.
- Added deterministic harness states and real-device evidence for collection, unlock, Claim flow, persistence, and no replay.
- Repaired the prior evidence rejection: frame 05 is now an independent capture, `proof3` gates `replay=false`, and `proof4` timestamps Claim after the callout.

## Artifact Contract

**visual-runtime.** The target is a mobile game in iPhone WKWebView, so device frames and gated device observations are the primary proof; browser/simulator evidence is not used.

## Target Device In-Situ Proof

- Physical iPhone 12, iOS 18.7.8, UDID `00008101-000410EC3EF9001E`.
- Bundle `com.baseardahan.hiddenobj`, team `42L77JAX72`, Debug, `vite build --mode ios`.
- Provenance: `games/find_the_dog/evidence/2026-07-21-achievements/README.md`.
- All nine PNGs have distinct SHA-256 hashes; notably frame 01 is `7224018f...` and the clean-build relaunch frame 05 is `5d9529fb...`.

### Gated markers

```text
proof1: ok=true achOpen=true cards=11
proof2: ok=true callout=true toastDuringCallout=false found=26/26 complete=true
proof3: replay=false home=visible dwell=6s cleanBuild=true
proof4: claim-tapped-at=+6.3s-after-callout
```

### Runtime observations

| Frame | Observation |
|---|---|
| `01-home-achievements-entry.png` | Accessible one-line Home entry using the collection medal; bottom navigation remains three cells. |
| `02-collection-states.png` | Eleven deterministic entries with explicit state chips, numeric progress, category medals, and reward state. |
| `03-unlock-callout.png`, `04-unlock-callout-settled.png` | Real two-achievement unlock compacted inside the completion card; no simultaneous toast (`proof2`). |
| `05-relaunch-home-no-replay.png` | Independent clean-build relaunch frame after six-second dwell; no replay (`proof3`). |
| `06-persisted-collection-after-clean-update.png` | Completed/reward-collected state and real progress persist across clean over-install. |
| `07-collection-scrolled-end.png` | Real collection scrolled toward the terminal entries; category medals and clamped small fill visible. |
| `08-post-claim-unblocked.png` | Claim occurs +6.3s after callout; balance advances 1120 to 1165 and Next Level is available. |
| `09-toast-after-dismissal.png` | Toast appears on level 2 only after overlay dismissal, clear of title, currency, hint, and home indicator. |

## Evidence Captured

| Type | Artifact / Command | Result |
|---|---|---|
| device | `games/find_the_dog/evidence/2026-07-21-achievements/` | Nine unique physical-device frames plus proof1-proof4 |
| typecheck | `npm run typecheck -w @fabrikav2/find_the_dog` | passed |
| unit | `npm run test:unit -w @fabrikav2/find_the_dog` | passed, 209/209 across 31 files |
| diff | `git diff --check` | passed |
| audit | `npm run audit` | pre-existing red: ignored `.env.ios.local` and unrelated `shell_template` AppIcon source gap; no branch-attributable regression |

## Reviewer Assessments

| Reviewer | Status | Result |
|---|---|---|
| ce-ui-interaction-reviewer | passed | Core navigation, collection semantics, callout/Claim hierarchy, toast sequencing, persistence, and no-replay are supported by device frames, markers, and focused tests. |
| ce-motion-visual-reviewer | partial | No P1. Static sequence is coherent; residual P2s are the post-Claim zero recap, terminal-card safe-area settling, and reduced-motion exit/runtime coverage. |
| ce-game-feel-reviewer | partial | No P1 or obstruction. Reward rhythm and double-announcement fix are proven; residual risk is zero recap plus no direct device Next/rate-prompt completion or motion/sound/haptic observation. |

## Analysis

The prior blocking integrity gaps are closed mechanically: every PNG hash is unique, the clean relaunch has an independent gated `replay=false` marker, Claim timing has a gated marker, and the post-Claim and post-dismissal frames make the sequencing observable. The UI reviewer passed the contract. Motion and game-feel remain partial because screenshots cannot demonstrate temporal audio/haptic/reduced-motion quality and the device lane stops after proving Next is presented rather than tapping through a rate prompt and teardown.

These gaps are acceptable for PR review because focused unit/source checks cover the non-interference and reduced-motion branches, the physical-device evidence proves the central collection/unlock/persistence loop, and all remaining findings are P2/P3 presentation or depth-of-proof issues rather than a P1 defect. They must remain visible as release-review risks.

## Gaps

- Frame 08 shows `Coins earned 0` after the successful +45 transfer; retain the earned amount or show an explicit Collected state.
- Frame 07 does not prove the terminal card can settle fully above the home indicator.
- Static PNGs do not directly assess motion, sound, haptics, confetti over time, or a real-device reduced-motion run; toast exit still has a 300ms opacity transition without an explicit reduced-motion override.
- Device proof shows Next presented but does not tap through Next, a rate-prompt-triggering completion, or teardown; those are covered by source/unit checks only.
- Frame 03 provenance wording is slightly early relative to callout visibility; frame 04 plus `proof2` supplies the actual callout proof.

## Next Action

PR/release review should carry the accepted risks above. Before release, prefer fixing the post-Claim recap and toast reduced-motion exit, then capture a true terminal-scroll frame and a short physical-device sequence that taps Next through any rate prompt/teardown with reduced motion enabled.

## ce-evidence Result

```json
{
  "skill": "ce-evidence",
  "status": "partial",
  "artifact_path": "games/find_the_dog/evidence/2026-07-21-achievements-pipeline/evidence.md",
  "verdict": "Physical-iPhone evidence verifies the core collection, unlock, unblocked Claim flow, persistence, and no-replay behavior; explicit non-blocking presentation and runtime-depth gaps remain for PR review.",
  "mode": "pipeline",
  "evidence": [
    {"type":"device","label":"nine unique iPhone 12 frames plus proof1-proof4","result":"passed","path":"games/find_the_dog/evidence/2026-07-21-achievements","url":null},
    {"type":"test","label":"FTD typecheck and 209 unit tests","result":"passed","path":null,"url":null}
  ],
  "reviewers": [
    {"name":"ce-ui-interaction-reviewer","status":"passed","summary":"Core interaction and persistence contract verified."},
    {"name":"ce-motion-visual-reviewer","status":"partial","summary":"No P1; static-only motion/reduced-motion and two P2 presentation gaps remain."},
    {"name":"ce-game-feel-reviewer","status":"partial","summary":"No P1; core reward flow verified, but Next/rate-prompt teardown is not directly exercised."}
  ],
  "gaps":["post-Claim recap reads zero","terminal safe-area settling unproven","motion/audio/haptics/reduced-motion not directly observed","Next/rate-prompt teardown not directly exercised"],
  "next_action":"Carry these accepted risks into PR/release review; preferably fix the recap and reduced-motion exit and capture terminal-scroll plus Next/rate-prompt device proof before release.",
  "pr_updated":false
}
```
