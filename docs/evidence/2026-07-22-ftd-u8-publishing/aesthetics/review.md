# Aesthetics gate — FTD U8 publishing surface (VuPS0Z3R)

- Date: 2026-07-22
- Conductor-run (worker sandbox could not launch a browser: Mach-port denial; conductor ran the capture + independent reviewer per the "conductor runs it where sandboxes can't" contract).
- Surface: desktop internal tool (not a mobile game — desktop browser capture is the correct target).
- Method: `vite build --mode fixture` bundle served on 127.0.0.1, driven with Playwright through four states; independent motion-visual reviewer agent assessed the captures.

## Captures

1. `s1-fresh-load.png` — fresh load, validated preview populated from fixture, Approve disabled.
2. `s2-after-validate.png` — after "Validate and calculate digest".
3. `s3-approve-enabled.png` — digest checkbox checked + credential entered; Approve enabled with a clear affordance change (muted → saturated fill).
4. `s4-saga-activity.png` — Approve clicked; fixture lacks `POST /api/publishing/approval-grants`, and the UI surfaces the error legibly in Publication activity instead of breaking. Saga in-progress states are not reachable in fixture mode (fail-closed by design); they are exercised by the provider-free API fixtures in the backend suite.

## Verdict

**Pass — no P1 findings.** Hierarchy, spacing, contrast (digest mono, REMOTE PUBLISHING DISABLED badge), and grant-binding copy all read cleanly; nothing clipped or misaligned.

Deferred findings (recorded, not blocking):

- P2: disabled "Approve local selection" uses white-on-light-salmon fill — weaker contrast and a different disabled treatment than "Confirm rollback"'s gray outline; unify.
- P3: 64-char digest wraps mid-token orphaning `ca82`; match the grant-binding font size or middle-truncate with copy.
- P3: "Prepare immutable preview" heading sits ~6px right of the field column edge.
