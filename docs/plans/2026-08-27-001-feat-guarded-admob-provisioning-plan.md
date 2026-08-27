---
title: Guarded AdMob Provisioning - Plan
type: feat
date: 2026-08-27
topic: guarded-admob-provisioning
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Guarded AdMob Provisioning - Plan

## Goal Capsule

- **Objective:** Extend the existing game-service provisioning skill into a reusable, end-to-end AdMob workflow, prove it by provisioning Find the Bird and Find the Dog, then incorporate lessons from those runs.
- **Product authority:** The repository's game environment contracts, native recipes, store identities, shared SDK, and provider readback collectively define the intended configuration.
- **Open blockers:** Find the Bird's public App Store listing must resolve before irreversible AdMob linking; AdMob v1beta creation access must be established through a fresh OAuth session.

---

## Product Contract

### Summary

Extend `provision-game-services` with guarded AdMob automation that bootstraps administrative access, diagnoses account state, converges each platform app to a standard ad-unit set, commits public runtime identifiers, and verifies the native result. Use Find the Bird and Find the Dog as the first production runs and revise the skill from observed failures rather than hypothetical ones.

### Problem Frame

The repository has shared AdMob runtime adapters and game-specific native wiring, but account provisioning still depends on manual knowledge spread across provider documentation, local credentials, environment conventions, and prior sessions. Public app and ad-unit identifiers are currently treated like local secrets, making production builds unnecessarily machine-dependent. Provider creation also has irreversible and limited-access boundaries that a generic dashboard checklist does not enforce.

### Key Decisions

- **Extend the existing skill.** AdMob remains a provider specialization inside `provision-game-services`; a parallel skill would split credential and release-safety rules.
- **Automate guarded convergence.** One approved operation may create or adopt the platform app, create missing standard units, read everything back, and update repository configuration.
- **Commit public runtime identifiers.** AdMob app IDs and ad-unit IDs are public client identifiers and belong in reproducible game configuration; administrative OAuth material remains outside Git.
- **Use stable canonical names.** Each platform receives `<game-slug>-<platform>-banner`, `-interstitial`, and `-rewarded`; replacement suffixes are exceptional and intentional.
- **Never clean up provider inventory automatically.** Unexpected or duplicate records are reported; destructive reconciliation remains a human decision.

### Actors

- A1. The release operator authorizes provider mutations and reviews the resulting public-configuration diff.
- A2. The provisioning agent discovers local and provider state, performs guarded API operations, and records redacted evidence.
- A3. Google OAuth and AdMob provide administrative identity, account inventory, app records, and ad units.
- A4. The game build and physical device consume the committed public configuration and prove runtime behavior.

### Requirements

**Administrative access and discovery**

- R1. The skill must explain how to create or adopt a Google Cloud OAuth client with the narrow AdMob scopes required for discovery and monetization.
- R2. The skill must discover credentials through configurable locations, prefer macOS Keychain, support an owner-only protected-file fallback, and never print credential values.
- R3. Every operation must obtain or refresh its own short-lived access token rather than trust a previously captured access-token artifact.
- R4. Discovery must report account identity, apps, platforms, store links, approval states, and ad units without mutating local or provider state.
- R5. Readiness reporting must distinguish OAuth access, API-method access, account/payment readiness, app approval, SDK integration, test serving, production serving, and revenue evidence.

**Guarded provider convergence**

- R6. Before app creation or linking, the skill must verify that the public store listing resolves to the expected production bundle or package identity.
- R7. Store linking, provider-object creation, credential rotation, and production configuration changes require explicit authorization covering the exact account, game, platform, and proposed objects.
- R8. A provisioned platform app must converge to exactly one canonical banner, interstitial, and rewarded unit while leaving unrelated provider inventory untouched.
- R9. Repeated runs against a converged app must create nothing and return the same canonical provider identities.
- R10. Existing records may be adopted only when parent account, platform, store identity, format, and canonical name agree; ambiguous matches fail closed.
- R11. Each successful mutation must be read back before the workflow continues, and partial runs must preserve enough redacted identity evidence to resume without duplication.
- R12. Limited v1beta creation access and provider failures must produce actionable classifications, including fresh-authentication, insufficient-scope, account-manager enablement, approval-action, and storefront-propagation blockers.

**Repository materialization**

- R13. Each game must have a committed public AdMob manifest containing its platform app ID, standard unit IDs, enabled formats, and canonical placement names.
- R14. Production builds must use the committed manifest by default while retaining explicit environment overrides for testing and emergency operation.
- R15. Administrative OAuth secrets, refresh tokens, service-account keys, payment data, and short-lived access tokens must never enter the public manifest, Git diff, command arguments, logs, screenshots, or chat.
- R16. Materialization must be atomic, preserve unrelated configuration, and produce a reviewable diff limited to public provider identifiers and runtime policy.
- R17. The native recipe, environment validator, runtime provider selection, and committed manifest must resolve one consistent platform app identity.

**Verification and learning loop**

