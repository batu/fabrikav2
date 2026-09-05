---
status: partial
subject: Find Games paid-UA code audit and projection fixes
created: 2026-09-05
mode: pipeline
---

# Evidence

## Verdict

Source fixes pass unit and real-service integration checks; exact IPA identity and bundled GA persistence patch are verified. Exact-build physical ingestion and a paid acquisition canary remain blocked, so this is not relaunch approval.

## What changed

Shared AppsFlyer projection now handles warm foreground returns for elapsed-day retention and rejects non-production envelopes before forwarding/storage. Two regression cases failed before the implementation (missing retention: 0 calls; development forwarding: 2 calls) and passed after it. The FTB service integration test exercises actual service/facade/projection lifecycle rather than replacing the chain with mocks.

## Evidence captured

See assets/checks.json for exact commands, exit codes and logs. SDK 345 pass; FTB 404 pass / 3 skip; FTD 322 pass / 2 skip. SDK and FTB typecheck pass. SDK lint 0 errors / 1 existing warning. Isolated npm ci --ignore-scripts followed by the existing digest-pinned GA patcher succeeds.

Artifact and AppsFlyer API summaries are saved in assets. Native IPA 1.2.1/34 has GA custom source stamp 1.2.0+06cfd286d5. The successful-upload persistence save is present in the exact minified GA chunk. No key values are included.

## Reviewer assessment

Independent read-only reviewer inspected the three-file code diff and found no actionable correctness/regression finding. Non-blocking coverage suggestion: explicitly exercise test environment in addition to development. Review transcript: /Users/base/.hermes/cache/delegation/live/deleg_35426f7c/task-0.log. No native proof claimed by reviewer. Scope simplification inspection retained the small shared guard and existing dedupe; no extra abstraction needed.

## Analysis and gaps

Paired iPhone exists but full distribution-app inventory reads FTB1.2/build33, not build34. No app was removed, installed or launched; concurrent device work requires one assigned window. AppsFlyer Sep5 raw install export has one1.2.1 unattributed row, no build column; both organic/non-organic event exports and attributed install export are empty. GA browser fallback was demo-ambiguous, so no GA metric is accepted. Native AppsFlyer tracked=true is SDK handoff, not provider acknowledgment. Production TestFlight is not automatically excluded by environment.

## Next action

Ads assigns one physical window; Store provides existing TestFlight34 update without deletion; exact native identity is read back, then Find The runs the event contract and Ads/provider owner reconciles non-demo raw backend receipts. Merge/release of the projection fixes requires explicit approval. Detailed gates, cohort proposal and event contract: ../../handoffs/2026-09-05-find-games-ua-code-audit.md.
