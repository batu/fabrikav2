# Find the Bird App Store Connect completion handoff

## Mission

Bring the existing **Find The Bird - Explore Nature** App Store Connect draft to a truthful, upload-ready state by matching Find the Dog's pricing/availability, creating and publishing Find the Bird legal/support pages, completing store metadata, preparing the real app icon/native assets, producing a correctly signed production-bundle archive, uploading the build, and verifying every processed artifact. Do not submit for App Review or release the app without separate explicit authorization.

## Repositories and live state

- Fabrikav2 repo: `/Users/base/dev/appletolye/fabrikav2`
- Required worktree: `/Users/base/dev/appletolye/fabrikav2/.worktrees/feat-find-the-bird-reskin`
- Branch: `feat/find-the-bird-reskin`
- Recorded HEAD at handoff: `c63bf2da0795378c5760e70c427ce09431778486`
- Game: `games/find_the_bird`
- Legal-site repo: `/Users/base/dev/appletolye/personal_site`
- The Fabrikav2 worktree is heavily dirty with user-owned Find the Bird generation/runtime work. Preserve it. Do not clean, reset, revert, broadly stage, commit, merge, or publish unrelated changes.
- `twf orient` currently reports BYSTANDER.

## App Store Connect identity

- App name: `Find The Bird - Explore Nature`
- App Store Connect app ID: `6796698146`
- Production bundle ID: `com.basegamelab.findthebird`
- Registered bundle ID record: `Q95GH82PHX`
- SKU: `com.basegamelab.findthebird`
- Primary locale: `en-US`
- iOS version: `1.0`
- Version ID: `73d05067-4708-427b-93d7-0258275bd7b8`
- Current state: `PREPARE_FOR_SUBMISSION`
- Localization ID: `22019937-8e98-40bd-beb0-4a7e68577b14`
- Screenshot set: `APP_IPHONE_65`, ID `a02d3592-24a3-461a-aadd-a50fbc6cb9d8`
- Two physical-iPhone screenshots are already uploaded and Apple reports `COMPLETE` with no processing errors:
  - `02-gameplay-1284x2778.png`, screenshot ID `8be95dbf-83d1-4065-9435-e3e13d37b72f`
  - `01-home-1284x2778.png`, screenshot ID `d726a78d-8a9b-4c0e-94d5-b60683d709af`
- Source captures came from Batu's physical iPhone 12 at 1170x2532, were visually inspected, then resized to Apple's accepted 1284x2778 6.5-inch slot.

## Credentials and secret handling

- A working App Store Connect API key exists locally. Use the established helper at `/Users/base/dev/appletolye/fabrika/games/find_the_dog/.work/iap-audit/asc-lib.mjs` or the canonical release tooling found in the repos.
- Key material exists under `/Users/base/fabrika-keys/appstore-connect/` and in the Find the Dog workspace. Never print, log, copy into docs, commit, or repeat private keys, JWTs, passwords, or 2FA material.
- The public App Store Connect API supports metadata and asset workflows but previously returned `403` for `POST /v1/apps`; the app record already exists, so this is no longer relevant.

## Existing signing and device context

- Physical device: Batu's iPhone 12, UDID `00008101-000410EC3EF9001E`
- Development team: `42L77JAX72`
- The currently installed Find the Bird player is signed under the legacy slot `com.baseardahan.hiddenobj`. That is acceptable as screenshot provenance only. It is **not** acceptable as the store build.
- Read `docs/handoffs/2026-07-31-find-the-bird-ios-signing-recovery.md` and `/Users/base/dev/appletolye/agency/src/agency/catalog/skills/compound-engineering/common-debugging-problems/references/ios-signing-identity-team-mismatch.md` before signing work.
- Critical trap: `tools/verify-device` builds with `VITE_ENABLE_TEST_HARNESS=true` and `VITE_INSITU_TOUR=allstates`. Never archive or upload that automated test build. Explicitly unset every tour/harness variable for the production build and inspect the final archive.

## Find the Dog parity sources

Use Find the Dog as the source of **structure and settings**, then rewrite species/app identity and verify every statement against Find the Bird's actual build.