- R18. The workflow must validate the game environment, build the native target, and use registered test traffic or provider test mode on a physical device before calling the integration operational.
- R19. Verification must cover banner, interstitial, and rewarded load/show outcomes, reward granting, consent behavior, failure handling, and analytics emission without clicking production ads.
- R20. The first production use must provision Find the Bird and Find the Dog separately by exact iOS store identity.
- R21. After both runs, the skill and helpers must be reviewed against observed retries, partial failures, provider responses, repository diffs, and device evidence; confirmed lessons must update the canonical skill rather than create local workarounds.

### Key Flows

- F1. Administrative bootstrap
  - **Trigger:** No usable AdMob monetization authorization exists.
  - **Actors:** A1, A2, A3.
  - **Steps:** Discover existing OAuth material; classify missing or retired clients; guide client creation or fresh consent; store durable secrets through the approved boundary; prove token refresh without exposing values.
  - **Outcome:** Read-only and mutation capability can be tested independently.

- F2. Read-only diagnosis
  - **Trigger:** A game and platform are selected for provisioning.
  - **Actors:** A2, A3.
  - **Steps:** Resolve authoritative store identity; inventory account apps and units; compare provider state with repository and native configuration; produce a mutation plan.
  - **Outcome:** The operator sees exact reuse, create, conflict, and blocker classifications before approval.

- F3. Guarded convergence
  - **Trigger:** The operator approves the exact mutation plan.
  - **Actors:** A1, A2, A3.
  - **Steps:** Recheck preconditions; create or adopt the platform app; create missing canonical units; read back every object; stop safely on ambiguity or partial failure.
  - **Outcome:** The provider has one canonical platform app and the standard three-unit set.

- F4. Materialize and prove
  - **Trigger:** Provider convergence succeeds.
  - **Actors:** A2, A4.
  - **Steps:** Update committed public configuration; validate identity consistency; build; install; exercise registered test ads; capture redacted evidence.
  - **Outcome:** The repository and tested native build agree with provider state.

- F5. Compound practical lessons
  - **Trigger:** Find the Bird and Find the Dog provisioning runs finish or encounter blockers.
  - **Actors:** A1, A2.
  - **Steps:** Compare expected and observed behavior; identify missing diagnostics or unsafe assumptions; revise the canonical workflow and regression tests.
  - **Outcome:** Future game provisioning inherits the proven path.

### Acceptance Examples

- AE1. **Covers R3, R4, R12.** Given an expired access-token artifact and a valid refresh credential, when diagnosis runs, then it refreshes independently and reports inventory without exposing either token.
- AE2. **Covers R6, R7.** Given a store listing that has not propagated, when provisioning is requested, then discovery succeeds but irreversible app linking is blocked before mutation.
- AE3. **Covers R8-R11.** Given an existing linked app with banner and rewarded units but no interstitial, when the approved convergence runs, then it creates only the canonical interstitial and a second run creates nothing.
- AE4. **Covers R10.** Given two same-format units that could both be interpreted as canonical, when reconciliation runs, then it reports the ambiguity and performs no mutation.
- AE5. **Covers R12.** Given valid OAuth scopes but no limited v1beta creation access, when capability is tested, then the result identifies account-manager enablement rather than misdiagnosing credentials.
- AE6. **Covers R13-R17.** Given successful provider readback, when materialization runs, then the Git diff contains only public IDs and policy while native and runtime validation resolve the same app ID.
- AE7. **Covers R18-R19.** Given a registered test device, when verification runs, then all three formats are exercised without production-ad interaction and rewarded value is granted only after the provider reward callback.
- AE8. **Covers R20-R21.** Given completed or blocked Find-game runs, when the post-run review occurs, then observed gaps become canonical skill guidance and regression coverage rather than game-specific folklore.

### Success Criteria

- Find the Bird and Find the Dog each have an exact, reproducible AdMob state classification.
- Every authorized, supported platform converges idempotently to the standard three-unit set.
- A clean checkout can resolve production public AdMob identifiers without access to the original operator's local environment.
- No administrative credential value appears in Git, terminal output, evidence, or committed documentation.
- Device evidence supports every claim that a game can request and show AdMob inventory.

### Scope Boundaries

- The workflow does not delete, disable, or rotate unexpected apps or ad units automatically.
- It does not enable campaign spend, configure acquisition campaigns, or treat acquisition attribution as monetization provisioning.
- It does not click production ads or use live impressions as test evidence.
- It does not guarantee revenue from successful SDK initialization or test-ad delivery.
- Mediation-network onboarding and bidding configuration are deferred until direct AdMob serving is proven.

### Dependencies and Assumptions

- Google continues to expose creation through the limited-access AdMob v1beta monetization API or provides an equivalent supported surface.
- The operator can complete interactive Google consent and request account-manager enablement when required.
- Public store identities remain authoritative for irreversible provider linking.
- Find the Bird storefront propagation and current Find the Dog listing are prerequisites for their respective linked-app operations.

### Sources and Research

- `.codex/skills/provision-game-services/SKILL.md`
- `.codex/skills/provision-game-services/references/provider-contracts.md`
- `games/find_the_bird/.env.example`
- `games/find_the_dog/.env.example`
- `games/find_the_bird/native-resources/ios/shell-manifest.json`
- `games/find_the_dog/native-resources/ios/shell-manifest.json`
- `tools/game-env/src/policies/find-the-dog.mjs`
- Google AdMob API v1beta documentation for app and ad-unit creation
