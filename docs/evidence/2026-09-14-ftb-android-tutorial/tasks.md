# Android tutorial repair

Status: three physical Pixel 6a record-review-fix cycles complete. Final cold-start acceptance passed; original saved progression restored and checked after reload. Final ordinary build and landing tracked separately from gameplay acceptance.

## Acceptance

1. Birds remain visible and selectable after tutorial completion; found-bird behavior is unchanged.
2. The tapping hand's fingertip points into the highlighted target, including edge targets and hints.
3. Pan demonstrations loop smoothly and real dragging does not jump between tutorial stages.

Repro: first-level onboarding on physical Pixel 6a 27091JEGR22183, native Android WebView. Record the whole sequence with before/after frame sequences for motion. Preserve the original private save before resetting tutorial state; restore it after acceptance. Baseline source: bc2bb09d1.

Constraints: use existing tutorial/harness and native capture lane. No unrelated redesign, provider changes, store release, or iPhone changes. New tutorial defects belong in the journal and must be addressed within these cycles; unrelated defects are deferred explicitly.

Each cycle records setup, pre-change evidence, diagnosis, change, post-change evidence, criterion decisions, and next action in journal.md. A cycle without physical evidence remains incomplete.