- Live Find the Dog app ID: `6772100729`
- Find the Dog legal pages: `/Users/base/dev/appletolye/personal_site/content/find-the-dog/{privacy,terms,support,data-deletion}.md`
- Find the Dog legal-link contract: `games/find_the_dog/src/platform/LegalLinks.ts`
- Find the Bird currently incorrectly defaults to Find the Dog URLs: `games/find_the_bird/src/platform/LegalLinks.ts`
- Find the Dog launch checklist: `/Users/base/dev/appletolye/fabrika/games/find_the_dog/docs/launch/store-compliance-checklist.md`
- Find the Dog iOS native resources: `games/find_the_dog/native-resources/ios/`
- Find the Bird native resource directory currently contains only `native-resources/README.md`; trace the current shell materialization/build pipeline before adding files.
- Candidate Find the Bird icon evidence: `docs/evidence/2026-07-30-find-the-bird-icon-options/` and the current mascot/UI assets. Inspect the candidates at full resolution; do not choose by filename.
- Query Find the Dog's current App Store Connect price schedule, availability/territories, categories, age rating, localizations, app-info fields, and version metadata through the API. Copy pricing and availability exactly as requested. Treat other fields as reference, not automatically truthful parity.

## Public URLs to create and publish

Create Find the Bird equivalents in `personal_site` by adapting the Find the Dog pages:

- `https://basegamelab.com/find-the-bird/privacy`
- `https://basegamelab.com/find-the-bird/terms`
- `https://basegamelab.com/find-the-bird/support`
- `https://basegamelab.com/find-the-bird/data-deletion`
- Marketing URL should be a real public Find the Bird page on `basegamelab.com`; inspect the personal-site conventions and create the smallest appropriate landing page if no suitable route exists.

The human explicitly authorizes creating and publishing these Find the Bird public pages and updating the App Store Connect draft. This does **not** authorize submitting for App Review, phased release, manual release, automatic release, or changing unrelated production routes.

Adapt app identity and contact wording, but do not blindly copy privacy claims. Audit the actual Find the Bird runtime/native build for ads, analytics, attribution, IAP, notification, account, data deletion, tracking, and SDK behavior. The privacy policy, App Privacy answers, privacy manifest, consent flow, and review notes must agree with the shipped binary.

After publication, verify each URL with HTTP status, rendered-page inspection, links, mobile layout, and no login/geofence/PDF requirement. A local build is not proof a public URL works.

## Store metadata to complete

Read current official Apple documentation first, using only Apple sources for mutable requirements and field limits. Inspect the existing draft before writing. Complete every applicable field truthfully, including:

- app name and subtitle;
- promotional text where appropriate;
- description focused on Find the Bird's real hidden-object gameplay and current level set;
- keywords within Apple's limit, without competitor names or unsupported claims;
- Support URL, Marketing URL, and Privacy Policy URL;
- primary and secondary categories, content rights, age rating questionnaire, copyright;
- App Privacy answers derived from the actual SDK/runtime audit;
- review contact/instructions and notes needed to access gameplay, while never embedding secrets;
- version release settings only up to a draft-safe state;
- pricing schedule and territory availability copied exactly from Find the Dog.

Do not invent a separate App Store “thumbnail” field. Resolve what the human means by thumbnail against Apple's current UI: normally the store icon comes from the uploaded build, while screenshots/previews are version assets. Document the mapping and produce only real Apple-supported assets.

## Icon and binary requirements

- Inspect all Find the Bird icon candidates at full resolution and select the strongest recognizable bird-first icon that has no text, transparency, template residue, or dog imagery.
- Preserve a source master. Generate the required AppIcon asset catalog entries through the repo's existing native-shell/resource pipeline; do not hand-edit generated Xcode output if a canonical source/materialization path exists.
- Confirm the 1024x1024 App Store marketing icon and all required icon slots are opaque, correctly sized, and actually embedded in the archive.
- Build/archive with bundle ID `com.basegamelab.findthebird`, team `42L77JAX72`, version `1.0`, and a fresh build number derived from App Store Connect.
- Explicitly unset `VITE_ENABLE_TEST_HARNESS`, `VITE_INSITU_TOUR`, and `VITE_INSITU_TOUR_STATE` during the normal Vite build and Capacitor sync.
- Validate bundle ID, version/build number, signature, entitlements, privacy manifest, embedded provisioning profile, AppIcon catalog, payload size, absence of tour flags/live-dev URLs/secrets, and physical-device behavior before upload.
- Upload the exact verified archive with the repo's supported Xcode/Transporter/API workflow. Wait until App Store Connect processing completes, then attach that exact build to version 1.0 and verify the store icon rendered from it.
- Do not treat archive success, upload acceptance, or processing start as completion.

