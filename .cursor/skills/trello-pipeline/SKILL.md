---
name: trello-pipeline
description: Agentic Trello-driven development pipeline.
allowed-tools:
- Bash
- Read
- Write
- Edit
- Glob
- Grep
- Skill
tags:
- trello
- kanban
- compound-engineering
- pipeline
- autonomous
- adb
- telegram
scope: optional
---

# Trello-Driven Development Pipeline

Use this skill when the user wants you to autonomously work a Trello Todo column end-to-end: each card travels through a fixed set of compound-engineering stages, and the card's column position *is* the source of truth for where the work stands.

This skill layers on top of one other skill — load it when you start:
- `telegram-bridge` — for `telegram-send` outbound notifications to the user. It is **send-only**: there is no packaged inbound channel, so the pipeline cannot receive async Telegram replies today (see "Telegram notifications" below).

The raw `trello` CLI is **not** installed — card ops go through `twf`, the bundled state-machine wrapper, which talks to Trello via REST (the `process/trello` skill was retired). All column transitions and comments go through `twf` (see "Why twf" below); there is no lower-level `trello` command to fall back to.

## The pipeline at a glance

```
Ideas → Todo → Brainstormed → Planned → Worked → Aesthetics Reviewed → Tested inSitu → Reviewed → Evidence Captured → Video Sent → Compounded → Merged
         ↑     (ce:brainstorm) (ce:plan) (ce:work)  (adb device)   (ce:review) (ce:evidence)  (screenrec)  (ce:compound)
         │
   user-curated,
   user-ordered;
   I pull from top

              Blocked on Batu  ← cards parked awaiting user input
              Archive          ← cancelled / shelved
```

The column *is* the state machine. Move the card after each stage completes, and comment the artifact path or commit SHA on the move.

**Why Evidence Captured and Video Sent come after Reviewed:** evidence and video must reflect the post-review shipping version, not an intermediate state that'll be rewritten. Evidence is the durable verification record; Video Sent is the user-facing demo/checkpoint.

## Why the pipeline looks like this

Each column corresponds to a concrete artifact or verified outcome. Moving a card without producing that artifact breaks the chain for any future session picking up the work. The whole point of this workflow is that **any session can resume any card just by reading the card's Trello state + recent git log** — no special in-head context. So the discipline matters: move only when the artifact exists, and always comment the link back.

## Why `twf`, not raw `trello`

The pipeline's checklists used to live in this SKILL.md prose. In practice agents skipped stages — most often Reviewed — because by the time of advancement, the per-stage checklist was stale in their context. The fix is mechanical, not exhortative: every column-changing command surfaces the entry checklist for the new column **in the same call** that advances the card.

`twf` is the bundled CLI that does this. Surface area:

```bash
# Card lifecycle (worker surface)
twf pickup <shortid> [--classification direct-to-work|needs-plan|needs-brainstorm]
twf next [--card <shortid>]
twf back --to <column> --reason <text>
twf park {blocked|archive} --reason <text>
twf status [--card <shortid>]
twf scan
twf sitrep                 # glanceable board table + narrative
twf comment <text> [--card <shortid>]
twf handoff --done ... --verified ... --remaining ... --surprises ... [--friction 1-5]

# Conductor / orchestration surface
twf board {status|claim|release}
twf run-card <shortid> [--worktree] [--stage <col>]
twf merge-card <shortid> [--to-branch <name>]
twf explore "<repo question>"        # cheap read-only worker
twf conductor-prompt                 # render conductor identity to stdout
twf conduct                          # launch a conductor session
twf ledger add ...                   # append an evaluation record
twf metrics                          # TWF metrics reports
```

Run `twf --help` for the authoritative surface (this list mirrors it). Active card is inferred from the current git branch (`trello-<shortid>-<slug>`); use `--card <shortid>` from any branch (e.g. main) to override or comment.

**Discipline:** never call `trello move` or `trello comment` directly inside the pipeline. Always go through `twf`. The skill body below uses `twf` exclusively in every stage instruction — if you find yourself reaching for raw `trello` to advance or comment, you're skipping the checklist surface that the whole tool exists to provide.

