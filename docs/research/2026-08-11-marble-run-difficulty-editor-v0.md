# Marble Run difficulty editor v0 research

Date: 2026-08-11

## Question

What is the smallest useful tool that lets a non-engineer tune Marble Run's overall difficulty journey and individual levels without exposing the generator as a wall of technical parameters?

## Primary-source findings

### Separate campaign placement from puzzle-local difficulty

Jolie Menzel's Ubisoft puzzle-design workshop treats difficulty both as a property of a puzzle and as a consequence of its location within a level and the whole game. It identifies steps to solve, new mechanics or information, and new applications of known mechanics as distinct difficulty dials. It also recommends judging each puzzle in the context of the game rather than in isolation. This directly supports separate Journey and Level views. [Solving Puzzle Design, GDC/Ubisoft](https://media.gdcvault.com/gdc2016/Presentations/Menzel_Jolie_Level%20Design%20Workshop.pdf)

### A score is evidence, not an authoring control

Marble Run's scorer measures four properties: marble count, solver-wave depth, initially blocked fraction, and playable area. The generator separately controls marble target, opening generosity, minimum waves, gate spread, ending style, symmetry, and seed. The repository's recorded onboarding regression shows why both layers matter: optimizing dependency depth without protecting opening generosity produced a solver-valid but hostile opening. Sources: `games/marble_run/src/marble-board/score.ts`, `games/marble_run/src/marble-board/generate.ts`, and `fabrika/AGENTS.md`.

### Progressive disclosure is preferable to a comprehensive cockpit

Apple's guidance says frequently used controls should remain visible while advanced functionality stays hidden until relevant. It also warns that multiple disclosure controls in one view add confusion. For v0, one clearly labeled Advanced section is preferable to many expandable parameter groups. [Disclosure controls, Apple HIG](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls)

### Help belongs beside the action

Apple recommends context-sensitive help tied to the current task. Tooltips should describe the indicated control, start with the action where possible, remain brief, and avoid repeating the label. If a control needs a paragraph to explain, the interface should be simplified. [Offering help, Apple HIG](https://developer.apple.com/design/human-interface-guidelines/offering-help)

### Editing must be forgiving

Apple's design principles recommend clear feedback and easy recovery from mistakes so people can explore confidently. For this editor, preview-before-save, reset, and undo of the current edit session are more important than collaboration or a durable version-history system in v0. [Design principles, Apple HIG](https://developer.apple.com/design/human-interface-guidelines/design-principles)

## Recommended v0 product

### Journey view

Show all 110 levels as a horizontally navigable difficulty curve. Each level is one point/card with:

- level number;
- target difficulty;
- measured difficulty;
- role: teach, ramp, challenge, spike, recovery, or climax;
- mechanic-introduction marker;
- lock marker when locally hand-tuned.

The designer can drag target difficulty and change the role. Selecting a level opens it in the Level view. Journey edits propose regeneration; they never silently overwrite locked levels.

### Level view

Keep the playable board dominant. Expose five human-facing controls:

1. Challenge target — Easy to Hard, with the measured 1-20 score shown beside it.
2. Opening — Generous to Tight, backed by initially movable fraction.
3. Puzzle depth — Shallow to Deep, backed by solver waves.
4. Board fullness — Sparse to Full, backed by marble target.
5. Finish — Cascade to Tense, backed by final-wave preference.

Use direct selectors for board shape and palette. Put dimensions, gate placement, exact caps, symmetry mode, and seed in one Advanced section. The primary actions are Regenerate, Play, Save, Reset, and Back to Journey.

### Feedback after every regeneration

Always report:

- target versus measured difficulty;
- solvable or rejected;
- marble count;
- solver waves;
- percentage initially movable;
- whether a mechanic is debuting;
- whether the result differs materially from its journey target.

The result should use plain interpretation first, for example: "Tight opening: only 2 of 24 marbles can move." Raw values remain visible for trust.

### Help model

- Label controls in player-experience language rather than generator terminology.
- Tooltip pattern: what players feel, followed by the underlying effect. Example: "Makes the first moves easier to spot by increasing immediately movable marbles."
- Provide one short Learn page with an annotated easy board, hard board, and journey curve.
- Avoid tours, repeated tips, a glossary system, and embedded long-form documentation in v0.

## Explicitly deferred

- analytics-driven recommendations;
- adaptive difficulty;
- collaboration, comments, and approvals;
- durable version history beyond saving/reverting the current edit;
- arbitrary manual marble painting as the primary workflow;
- support for games other than Marble Run;
- authoring new generator rules or scoring formulas in the UI;
- bulk automatic rebaking without per-level review.

## Product risk

The current v2 runtime consumes the baked `levels.generated.ts`, while the campaign bake driver remains in Fabrika v1. The editor cannot honestly save journey or generator changes until that bake path becomes an explicit supported capability. Restoring that capability is a prerequisite, not an extra editor feature.
