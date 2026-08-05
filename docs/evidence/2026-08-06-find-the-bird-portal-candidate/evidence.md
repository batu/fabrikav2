---
status: blocked
subject: Find the Bird first Portal release candidate
created: 2026-08-06
mode: pipeline
---

# Evidence: Find the Bird Portal candidate

## Verdict

Blocked before publication. The selective native bundle, signed harness-free
Release app, and nested Portal web preview are coherent at source revision
`8d98445d0a633fc8ff4a7a8c66223dc1cb213c36`. The release cannot honestly become
a Portal entry yet because the two current canonical campaign scenes contain
visible QA labels and the required physical iPhone is offline. Portal was left
unchanged.

## What Works

- The native bundle copies only manifest-authorized level assets, rewrites its
  catalog metadata to the exact packaged bytes, and rejects missing or stale
  assets.
- The signed Release app has bundle id `com.baseardahan.hiddenobj`, marketing
  version `1.0`, build `1`, no `CAPACITOR_DEBUG`, and passes strict `codesign`
  verification.
- The public web zip contains 199 files, excludes source maps, stays under
  Portal's current limit, and loads at Portal's nested build path after the real
  extraction/rewrite lane.
- The first-release description and changelog basis are factual. No previous
  Find the Bird record exists in the live Portal database.

## Publication Blockers

1. The repository's current campaign authority requires
   `ad_campaigns_ad_autumn_forest_bird_native2k` and
   `ad_campaigns_ad_autumn_forest_bird_poststretch2`. Their scene images visibly
   contain the labels `CANONICAL ... native-2k + lite cutouts` and
   `MAGENTA SQUARE-SEND ... (the fix)`. The browser preview shows the clipped
   label at the gameplay edge. Substituting older clean levels would violate the
   explicit canonical-only policy in `five-square-campaign.test.ts`.
2. `Batu's iPhone` (iPhone 12) is reported unavailable by CoreDevice and offline
   by `xctrace`. The exact harness-free app therefore has no installed-build
   identity or physical-device gameplay capture.
3. The existing browser video and poster are diagnostic-only and cannot satisfy
   the production capture gate. The release workflow now encodes this rule.

## Evidence Artifacts

- [`release-manifest.json`](release-manifest.json) records source, commands,
  hashes, identities, classifications, live query state, and exact gates.
- [`assets/portal-preview-home.png`](assets/portal-preview-home.png) shows the
  rewritten nested Portal preview home screen.
- [`assets/portal-preview-gameplay.png`](assets/portal-preview-gameplay.png)
  shows actual gameplay through that preview.
- [`assets/canonical-level-qa-label.png`](assets/canonical-level-qa-label.png)
  isolates the clipped baked label visible during gameplay.
- The full source images remain at
  `games/find_the_bird/public/levels/ad_campaigns_ad_autumn_forest_bird_native2k/color.webp`
  and
  `games/find_the_bird/public/levels/ad_campaigns_ad_autumn_forest_bird_poststretch2/color.webp`.

## Verification

- Find the Bird unit suite: 43 files, 277 tests passed.
- TypeScript: `npm run typecheck` passed.
- Focused ESLint over every changed TypeScript file: passed.
- iOS environment validation, Vite build, Capacitor sync, Release Xcode build,
  and strict signature verification: passed.
- Portal nested preview: 390x844 viewport, no horizontal overflow, and no local
  asset failures after the Portal rewrite fix.
- Human inspection: home, gameplay, both canonical source scenes, release app
  identity, and evidence screenshots inspected.

## Next Action

Regenerate the two canonical scenes without QA labels through the current
canonical editor pipeline. Then rebuild before reconnecting the iPhone; the
existing artifacts must not be published or reused as release evidence.

```json
{
  "skill": "ce-evidence",
  "status": "blocked",
  "artifact_path": "docs/evidence/2026-08-06-find-the-bird-portal-candidate/evidence.md",
  "verdict": "The coherent local candidate is blocked before Portal publication by visibly labeled canonical levels and missing exact-build physical-device capture.",
  "mode": "pipeline",
  "evidence": [
    {
      "type": "manifest",
      "label": "sanitized release manifest",
      "result": "candidate fields complete; publication_state blocked",
      "path": "docs/evidence/2026-08-06-find-the-bird-portal-candidate/release-manifest.json",
      "url": null
    },
    {
      "type": "test",
      "label": "Find the Bird unit suite",
      "result": "passed: 277 tests in 43 files",
      "path": null,
      "url": null
    },
    {
      "type": "rendered-preview",
      "label": "Portal nested browser preview",
      "result": "loads home and gameplay without local asset failures; visible canonical QA label blocks release",
      "path": "docs/evidence/2026-08-06-find-the-bird-portal-candidate/assets/",
      "url": null
    }
  ],
  "reviewers": [],
  "gaps": [
    "Canonical campaign scenes require clean regeneration.",
    "The exact harness-free artifact has not been installed or captured on the offline physical iPhone."
  ],
  "next_action": "Regenerate clean canonical scenes, rebuild, then capture the exact artifact on the physical iPhone.",
  "pr_updated": false
}
```