## Screenshots and presentation assets

- Preserve the two already uploaded physical-device screenshots unless visual inspection reveals a genuine defect.
- Inspect the App Store Connect screenshot ordering and previews. Gameplay should lead; home can follow.
- If Apple requires another display class under current rules, derive it from fresh physical-device evidence or a compliant deterministic adaptation and inspect it before upload. Do not silently relabel simulator/browser output as physical-device evidence.
- Do not add marketing frames, claims, badges, or decorative text unless they are accurate and improve the listing; raw game screenshots are already acceptable.

## Required workflow

1. Run `twf orient`, `git status --short`, inspect both repos, and query the live App Store Connect draft plus Find the Dog reference values.
2. Read current official Apple requirements for app information, version information, screenshots, app icons, privacy, pricing/availability, builds, and submission blockers. Record a concise requirement/evidence checklist in the handoff evidence.
3. Build a machine-readable before-state manifest for every relevant Find the Bird field and Find the Dog parity source. Never overwrite a non-empty Find the Bird field without recording the old value.
4. Create/test/publish the Find the Bird public pages, update Find the Bird's in-app default legal URLs and tests, then verify the public URLs live.
5. Prepare and inspect the icon/native resources, build the normal production-bundle archive, validate it, upload it, wait for processing, and attach it.
6. Update App Store Connect metadata, pricing, territories, privacy/age-rating/compliance answers, URLs, and screenshots. Re-query everything after mutation.
7. Open and inspect the rendered public pages, App Store Connect listing, processed icon/screenshots, archive metadata, and current physical-device player. Produce a sanitized completion report that separates complete, incomplete, and blocked items.

Use idempotent API operations: query first, create/update only what differs, and re-query afterward. Never silently substitute names, URLs, pricing, territories, assets, models, bundle IDs, or legal claims.

## Verification commands and evidence

Discover and use the repo's current commands rather than trusting stale examples. At minimum include:

- focused unit tests for `LegalLinks`, store metadata, native-resource materialization, and any changed release tooling;
- Find the Bird typecheck and production build;
- native shell sync/materialization checks;
- `codesign --verify --deep --strict <App.app>` and `plutil`/`security cms` inspection of the exact archive payload;
- public `curl` checks plus rendered browser screenshots of all new URLs;
- App Store Connect API read-back of metadata, pricing, availability, screenshot states, build processing state, and selected build;
- current physical-iPhone launch/captures of the exact normal build when installation is possible.

Store sanitized evidence under `docs/evidence/2026-07-31-find-the-bird-app-store-completion/`. Do not store credentials, JWTs, private keys, provisioning private material, or personal review-contact details in committed evidence.

## Definition of done

- All Find the Bird public legal/support/marketing URLs exist, are deployed, render correctly, and are wired into both the app and App Store Connect.
- Store copy, categories, age rating, App Privacy, copyright, review information, pricing, and territory availability are complete and verified by read-back; pricing/availability match the live Find the Dog configuration exactly.
- The chosen Find the Bird icon is visually inspected, embedded in the production archive, and visible after App Store Connect build processing.
- A correctly signed production archive with bundle ID `com.basegamelab.findthebird` is uploaded, fully processed, and attached to version 1.0; it contains no automated tour/test harness.
- Required screenshots are processed and correctly ordered.
- App Store Connect shows no unaddressed metadata/build blockers short of the intentionally excluded **Submit for Review** action.
- A sanitized evidence report lists every field and artifact with its source, final value/state, and proof.
- Unrelated dirty work remains untouched.

If an Apple agreement, tax/banking state, missing distribution certificate/profile, account role, privacy decision, review-contact detail, or another genuinely human-only prerequisite blocks completion, finish all unblocked work and report the exact sanitized blocker. Blocked is not complete. Do not submit for review or release.
