# Scroll affordance review

## Task 1 — Make overflow visible

Task snapshot: The approved captures used full-page screenshots, which made all content visible while hiding the real 1440 × 900 viewport behavior. Pattern and Boards overflow vertically with no persistent visual cue; narrow Ranges and Boards rely on disappearing system overlay scrollbars.

### Iteration 1

Planned result: Use one restrained scrollbar treatment for document and horizontal data overflow, visible only when scrolling is possible.

Capture setup: Live authenticated Portal route, Chromium, 1440 × 900. Close Play preview, then capture Pattern, Ranges, and Boards.

![Pattern before persistent scroll affordance](assets/pattern-before-1440.png)
What to look at: Base Cycle stops at slot 15 at the viewport edge.
Observation: More content exists below, but the interface gives no persistent scroll cue.
Acceptance check: Vertical affordance failed.

![Ranges before persistent scroll affordance](assets/ranges-before-1440.png)
What to look at: The complete chart fits at desktop width.
Observation: No scrollbar is needed on this axis at this viewport; this state must remain visually quiet.
Acceptance check: No false desktop overflow currently.

![Boards before persistent scroll affordance](assets/boards-before-1440.png)
What to look at: The view ends after level 30 even though the campaign has 110 boards.
Observation: The remaining 80 boards are below the fold with no persistent scroll cue.
Acceptance check: Vertical affordance failed.

Change explanation: pending.

Decision: failed before implementation.

Next action: add the shared scrollbar treatment, rebuild, and recapture matching states.

### Iteration 2

Planned result: Keep scroll affordances persistent across macOS scrollbar settings without adding labels, arrows, or duplicated navigation.

Capture setup: Production build served locally for verification only, Chromium at 1440 × 900 and 760 × 900. The shareable surface remains Portal; localhost is not a handoff URL.

![Pattern after persistent scroll affordance](assets/pattern-after-1440.png)
What to compare: The right edge now carries a thin blue thumb whose length and position describe the hidden Pattern content.
Acceptance check: Persistent vertical affordance met; layout and controls unchanged.

![Boards after persistent scroll affordance](assets/boards-after-1440.png)
What to compare: Levels 31–110 remain below the fold, but the same right-edge rail makes that continuation explicit.
Acceptance check: Persistent vertical affordance met; board density unchanged.

![Ranges narrow with horizontal and vertical rails](assets/ranges-after-760.png)
What to compare: A three-pixel horizontal track beneath the chart exposes the complete 110-level width; the page rail remains at right.
Acceptance check: Both overflow axes visible, non-overflowing desktop horizontal axis remains quiet.

![Boards narrow with both rails available](assets/boards-after-760.png)
What to compare: The horizontal rail is now directly above the board field, while the vertical rail remains at the right edge.
Acceptance check: Both overflow axes are visible and usable from the first viewport.

Change explanation: Native overlay scrollbars were replaced only on the three editor-owned overflow surfaces with restrained rails tied to their real scroll offsets. Track clicks and thumb drags operate the underlying containers; wheel, touch, and keyboard scrolling remain native.

Decision: passed after moving the Boards horizontal rail above the board field.

Next action: activate the reviewed artifact in Portal after deployment consent.

### Iteration 3

Planned result: Prove the same affordances on the authenticated live Portal artifact, not the local preview.

Capture setup: Live Portal route, exact iframe content hash `e6a20c180c661c54555afabc8c6bedba377ffeb7e5d1d7e16a715787aaae64bc`, Chromium at 1440 x 900 and 760 x 900.

![Live Pattern at desktop width](assets/pattern-live-1440.png)
What to compare: The right-edge rail is present in the first viewport and corresponds to the editor shell's actual vertical offset.
Acceptance check: Track click moved scrollTop from 0 to 579.

![Live Boards at desktop width](assets/boards-live-1440.png)
What to compare: The 110-board campaign remains dense while the right-edge rail communicates the content below the fold.
Acceptance check: All 110 board thumbnails rendered; no page errors.

![Live Ranges at narrow width](assets/ranges-live-760.png)
What to compare: The range marks retain their readable width and the horizontal rail remains visible beneath the chart.
Acceptance check: Chart width 1126 over a 724-pixel viewport; track click moved scrollLeft from 0 to 402.

![Live Boards at narrow width](assets/boards-live-760.png)
What to compare: The horizontal rail is visible before the board field rather than hidden beneath 110 boards.
Acceptance check: Board field width 1100 over a 724-pixel viewport; track click moved scrollLeft from 0 to 376.

Change explanation: The final narrow-width pass removed the media rule that compressed all 110 ranges into the viewport. Compression had technically removed overflow by making the chart illegible, which is a rather literal solution to the wrong problem.

Decision: passed on the live authenticated Portal route with zero page errors.

Next action: push the source commit and retain the activation backup for rollback.