**Chain discipline.** When you batch multiple `twf next` calls in one bash chain, **grep the output for the `→` arrow** (e.g. `twf next 2>&1 | grep "→"`) and treat a missing arrow as a hard failure — do not trust the exit code alone. `twf next` exits 0 on no-op cases that look like "nothing happened" (e.g. card already in target column, or a chained call hits a column whose comment-entry-gate hasn't been satisfied). A silently-stuck card looks fine in the chain output but blocks the next pickup with `error: card <id> is in <column>` until you unstick it via `twf next --card <id>`. Cheap detection: every `twf next` in a chain should produce a `<from> → <to>` line; if it doesn't, abort the chain and `twf status --card <id>` to see what gate didn't fire.

**Byte-identical refactors and the Aesthetics column.** When a card's output is mathematically byte-identical to its pre-card state — token migrations of constants where every `0x...` / alpha / font-string is preserved exactly, math equivalences provable by inline assertion, re-exports that don't change the value — state the equivalence in one sentence and advance. Don't re-litigate aesthetics per-card and don't burn a Playwright capture: the framework catches brand drift, and there is none. Format: `twf comment "Aesthetics: byte-identical visual output. <which constants are preserved>. No visual delta to review." && twf next`. Reserve the full sub-agent review for cards that actually change rendering.

## Prerequisites check (run once per board)

Before starting, verify the board has what this workflow needs. If anything is missing, tell the user — don't silently create lists on the user's board.

- Lists (the workflow columns): `Ideas`, `Todo`, `Brainstormed`, `Planned`, `Worked`, `Aesthetics Reviewed`, `Tested inSitu`, `Reviewed`, `Evidence Captured`, `Video Sent`, `Compounded`, `Merged`, `Blocked on Batu`, `Archive`
- Board + list IDs mapped in `agents/config.json` under a `trello` key — see the config section below
- `twf` CLI on PATH. `twf` ships as an agency package entry point, so `uv tool install agency` (or `uv tool upgrade agency`) puts it on PATH. If `which twf` comes back empty, (re)install agency:
  ```bash
  uv tool install --editable /path/to/agency   # or: uv tool upgrade agency
  ```

List names on the board may differ in capitalization or contain typos — the skill references lists by **ID via config**, not by name, so prose naming in this doc can diverge from what's on the board without breaking anything.

## Pickup rules

**Between cards: re-scan Todo.** The user often adds new cards mid-pipeline — especially bug fixes after seeing video of the last landing. Don't blindly pull "the card you remembered was next" from session-start scan; run `twf scan` between cards so late bug fixes don't sit behind pre-planned features.

1. **Run `twf scan`** to see the top of Todo and any cards waiting on Blocked-on-Batu. If any blocked card has a resolving comment from the user, prefer it.
2. **Pick the top Todo card that isn't already yours** (read its full comment thread — earlier sessions may have notes).
3. **Check dependencies.** If the card description has a `Depends_on: <shortid>` line (or `Depends_on: <shortid1>, <shortid2>`), look up each prerequisite. If ANY prereq is still anywhere except Merged, **`twf pickup` will refuse with a list of blockers** — skip this card, comment `"Skipped: blocked on <shortid>"` (via `twf comment` from a different branch), and try the next Todo.
4. **Classify the card** on pickup. Names describe the **process gate**, not effort:
   - **direct-to-work** — AC is fully concrete, no product decisions, no brainstorm needed. Skip `/ce:brainstorm` AND `/ce:plan`; write a compact plan inline (≤30 lines) and go straight to work.
   - **needs-plan** — AC is concrete but implementation has decisions to make (file layout, library choice, integration points). Skip `/ce:brainstorm`, run `/ce:plan` to nail down approach.
   - **needs-brainstorm** — AC has product ambiguity, scope decisions, or unclear "what good looks like". Run the full pipeline starting at `/ce:brainstorm`.

   Effort is independent of classification: a `direct-to-work` card can take 3 hours of careful implementation; a `needs-brainstorm` card can resolve in 30 minutes if the brainstorm clarifies a small change. Don't conflate them.
5. **Set tmux pane title:** `pane-title <agent> "<project>: <slug>"` — `pane-title` ships with the agency uv tool (same install as `twf`; `uv tool install agency` puts both on PATH), so it's available wherever the pipeline runs, not a bare-PATH assumption. Lead with the stable project name (the board's `board_name` from config, i.e. the game's name or "Agency Fleet"), then `:`, then the current card's `<slug>`. The project prefix shouldn't change card-to-card; only the slug after the colon does. The card shortid lives in the branch name (step 6), so it stays grep-able without cluttering the title.
6. **Create branch:** `trello-<shortid>-<kebab-slug>` (example: `trello-a1b2c3-add-dog-bark-sound`). `twf` infers active card from this name, so the format is load-bearing.
7. **`twf pickup <shortid> --classification <direct-to-work|needs-plan|needs-brainstorm>`** — this verifies the branch matches, comments the classification, moves the card to the first work column (Brainstormed / Planned / Worked depending on classification), and prints the entry checklist. Begin executing it.

The short id is the Trello card's short URL id — stable across renames and useful for grep.

### Card dependency declarations

For dependencies that you (the user) want enforced, add a line to the card description in this exact format:

```
Depends_on: <shortid>
```

Or for multiple:

```
Depends_on: <shortid1>, <shortid2>
```

The pipeline parses this on pickup (step 3 above) and refuses to pick up a card whose prereqs are still in flight. With a comma-separated list, **all** listed prereqs must sit in Merged before pickup is allowed. Use the Trello short URL id (8 chars, e.g. `ncqUCazM`), not the full card id — that's what the pipeline grep-uses for cross-card references.

If you don't add the line, the pipeline assumes no dependencies and proceeds. The convention is opt-in.

## Per-stage actions

Each stage produces an artifact. Move the card + comment the artifact back immediately after the stage succeeds.

### Brainstormed

Run `/ce:brainstorm` (or the agency skill equivalent). Output: `docs/brainstorms/YYYY-MM-DD-<topic>-requirements.md`.

In that file's frontmatter, add:
```yaml
trello: <card_url>
```

Comment + advance:
```bash
twf comment "Brainstorm → docs/brainstorms/<file>.md"
twf next     # advances to Planned + prints Planned checklist
```

For `direct-to-work` and `needs-plan` cards: this stage was skipped at pickup (the classification landed you directly in Planned or Worked).

### Planned

Run `/ce:plan` with the brainstorm doc as input. Output: `docs/plans/YYYY-MM-DD-NNN-<type>-<slug>-plan.md`.

Add `trello: <card_url>` to the plan frontmatter. Then:

```bash
twf comment "Plan → docs/plans/<file>.md"
twf next     # advances to Worked + prints Worked checklist
```

### Worked

Run `/ce:work` on the plan. This produces code on the feature branch + a **draft PR** (per the project's AGENTS.md workflow).

For the PR body, run the bundled template script — it pulls the Trello card title/URL, plan summary bullets, test-plan checkboxes, and recent commits into a consistent shape:

```bash
scripts/gen-pr-body.sh <card-shortid> docs/plans/YYYY-MM-DD-NNN-<slug>-plan.md > /tmp/pr-body.md
gh pr create --draft --title "<conventional title>" --body-file /tmp/pr-body.md
```

The script's output always includes the `Trello: <card_url>` line so artifact linking holds. Hand-edit `/tmp/pr-body.md` before passing to `gh pr create` if any section reads off — the template is a starting point.

Then:
```bash
twf comment "Draft PR: <pr_url>"
twf next     # advances to Aesthetics Reviewed + prints checklist
```

### Aesthetics Reviewed

A named gate for visual + UX judgment. The Reviewed column (later) covers
correctness, maintainability, testing, api-contract — none of those agents
look at pixels. This column does, and *only* this column does.

**Why it sits between Worked and Tested inSitu:** by the time `Tested inSitu`
runs, the artifact has shipped to a device and the visual debt is now
"discovered after install" rather than "caught before." The reference
comparison gate from CLAUDE.md ("ffmpeg hstack of mock vs gameplay frames
BEFORE declaring done") belongs *before* device install, not after.

**For non-visible cards (engines, refactors, headless logic):** this stage
is a 30-second skip. Comment `"Aesthetics: non-visible card, skipped"` and
`twf next`. The point is naming the question, not forcing busywork.

**For visible cards (UI work, scenes, juice, layout, styling, anything that
renders pixels):**

The pipeline does **not** do the visual analysis itself — context budget
matters and the main agent rationalizes too easily. **Spawn a dedicated
sub-agent** that specializes in screenshot + game UX/UI assessment.

1. Capture a short playthrough video (`adb shell screenrecord /sdcard/look.mp4`,
   3–8 seconds, the natural happy-path of the feature).
2. Sample 4 representative frames to disk via `ffmpeg`:
   ```bash
   ffmpeg -i /tmp/look.mp4 -vf "select='eq(n\,0)+eq(n\,30)+eq(n\,60)+eq(n\,90)'" \
     -vsync vfr /tmp/frame-%02d.png
   ```
   (Or use the playthrough's natural beats: opening frame, first interaction,
   mid-play, end-state.)
3. Spawn the **game-aesthetics-reviewer** sub-agent. In Codex, use
   `spawn_agent`; in Claude Code, use the Task tool with
   `subagent_type: "general-purpose"`. Use the prompt body from
   `scripts/aesthetics-reviewer-prompt.md` (bundled with this skill).
   Fill the `<...>` placeholders with:
   - Paths to the 4 frame PNGs.
   - Card title + description.
   - Path to the design doc (`designs/games/<name>.md` if it exists), or
     `null`.
   - A sibling-game reference image path **if one exists** (e.g.
     `games/arrow/todos/refdiff/ours-V1-shipped.png`); otherwise `null`.

   The sub-agent loads the images itself (multimodal `Read`), runs the
   adversarial assessment per the bundled prompt, and returns a JSON-
   shaped report of findings. **Main session never `Read`s the PNGs** —
   the sub-agent absorbs the pixel context, summarizes in text, and the
   main session only reads the findings. This is what keeps the main
   session's context budget bounded while still putting design eyes on
   the screen.

4. **Parse the sub-agent's findings:**
   - **P1 visual** — blocks the column. Fix-in-place (regress to **Worked**
     with `twf back --to worked --reason "<why>"`), then re-spawn the
     reviewer when fixes land. P1 examples: brand-violation (looks like
     stock Phaser / dark Bootstrap), unreadable text, broken layout, status-
     bar overlap on critical UI, touch targets <44px.
   - **P2 visual** — fix-in-place same column or file as a follow-up card.
     Examples: spacing nits, color saturation, juice timing.
   - **P3 visual / nice-to-have** — comment on the card and continue.

5. Comment the outcome:
   ```bash
   twf comment "Aesthetics review (sub-agent): <N findings>: <one-line summary per P1/P2>. Frames at /tmp/frame-*.png."
   twf next     # advances to Tested inSitu + prints checklist
   ```

**The key discipline this column enforces:** *somebody with design eyes has
to look at this before it ships, and the main session is not that somebody.*
The sub-agent is, by virtue of being prompted only with images + brand
tenets, free of the "I built this so it must be fine" rationalization. Its
findings are adversarial by construction.

### Tested inSitu

Verify the change works on the plugged-in Android device via `adb`.

**Context discipline for images:**
- Save screenshots to disk, don't `Read` them inline unless the question is genuinely visual
- Prefer text signals: `adb logcat`, `adb shell uiautomator dump`
- For multi-step flows: use `adb shell screenrecord /sdcard/shot.mp4` rather than per-frame PNGs
- At clean stage boundaries, run `/compact` if you sense context getting heavy

**Pass criteria:** app installs, launches, and the specific feature from the card actually works on the device when the card has runtime/device behavior. For non-visible work, record the reason device proof is not the right artifact and name the substitute check.

```bash
twf comment "InSitu: <verified|substituted-local|skipped-nonvisible|blocked> on <device-or-local>: <what proved it>; gate: <none-or-next-check>"
twf next     # advances to Reviewed
```

### Reviewed

Run `/ce:review` (the `ce-code-review` skill). It spawns the tiered review-agent ensemble in parallel on the PR diff (`spawn_agent` in Codex; Task/subagents in Claude Code) — no separate agent-list file is needed; the skill selects the personas. "Self-review clean" is NOT an acceptable finding. The card comment MUST name at least one specific finding (by agent + file:line) and how it was addressed OR explicitly state "N agents ran, 0 findings."

Address findings:
- **Fix-in-place** for local issues (bugs, style, missing tests)
- **Regress a column** only if the issue is structural — `twf back --to planned --reason "<why>"` for plan rework, or `twf back --to brainstormed --reason "<why>"` for product rework

After review fixes land, re-run `adb` verification to make sure the insitu behavior still holds.

**Why this is strict:** post-hoc reviews at the sprint-end level have caught 25+ findings that per-card "self-review" missed entirely. The cost asymmetry — running ce:review is cheap; skipping it leaves real bugs in "Merged" — makes the stricture worth it. Run the stage. Quote the agents.

```bash
twf comment "Review: <N agents ran>, findings: <bullets with agent+file:line>, addressed by <action>"
twf next     # advances to Evidence Captured
```

### Evidence Captured

Run `ce-evidence` in pipeline mode. Pass the plan path and feature folder when known:

```bash
ce-evidence mode:pipeline plan:docs/plans/<plan>.md feature:features/<N>_<name>
```

The skill must always write an evidence artifact and return fenced JSON with `status`, `artifact_path`, `verdict`, `gaps`, and `next_action`.

TWF is the parent workflow, so it interprets the result:
- `passed` — comment `Evidence: verified (<contract>) → <artifact_path>` and advance.
- `partial` — advance only when the gaps are explicit and acceptable for PR review. Comment `Evidence partial accepted (<contract>): <risk> / release gate: <next_action> → <artifact_path>`. If the gaps are not acceptable, move back to Worked with `twf back --to worked --reason "partial: <next_action>"`.
- `blocked` or `failed` — do not silently continue. Move back to Worked with `twf back --to worked --reason "<status>: <next_action>"` unless the user explicitly instructs the pipeline to proceed.

Classify the artifact contract before commenting:
- `visual-runtime` — screenshots/video or live-device proof carries the signal.
- `headless-logic` — tests, logs, schemas, or command output carry the signal.
- `docs-policy` — rendered document/report plus diff carries the signal.
- `release-gate` — work is intentionally blocked on a later external validation.

For `passed` or explicitly accepted `partial`:

```bash
twf comment "Evidence: verified (<contract>) → <artifact_path>; <verdict>"
twf next     # advances to Video Sent
```

For `blocked`, `failed`, or unacceptable `partial`:

```bash
twf back --to worked --reason "<status>: <next_action>"
```

### Video Sent

Send the user-facing proof of the work via Telegram (`telegram-send`, outbound-only). This runs *after* Reviewed and Evidence Captured so the handoff reflects the shipping version, not an intermediate state.

**Handoff is mandatory; mp4 is conditional.** For visible runtime/UI/gameplay cards, send a device video when possible, or a Playwright video fallback when the connected device is unavailable. For non-visible work, send a concise artifact/report link and summary instead of manufacturing a useless mp4. For release-gated work, send the gate and who/what must validate it. The column is called Video Sent for historical continuity, but the real contract is "Batu gets the right proof artifact."

> **No inbound reply channel.** `telegram-send` is send-only; the pipeline
> cannot receive async Telegram replies today (the former pull/veto windows
> ran on a bridge that is **not currently available** on this host). So the
> flow is **notify + proceed**: send the proof, comment it on the card, and
> advance — do not wait for feedback. Any user reaction to the video arrives
> out-of-band (Trello comment, next session's scan) and is handled as a fresh
> card or hotfix then, not by blocking here.

**Visual-runtime device path (preferred):**

```bash
adb shell screenrecord /sdcard/shot.mp4 &
# perform the flow on device
# stop recording (ctrl-c or timeout)
adb pull /sdcard/shot.mp4 /tmp/<card-shortid>.mp4

telegram-send /tmp/<card-shortid>.mp4 "<card title>: <1-2 sentence explanation of what the change does>"
twf comment "Handoff sent (visual-runtime): /tmp/<card-shortid>.mp4"
twf next     # advances to Compounded — do not wait for a reply
```

If a user later asks for changes (e.g. "5x the juice", "the sound is wrong on level 2") via a Trello comment or the next session's scan, branch a hotfix off the **already-merged** main commit (or off the current branch if not yet merged):

```bash
git checkout main && git pull --ff-only   # if already merged
git checkout -b <card-shortid>-hotfix     # follow-up branch namespace
# implement the requested change; same pipeline as a fresh card
# (Worked → Tested inSitu → Reviewed → Evidence Captured → Video Sent → Compounded → Merged)
```

**Non-visible path:**

```bash
telegram-send -m "<card title>: <1-2 sentence result>. Artifact: <report-or-evidence-link>"
twf comment "Handoff sent (non-visible): <report-or-evidence-link>"
twf next
```

**Release-gate path:**

```bash
telegram-send -m "<card title>: ready for <external validation>. Gate: <who/what/when>"
twf comment "Handoff sent (release-gate): <who/what/when>"
twf next
```

**Playwright fallback for visual-runtime cards (when device unavailable):**

```js
// /tmp/record-<card-shortid>.cjs
const { chromium } = require('<repo>/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 500, height: 900 },
    recordVideo: { dir: '/tmp/<dir>', size: { width: 500, height: 900 } },
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:<vite-port>/');
  // interact with the feature …
  await page.close(); await context.close(); await browser.close();
})();
```

Convert the saved `.webm` to `.mp4` with ffmpeg and send it with `telegram-send /tmp/<card-shortid>.mp4 "<caption>"`. The resulting video demonstrates the feature end-to-end; it's a stand-in for device verification that user testing later confirms, not a replacement, but shipping-visible artifact vs nothing.

The `<shortid>-hotfix` branch namespace makes the relationship to the parent card grep-discoverable. Comment the hotfix branch name on the original card so the comment thread captures the followup arc.

Whichever path you take, the card comment follows the same shape — `twf comment "Handoff sent (<contract>): <artifact-or-link>"` where `<contract>` is `visual-runtime` / `non-visible` / `release-gate` — then `twf next`. The video-sent step is non-blocking by design: send the proof, comment the artifact, advance. Because there is no inbound channel, there is nothing to wait for — the old bounded pull windows are gone, not merely skipped.

### Compounded

Run `/ce:compound`. If there's nothing worth learning, that's fine — the card still moves. Comment the outcome (path to any `docs/solutions/*.md` produced, or `"nothing new to compound"`).

**After `/ce:compound` produces a doc, append a one-line entry to `docs/solutions/INDEX.md`** so the folder stays skimmable without grep:

```bash
scripts/append-solutions-index.sh <new-doc-path>
# Or inline:
echo "- $(date +%Y-%m-%d) — [<topic>](<filename>) — <one-line hook>" >> docs/solutions/INDEX.md
```

The script (`scripts/append-solutions-index.sh`, bundled with this skill) handles the fields automatically by reading the doc's frontmatter. If `docs/solutions/INDEX.md` doesn't exist yet, the script creates it with a header.

This append step is a workaround until `/ce:compound` itself does it upstream — once the plugin ships that, drop this step.

```bash
twf comment "Compound → docs/solutions/<file>.md"  # or "Nothing new to compound"
twf next     # advances to Merged
```

### Merged

The merge was historically user-gated via a Telegram notification with a short veto window. **That veto window is not currently available** — `telegram-send` is send-only, so there is no channel to receive a "don't merge" reply before the timer fires. Send the merge notice for visibility and proceed; a squash-merge is revertible, so if the user objects out-of-band afterward, address it as a follow-up (revert / hotfix) rather than blocking here.

```bash
telegram-send -m "Merging <card_title>: <pr_url> — squashing now (no inbound veto channel; reply on Trello to revert)"
gh pr merge --squash --delete-branch <pr_number>
twf comment "Merged as <merge_sha> (#<pr_number>)"
twf next     # advances card to Merged column
```

If merging some card is genuinely too risky to do without an explicit human OK, don't fake a veto window that can't fire: park it with `twf park blocked --reason "awaiting merge approval: <pr_url>"` and surface it to the user out-of-band, then move to the next Todo.

## Telegram notifications (outbound only — there is no inbound channel)

The pipeline runs semi-autonomously, but you'll hit moments that historically needed user input: ambiguous cards, design calls, pre-merge vetoes, mid-test tuning feedback. **On this host there is no packaged inbound channel** — `telegram-send` is send-only, and the former persistent-scope bridge (message inbox, `/scope trello`, one-shot asks, wake-on-message) is **not currently available**. So the pipeline cannot receive async Telegram replies. Notifications flow one way: agent → user.

This is a real behavior change, not just wording: the pipeline has lost its interactive user-reply channel. Every flow that used to *ask and wait* must now either **proceed on best judgment** (reversible, local decisions) or **hard-block out-of-band** (irreversible ones), never poll a dead inbox.

### Outbound notifications

Use `telegram-send` for everything the user should see:

```bash
telegram-send -m "<one-line status>"                 # text
telegram-send /tmp/<file>.mp4 "<caption>"            # file + caption
```

Send liberally — progress, what shipped, what's parked, dev links. The user reads these at their convenience; you never wait on a response.

### Inbound / interactive waits — not currently available

The flows below used to block on a user reply. With no inbound channel they collapse to notify-and-decide:

- **Reversible, local decisions** (branch name, tuning values, implementation choice, test naming, which follow-up to file first): **take your best guess, comment the guess + rationale on the card, and continue.** Don't stop; don't pretend to wait.
- **Irreversible / high-blast-radius decisions** (new dependency, prod deploy, Firebase/AdMob config, breaking a public API, anything that writes to user data, rewriting git history, force-push): **hard-block out-of-band.** Park the card with `twf park blocked --reason "<what would unblock it>"`, send a `telegram-send` notice so the user knows it's waiting, and move to the next Todo. Do **not** guess on these.

There is no session flag to "skip the waits" anymore — there are no waits to skip. The old 120 s / 60 s pull windows and the "don't-wait-for-responses" flag are gone because the mechanism they toggled (`ccbot pull`) has no implementation.

### What you just do vs. what you block on

| Decision type | Action |
|---|---|
| Branch names, classification, implementation choices inside the plan, fixing review findings | Just do |
| Ambiguity in the card's intent, design decisions that change user-visible behavior beyond what the card specifies | Best-guess + comment rationale on the card, continue; notify via `telegram-send` |
| New dependencies, prod deploy, Firebase/AdMob config, anything that writes to user data | Hard-block: `twf park blocked`, notify out-of-band, never guess |

Err on the side of doing when the decision only affects the current branch and you can back it out with `git`. Err on the side of parking-and-notifying when a decision is hard to reverse — because you can no longer ask and wait.

### Anti-pattern: blocking shells waiting for a reply that can't arrive

**Never** park yourself on a blocking shell command (like a 60-second `sleep`) "in case the user replies." No user reply can reach this session — there is no inbound channel. If a decision truly requires human input, park the card and move on; don't burn wall-time on a wait that has no listener.

## Never stop between cards

The whole point of the pipeline is flow. When a card is Merged, the next action is **immediately pull the next Todo** — not "ask the user if I should continue". There is no good reason to stop between cards. Only these signals halt the loop:

- **Todo is empty** — nothing left to pull. Run the wind-down sequence (below).
- **`Blocked on Batu` queue full with no unblocks** — means you've run out of actionable work. Wind down.
- **User says halt out-of-band** — any explicit "stop", "wait", "pause", or a blocking question the user surfaces where you can see it (a Trello comment caught on the next scan, or a direct instruction in this session). Honor it immediately. Note there is no live inbound channel, so such a halt won't interrupt mid-work — it's caught at the next scan/stage boundary.
- **A card gets blocked mid-pipeline** — park it, move to next Todo. Not a stop signal.

Between cards: post the per-card summary to the user via `telegram-send -m "..."` (so they see what shipped), then immediately run the "Starting a session" flow from step 3 onwards to pick up the next card. Do **not** ask "want me to continue?" — the answer is always yes unless they've already said stop (and there is no inbound channel to hear a "stop" mid-run anyway; honor one only if it arrived out-of-band, e.g. a Trello comment you see on the next scan).

**Skip cards tagged with sentinels in the title or description:**

- `[needs-batu]` — user decision required before pickup. Skip it; log in the between-cards summary so the user knows it's sitting there.
- `[blocks-on <other-shortid>]` — soft dependency the `Depends_on:` regex doesn't cover (prose-level, UX-level, design-level). Skip until the referenced card lands.
- `[pause]` — card parked informally but not in `Blocked on Batu`. Skip.

Pre-release cards (any list named `Pre Release Check List` or similar — configurable in `agents/config.json`) are **never auto-picked** regardless of sentinels. They sit in their own queue and wait for their trigger condition (DAU threshold, engineer #2 joining, pre-launch gate).

### Decision points during `/ce:brainstorm` or `/ce:plan`

When `/ce:brainstorm` or `/ce:plan` would normally use `AskUserQuestion` or pause in chat, you **cannot** route the question to the user and wait — there is no inbound channel. Decide by blast radius instead:

- **Product-axis questions** (architectural direction, hosting choice, major API shape): pick the research-backed default, log `[auto-decided YYYY-MM-DD: <rationale>]` in the requirements/plan doc frontmatter, and optionally `telegram-send -m "..."` a heads-up. Continue.
- **Scope / priority questions** (which follow-up card to file first, in-doc nits, micro-decisions with low blast radius): pick the most trigger-imminent option, note it in a card comment. Continue.
- **Irreversible actions** (adding a dependency, deploying prod, breaking a public API, rewriting git history, deleting branches, force-push): **hard-block out-of-band.** Park the card with `twf park blocked --reason "<what would unblock it>"`, `telegram-send` a notice, and move to the next Todo. Do not guess.

The distinction: *if I pick wrong, can this be redirected later at low cost?* Yes → best-guess-and-continue with the rationale logged. No → park-and-notify. Because you can no longer ask-and-wait, the reversible tiers resolve to a logged best guess rather than a timed poll.

See `agents/policy/AGENTS.md` § Autopilot Mode for the canonical decision-tier table.

### Session wind-down — summarize and exit

When you genuinely have no more actionable work (Todo empty AND Blocked-on-Batu full of cards waiting on user input you can't resolve), don't sit polling — there is nothing to poll. Post a final summary and exit cleanly.

Steps:

1. Post a final session summary via `telegram-send -m "..."` (what shipped, what's parked, what would unblock things).
2. Suggest `meta-compound` if a non-trivial session occurred (≥1 commit).
3. **Exit cleanly.** No polling loop, no blocking wait.

> **Auto-respawn-on-message is not currently available.** The former wake-marker
> mechanism (`~/.ccbot/last-resume.json`, a `cc-gateway` service watching for a
> stale scope heartbeat, and `claude-session resume <session_id> <cwd>`) has **no
> implementation on this host** — there is no gateway process and no inbound
> Telegram channel to trigger a respawn. Do not write a wake marker; it would
> never be read. When the user next wants the pipeline to run, they start a fresh
> session, which re-scans the board and carries on from the current column state
> (the board and comment thread are the durable handoff — see "Session
> continuity").

## Concurrency

Only one card is "active" (unblocked, being worked) at any moment. Blocked cards live in the `Blocked on Batu` list with a comment explaining what would unblock them. When picking up the next card after a block, the queue is:

1. Any un-blocked card already in flight (there shouldn't be one — you blocked it because you couldn't proceed)
2. Top of Todo

You may end up with several cards sitting in `Blocked on Batu` while you work fresh Todos. That's expected — the list is what keeps you honest about not silently dropping them. On session start, scan `Blocked on Batu` first: sometimes the user has answered a blocker in Telegram or by commenting on the card, and you can un-park it before pulling a new Todo.

## Artifact linking discipline

Every artifact links back to the card, and the card links forward to every artifact. Without this, future sessions can't navigate. Concretely:

| Artifact | Card linkage | Artifact linkage |
|---|---|---|
| Brainstorm doc | `trello: <card_url>` in frontmatter | Comment `<path>` on card |
| Plan doc | `trello: <card_url>` in frontmatter | Comment `<path>` on card |
| Branch | Named `trello-<shortid>-<slug>` | Comment branch name on card |
| PR | `Trello: <card_url>` in body | Comment PR url on card |
| Evidence | Evidence artifact path | Comment `Evidence: <status> → <artifact_path>` |
| Merge | SHA | Comment merge SHA on card |

When in doubt, over-comment. A Trello card whose comment thread reads like a complete narrative of the work is the ideal.

## Fix-in-place vs. move-back

Most review and compound findings should be fixed on the same branch, same card column. Only move the card back a column when the structure of the work is wrong:

- Review finds the *plan* was misaligned with the brainstorm → back to **Planned**, redo the plan, forward again
- Review finds the *brainstorm* missed a requirement → back to **Brainstormed**
- Tests fail on device in a way that requires design rework → back to **Planned** or **Worked**

Small issues (naming, missing test, a bug in the implementation) are fix-in-place on **Reviewed** without moving backward.

## Session continuity

Your session will end. The next session will pick up. What they have to work with:

- The card's column + all comments
- `git log` on the branch (named by short id)
- Brainstorm + plan docs (linked by card url)
- PR + CI status

So: **commit messages are the handoff medium**. Write them for a stranger. Every meaningful decision goes in the commit message or in a Trello comment — not just in your head.

If your session ends mid-card, leave the card in whatever column its last completed stage was. Don't pre-move cards.

## Bundled scripts

The `twf` state-machine CLI used throughout this skill ships as an agency package entry point (`agency.tools.twf`), installed on PATH by `uv tool install agency`. Commands (run `twf --help` for the authoritative list): `pickup | next | back | park | status | scan | sitrep | comment | handoff | board | run-card | merge-card | explore | conductor-prompt | conduct | ledger | metrics`. Active card inferred from git branch (`trello-<shortid>-<slug>`); `--card <shortid>` overrides for any command. See "Why `twf`, not raw `trello`" above for the rationale.

This skill also bundles two helper scripts under its `scripts/` dir:

- **`scripts/gen-pr-body.sh <card-shortid> <plan-doc-path>`** — used in the Worked stage to template the PR body from card + plan + git log. Output to stdout; redirect to a file and pass to `gh pr create --body-file`.
- **`scripts/append-solutions-index.sh <doc-path> [hook-text]`** — used in the Compounded stage to append a one-line entry to `docs/solutions/INDEX.md`. Auto-creates INDEX.md on first call. Idempotent — won't double-add a doc.

Both are project-agnostic; they read git/trello/the doc itself for inputs, no project-specific config beyond `agents/config.json`. Path: `<project>/agents/skills/trello-pipeline/scripts/` (synced from the agency catalog).

## Self-improvement

If you notice this workflow repeatedly failing in the same way, don't silently work around it. Propose an edit to this SKILL.md (to the user, for approval). The whole point of a skill is that improvements compound across sessions.

## Anti-patterns to avoid

- **Calling `trello move` or `trello comment` directly during a pipeline card.** The whole point of `twf` is to surface the next column's checklist atomically with the move. Bypassing it skips the checklist surface — the exact failure mode `twf` exists to fix. If you find yourself reaching for the raw CLI, stop and use `twf next` / `twf comment` instead.
- **Moving cards ahead of the artifact.** Column state must reflect reality — never `twf next` to Planned before the plan doc exists, never `twf next` to Worked before the PR is open.
- **Reading screenshots inline when text would do.** Auto-compact kills sessions. Use `adb logcat`, text dumps, and on-disk screen recordings.
- **Merging without the Telegram pre-announce.** The 60-second veto window is cheap insurance; skipping it means the user can't stop a bad merge.
- **Waiting for a Telegram reply.** There is no inbound channel — `telegram-send` is send-only. Never block a card waiting for the user to answer; decide by blast radius (best-guess-and-continue, or park-and-notify) per "Telegram notifications" above.
- **Blocking shell sleeps waiting for input.** A `sleep N` "in case the user replies" is dead wall-time — no reply can reach this session. If a decision needs human input, park the card and move on.
- **Stopping between cards to ask permission.** The user kicked off the pipeline — "should I continue?" is implicitly answered until they say otherwise. Post a summary, pull the next Todo, keep going.
- **Letting `blocked-on-batu` cards sit without a comment explaining what's needed.** A blocked card with no unblock-criteria is a dead card.
- **Starting a new card while an old one still has un-addressed review findings.** Fix in place first.
- **Skipping the video-sent step.** It's non-blocking for pipeline progression, but it's the user's primary visibility into what you're shipping. Never silently skip it.

## Config format

`agents/config.json` needs a `trello` section mapping the pipeline stages to actual Trello list IDs. IDs (not names) are what the CLI uses, so list renames/typos on the board don't break anything.

```json
{
  "trello": {
    "board_id": "<board_id>",
    "board_name": "Find The X",
    "lists": {
      "ideas": "<list_id>",
      "todo": "<list_id>",
      "brainstormed": "<list_id>",
      "planned": "<list_id>",
      "worked": "<list_id>",
      "aesthetics_reviewed": "<list_id>",
      "tested_insitu": "<list_id>",
      "reviewed": "<list_id>",
      "evidence_captured": "<list_id>",
      "video_sent": "<list_id>",
      "compounded": "<list_id>",
      "merged": "<list_id>",
      "blocked_on_batu": "<list_id>",
      "archive": "<list_id>"
    }
  }
}
```

Get list IDs from the Trello UI (each list URL or the underlying API exposes them). The bundled `twf` reads them from `agents/config.json` — you don't invoke trello directly to find them after first setup.

## Starting a session

When this skill triggers:

1. **Verify `agents/config.json`** has the `trello` section. `twf scan` will fail loudly if not.
2. **Load the `telegram-bridge` skill** for outbound `telegram-send` notifications. There is no inbound channel to set up — user communication is one-way (agent → user); see "Telegram notifications" above.
3. **Send a start notice** (optional): `telegram-send -m "Trello pipeline starting."`. Do not wait for a reply — none can arrive.
4. **Run `twf scan`.** Output has three sections: Blocked-on-Batu (check for resolving comments → unpark candidates), in-flight (any half-finished card from a prior session → finish it first), and top of Todo.
5. **For Blocked-on-Batu cards with new resolving comments:** unblock with `twf back --to <prior_column> --reason "<unblock note>" --card <shortid>` and prioritize ahead of fresh Todos.
6. **For in-flight cards:** check the latest comment, decide which column to resume from, and continue. If unsure, `twf status --card <shortid>` prints the active checklist for whatever column it's in.
7. **Else: name the top Todo you'd pick up** (via `telegram-send -m "..."` to the user, for visibility).
8. **Wait for explicit "go"** — first session only, and only if the user is driving this session interactively (there is no inbound Telegram channel to receive a "go" through). Subsequent cards in the same run go automatically; see "Never stop between cards" above.
9. Create the branch, then `twf pickup <shortid> --classification <gate>`. Pipeline begins.

Do not silently start working cards on a fresh session — the first "go" is the only thing you wait for. After that, the pipeline runs until Todo is empty or the user halts.
