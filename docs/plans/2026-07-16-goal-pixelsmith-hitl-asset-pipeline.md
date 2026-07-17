# Goal: Pixelsmith HITL Asset Pipeline

Implement `docs/plans/2026-07-16-001-feat-pixelsmith-hitl-asset-pipeline-plan.md` to its Definition of Done.

The plan is the authority — scan its headings rather than reading it whole. Read the Goal Capsule first, then work the implementation units in dependency order, reading each unit together with the R/F/AE/KTD items it cites. Run the plan's Verification Contract gates and satisfy each unit's test scenarios. Track progress outside the plan file.

Follow the plan's PR/landing strategy if it defines one; repo conventions and the user's preferences override it. Surface a genuine blocker — anything that changes scope or contradicts the plan — instead of guessing; use judgment on details the plan leaves open.

Note the plan's stop conditions: the later units are live human-in-the-loop phases (portal approvals, device runs) that require the user and the physical device — pause and hand control back at those boundaries rather than simulating them.
