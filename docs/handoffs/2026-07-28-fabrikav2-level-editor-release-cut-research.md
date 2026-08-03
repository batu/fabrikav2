# Fabrikav2 Level Editor Release Cut — Research Handoff

## Mission

Research and define a clean Fabrikav2 release cut for hidden-object level authoring, then present findings and a recommended implementation sequence to the user. This is a research task first, not authorization to implement, rename, migrate, activate, publish, or deploy anything.

The central question is whether the new level generator should become a standalone tool under Fabrikav2 `tools/`, while games such as Find the Bird consume its exported level packages. Do not treat that framing as a settled architecture. Verify the existing systems and identify the smallest safe release boundary.

## Working locations

- Fabrikav2 repository: `/Users/base/dev/appletolye/fabrikav2`
- Active reskin worktree: `/Users/base/dev/appletolye/fabrikav2/.worktrees/feat-find-the-bird-reskin`
- Branch: `feat/find-the-bird-reskin`
- Verified HEAD at handoff creation: `f0cc24a2010cca083c8fd1545cdc9c4c71afef7e`
- Legacy Fabrika repository: `/Users/base/dev/appletolye/fabrika`
- Portal decision stream: `https://portal.basegamelab.com/s/find-the-bird-reskin-0728`
- `twf orient` reports BYSTANDER in the reskin worktree. Do not claim a board or enter the TWF pipeline merely to perform this research.

Re-verify all Git state at the start. The checkout is dirty and shared; preserve every existing change.

## User intent already established

- Cut a Fabrikav2 release rather than continuing to improvise around the legacy editor.
- Existing Find the Dog levels do not need to move. They may remain in Fabrika v1.
- Explore placing the new level generator in Fabrikav2 `tools/`, not inside a game.
- The familiar legacy level-generation Wizard is the working experience the user expected. The current Fabrikav2 React UI that was launched is a different publishing/preset desk and does not currently replace that Wizard.
- Find the Bird is a new reskin. Do not copy old Find the Dog levels into it.
- New assets will be regenerated from the asset list.
- Selected visual direction: P3 “Bold Cardboard.”
- Selected mascot: P3 explorer bluebird. Birds are stylized storybook birds, not realistic birds and not humanoids; they may use tools without human arms, hands, or fingers.
- Target roughly 20 hidden entities per level, with a closer camera than the old broad scene framing.
- Start with two generated pilot levels before scaling.

## Important current evidence

### Fabrikav2 tool

Read these before forming a proposal:

- `tools/ftd-level-editor/README.md`
- `tools/ftd-level-editor/ARCHITECTURE.md`
- `tools/ftd-level-editor/ui/src/App.tsx`
- `tools/ftd-level-editor/backend/ftd_editor/app.py` and its composition/configuration callers
- `tools/ftd-level-editor/backend/ftd_editor/prompts/catalog.json`
- `tools/ftd-level-editor/backend/ftd_editor/prompts/recipes.py`
- `tools/ftd-level-editor/backend/ftd_editor/presets/store.py`
- `tools/ftd-level-editor/package.json`
- root `package.json` editor scripts
- `docs/runbooks/ftd-editor-cutover.md`

The checked-in architecture explicitly says the tool is FTD-specific and has no multi-game abstraction. It also describes a human-gated, one-way authority cutover for the existing Find the Dog corpus. The new proposal may make that cutover unnecessary for Find the Bird, but do not casually weaken or bypass those guarantees.

The current v2 UI is principally an authoring/publishing administration surface. Confirm its actual generation controls and provider composition from source rather than assuming feature parity from the package name.

### Legacy Fabrika Wizard

Research the familiar working editor here:

- `/Users/base/dev/appletolye/fabrika/games/find_the_dog/pipeline/levelbuilder/ui/src/App.tsx`
- `/Users/base/dev/appletolye/fabrika/games/find_the_dog/pipeline/levelbuilder/ui/src/components/StepConfigure.tsx`
- `/Users/base/dev/appletolye/fabrika/games/find_the_dog/pipeline/levelbuilder/api/routes.py`
- `/Users/base/dev/appletolye/fabrika/games/find_the_dog/pipeline/levelbuilder/api/session.py`
- `/Users/base/dev/appletolye/fabrika/games/find_the_dog/pipeline/levelbuilder/api/inpaint.py`
- `/Users/base/dev/appletolye/fabrika/games/find_the_dog/pipeline/levelbuilder/dev-up.sh`

