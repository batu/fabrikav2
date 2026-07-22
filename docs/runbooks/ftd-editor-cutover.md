# Find the Dog editor cutover

This runbook freezes an activation candidate without changing editor authority. U9
may read the v1 authoring corpus and both public corpora, but every mutation happens
under a new disposable output root. It does not stop v1, enable a Factory2 writer,
call providers, publish, copy into production roots, or mint approval.

## Rehearsal and freeze

1. Confirm the exact candidate is a descendant of the initiative integration tip
   and that the worktree is clean. Record `git rev-parse HEAD`, the source roots,
   `stat`/mount identity, and the read-only v1 ledger census. Export only terminal
   or explicitly resolved rows to the archive schema at
   `tools/ftd-level-editor/cutover/legacy-archive.schema.json`. Never export queued,
   running, ownership, heartbeat, provider state, execution specs, credentials, or
   environment files. An empty source ledger is represented by the committed `[]`
   fixture.
2. Run `scripts/rehearse_cutover.py` with explicit source-authoring, source-public,
   target-public, archive, candidate SHA, disposable output, and evidence paths.
   The command refuses an existing output root. It inventories the live inputs,
   clones authoring state, makes the clone read-only, proves a mutation fails,
   runs the filesystem lock/rename/fsync probe, copies once without any
   `jobs.sqlite*`, creates a fresh runnable ledger, imports inert identity rows,
   rejects a second worker owner, reopens provider-free state, and proves the live
   inputs stayed byte-identical.
3. Review `rehearsal.json` and `frozen-candidate.json`. Zero unexplained census
   failures and all local gates must pass. The human, external provider/publisher,
   and live quiescence/copy/activation gates must remain `false`; therefore
   `activation_allowed` remains false in U9 by design.

## Final activation gate (not authorized by U9)

Only after the exact frozen code candidate passes simplify, review/fix, evidence,
CI, and fresh human approval may an operator:

1. Accept the cloned-session edit/recovery/export/publish-preview journey.
2. Run the separately approved minimum-cost invocation for every provider adapter
   and authenticated non-mutating publisher validation/readback.
3. Stop every v1 API, UI, and worker; make the live v1 authoring root read-only;
   prove a representative mutation fails; then drain until there are no active or
   ambiguous jobs (or record an explicit human resolution for each identity).
4. Copy authoring data once to approved stable target roots on the probed
   filesystem. Create a fresh runnable ledger, import only the inert archive, start
   Factory2 read-only, repeat census/public manifest hashes and provider-free
   restart/recovery checks, then mint fresh authority for exactly one writer.

Cutback is permitted only before the first target authoring write: restore v1 access
and leave the unused target copy inert. After the first target write, never restore
v1 as an authority; retain target data and roll back Factory2 code only. Missing or
failed approval, hash, drain, filesystem, archive, restart, or one-writer evidence
stops activation.
