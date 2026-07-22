---
status: passed
subject: FTD U9 cutover rehearsal and frozen candidate
created: 2026-07-22
mode: pipeline
---

# Evidence: FTD U9 cutover rehearsal and frozen candidate

## Verdict

Passed: focused contract tests and independent attestation checks confirm the headless U9 rehearsal evidence is internally valid, binds the reviewed activation candidate `63b5af672b9340a60d9e15e56186df4e9af0a4f8`, and keeps every human/live-external activation gate fail-closed.

## What Changed

- Added fail-closed cutover primitives for inert legacy identity, disposable cloning, read-only mutation proof, filesystem validation, one-writer locking, drain predicates, and exact-candidate freezing.
- Added a real loopback API/worker rehearsal covering lost response, disconnect, Request-ID reload, API/worker restart, terminal artifact recovery, export dry-run, and public-package validation.
- Recorded a dated checksummed rehearsal and frozen-candidate manifest without changing provider, publisher, credential, live authority, or production target state.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| test | `cd tools/ftd-level-editor && UV_CACHE_DIR="$TWF_OUT_DIR/uv-cache" uv run pytest tests/contracts/test_cutover_rehearsal.py tests/contracts/test_paid_job_kinds.py -q` | passed: 63 tests; one existing Starlette deprecation warning |
| attestation | Independent canonical-JSON SHA-256 recomputation of `docs/evidence/ftd-editor-cutover-2026-07-22/rehearsal.json` | matched `sha256:d0f2059c7b2f05205edeb984554b2083ada5b1351b083b767b0e5066fbadaa90` |
| freeze | Independent evidence-tree inventory recomputation excluding `frozen-candidate.json` | matched `sha256:47ce892dc78d08aca98bbb47ebd80b6b31320e9dd50552127a936d16ec4b697e` |
| candidate | `git cat-file -e 63b5af672b9340a60d9e15e56186df4e9af0a4f8^{commit}` and `git merge-base --is-ancestor 97e9718c 63b5af672b9340a60d9e15e56186df4e9af0a4f8` | passed: candidate exists and descends from the required U1-U8 integration baseline |
| scope | `git diff --name-status 63b5af672b9340a60d9e15e56186df4e9af0a4f8..HEAD` | only the two dated evidence JSON files follow the frozen code candidate |
| runtime record | `docs/evidence/ftd-editor-cutover-2026-07-22/rehearsal.json` | signed record shows zero unexplained census failures, blocked clone mutation, empty runnable ledger, ready drain predicates, second-writer rejection, provider-free real-process recovery, valid export dry-run, and unchanged source/target inventories |
| activation guard | `docs/evidence/ftd-editor-cutover-2026-07-22/frozen-candidate.json` | `activation_allowed=false`; external provider/publisher, human acceptance, and live quiescence/copy/activation remain blocked |

## Reviewer Assessments

No specialized visual, interaction, motion, or gameplay reviewer applies. This is a headless release-gate artifact, and the card contract prohibits nested reviewer workflows.

## Gaps

- None within U9's authorized rehearsal-and-freeze scope.
- AE22-AE23 are intentionally outside this pass and remain blocked pending fresh human approval for cloned-session acceptance, minimum-cost provider checks, authenticated publisher readback, live v1 quiescence/copy, and first target-writer activation.

## Next Action

None for this evidence gate. Preserve `63b5af672b9340a60d9e15e56186df4e9af0a4f8` as the activation binary candidate; do not treat the later evidence commits as a replacement candidate without rerunning the freeze.