The legacy authoring root is currently hardcoded relative to the legacy module:

`LEVELS_DIR = Path(__file__).resolve().parent.parent / "levels"`

Do not run it against live or historical content during research. Do not copy its levels. Inventory the Wizard’s user-visible workflow, API operations, generation pipeline, session format, and provider dependencies so the release cut can distinguish reusable behavior from legacy data authority.

### Uncommitted Find the Bird experiments

The active worktree already contains experimental changes:

- P3 style, closer `isometric_close_20` view, bird-specific entity prompt, and two pilot presets in `tools/ftd-level-editor`.
- Focused contract/fixture updates for those presets.
- An experimental `tools/ftd-level-editor/scripts/dev_server.py`.
- Vite proxy/Cloudflare host changes made while trying to expose the tool remotely.
- Asset inventory edits under `games/find_the_dog/design/`.
- Moodboard images and HTML reports under `docs/reports/`.

Inspect `git status --short` and `git diff` directly. Do not assume these edits belong in the release cut, and do not revert, commit, or relocate them during the research pass.

The legacy Fabrika repo is also dirty with substantial work from other tasks. The only changes from this immediate attempt believed to be local are the `dev-up.sh` compatibility edits, but ownership must be verified rather than inferred. Do not modify or clean that repo.

## Research questions

1. What exactly constitutes a releasable Fabrikav2 editor today: generation, session editing, validation, export, publishing, provider wiring, and UI?
2. Which working Wizard capabilities exist only in Fabrika v1, and what is the narrowest path to reuse or port them without importing its level corpus or writable authority?
3. Should the first release remain FTD-named internally with a Find the Bird profile, support a bounded FTD/FTB dual mode, or introduce a genuinely game-neutral hidden-object domain now? Compare cost, coupling, migration risk, and future rename debt.
4. What should live under `tools/` versus `games/find_the_bird/`? Define ownership of prompts, project profiles, working sessions, generated images, validated exports, immutable packages, manifests, and runtime consumption.
5. How can the release start with an empty Find the Bird workspace while preserving the existing Find the Dog corpus and its current authority untouched?

## Required investigation method

1. Read repository guidance, the tool README/architecture, nearby code, package scripts, and the legacy Wizard before proposing changes.
2. Build a capability map of legacy Wizard versus Fabrikav2 tool. Separate “implemented backend contract,” “usable human UI,” “live provider composition,” “export/publish authority,” and “historical data.”
3. Trace one complete level lifecycle in each system: create session → generate background → choose regions → generate hidden entities → validate → export/package. Cite exact source paths.
4. Identify hardcoded FTD assumptions by searching names, paths, schemas, prompt purpose strings, runtime types, and publication roots. Do not equate text replacement with a safe abstraction.
5. Produce a short recommendation with alternatives and risks, but stop before implementation so the user can choose the release scope.

Use `rg`/`rg --files` for discovery. Use `uv run` for Python commands. Read-only commands and provider-free tests are allowed; no live image generation, remote publication, production activation, deploy, or paid provider call is authorized.

## Output expected from the research

Provide:

- A capability matrix for legacy v1 versus Fabrikav2.
- A proposed release boundary showing what is in the first cut and explicitly out.
- Two or three viable architecture options with concrete tradeoffs.
- A recommendation, clearly labeled as a recommendation rather than a decision already made.
- A file-level implementation map and ordered milestones suitable for a later plan.
- Risks and unresolved user decisions.
- Exact provider-free verification commands that the eventual implementation should pass.

Keep the report concise and evidence-backed. Do not produce a final implementation plan disguised as research.

## Current verification baseline

The authoritative documented aggregate is:

```sh
npm run editor:verify
```

Useful documented focused checks are:

```sh
npm run editor:publishing:test -w @fabrikav2/ftd-level-editor
npm run editor:schema:check -w @fabrikav2/ftd-level-editor
npm run editor:contracts:check -w @fabrikav2/ftd-level-editor
```

Earlier in this session, a focused test selection around the prompt/preset changes reportedly passed 43 tests. Treat that as historical context, not current proof; rerun the relevant provider-free checks if needed.

## Definition of done for this handoff task

The receiving agent has completed the task when it has independently inspected both systems, traced the level lifecycle, presented a bounded release-cut research report with alternatives and a recommendation, and stopped for the user’s architectural decision. It is not done merely because the existing README declares the migration complete, and it is not authorized to ship the release.

