# End-of-process review — prioritized process updates

Card **uRpkmITI** (depends_on KEghp3x4, MQPvX0qi). The full-process retrospective
Batu mandated after the 2026-07-06 fabrikav2 night run. This card is **analysis +
spec only**: implementation of agency-repo changes is Batu-gated and out of write
scope. Nothing here touches `agents/policy/AGENTS.md`, `twf`, or the skills — it
tells the next (gated) session exactly what to change and why, with each item
citing its incident evidence.

**Inputs synthesized**

- `docs/retros/2026-07-06-night-run-notes.md` — friction ledger F1–F16 + what-works.
- `docs/agency-twf-improvement-ideas.md` — 19 improvement ideas held by the conductor.
- `docs/retros/insitu-testing-capability-notes.md` — device/reference-capture gaps.
- `docs/retros/harness-evaluation.md` (from KEghp3x4) — dogfood grade of the testkit + tier-2 Gemini pilot.
- twf metrics report (`.twf/metrics/events.jsonl`, fabrikav2) — 22 cards, per-stage wall time.
- The evaluation ledger `~/.local/share/agency/ledger/board.jsonl` — 319 records (279 spawn, 40 land), task-class × model × rework-rounds × plan-friction.

**Companion artifact:** `docs/retros/2026-07-06-end-of-process-review.html`
(self-contained, house-style — the human-facing version of this doc).

---

## 1. What the numbers say (one page from the ledger + metrics)

Everything in this section is traceable to `board.jsonl` (the evaluation ledger)
and `twf metrics report` on fabrikav2. Reproduce with the queries in Appendix A.

### 1a. Rework concentrated in *first-of-kind* work; ports & composition needed none

29 `land` records carry outcomes (`rework_rounds`, `verdict`, `plan_friction`).
No card needed more than **one** rework round. The split:

| rework_rounds | # cards | share |
|---|---|---|
| 0 | 21 | 72% |
| 1 | 8 | 28% |
| ≥2 | 0 | 0% |

The 8 cards that needed a rework round, by task class:

| Card | Task class | plan_friction |
|---|---|---|
| iz57J8mL | scaffold-infra | 4 |
| p9eS4dQf | tooling-linters | 4 |
| QzqGf6el | template-scaffold | 4 |
| X50H87vS | sdk-contract (new wire) | 4 |
| M3ngFJXt | sdk-port-generalize | 4 |
| XwYJKFHk | services-worker-generalize | 4 |
| 9SbVZcm7 | game-port-pilot | 5 |
| dcEkgvae | harness-adoption-first-consumer | 5 |

**The pattern is the headline finding.** Rework clusters in three shapes:
scaffolding/first-infra, cross-package *generalization*, and *first-consumer*
integration. Every one of these is a card where a contract or seam was being
defined for the first time. By contrast, the 21 zero-rework cards are dominated
by **pure ports** (`port-carry` ×2), **composition from existing primitives**
(`ui-primitives` ×2, `ui-screens-composition`, `ui-shop-composition`), **pure
additive wiring** (`sdk-wiring`), and the **design-sheets CLI** cards
(`dsheets-schema-cli` ×4, `dsheets-format-support` ×2).

This is direct quantitative support for friction items **F4** (shared
registration points collide) and **F5** (cross-package contracts need a declared
owner): the rework tax lands exactly on the seam-defining cards, and the fixes
that target seams (recs #3, #5 below) attack the measured cost, not a hunch.

### 1b. Ceremony is real and measurable — the non-`worked` stages are ~1-second marches

From `twf metrics report` (fabrikav2). Active-time is 0s across the board because
Codex/token instrumentation isn't wired (see 1d), but **per-stage wall time is
recorded** and it exposes the ceremony tax cleanly. Representative cards:

| Card | planned | worked | tested_insitu | reviewed | evidence | video | compounded |
|---|---:|---:|---:|---:|---:|---:|---:|
| Fw1NtsCr (port-carry) | 0s | 9m | 1s | 1s | 1s | 1s | 1s |
| GjUg0sbk (sdk-contract) | 0s | 11m | 1s | 1s | 1s | 1s | 1s |
| KEghp3x4 (harness-eval) | 1s | 1s | 0s | 0s | 0s | 0s | 0s |

The real work happens in `worked` (minutes to hours); every downstream gate is a
1-second `twf next` + comment. That is the conductor marching a one-pass card
through 6–8 columns of pipeline that had no per-stage work to do — the mechanical
confirmation of **F1** ("~30% of conductor actions tonight were column-marching
ceremony") and **F16** (a pure-implementation card forced through a `brainstormed`
checklist that demanded a requirements doc). *This very card* hit F16: the raw
`todo → brainstormed` transition surfaces a "run /ce:brainstorm, write a
requirements doc" checklist that is nonsense for an analysis deliverable.

### 1c. Model routing happened; model *evaluation* is not yet possible from the ledger

279 spawn records carry the routed worker model:

| Model | spawns | share |
|---|---:|---:|
| gpt-5.5 (codex) | 134 | 42% |
| claude-opus-4-8 | 118 | 37% |
| claude/opus (conductor summarizer) | 30 | 9% |
| claude-fable-5 | 20 | 6% |
| gpt-5-mini | 4 | 1% |
| gpt-5 / codex-gpt-5.5 / null | 13 | 4% |

But **the 29 outcome-bearing `land` records are all attributed to
`worker.model = claude/opus`** (the conductor doing the land bookkeeping), not to
the model that actually did each stage. So task-class × *worker-model* performance
— the exact input improvement-idea **#14** (`twf metrics route-suggest`) needs — is
**not computable today**. The routing decisions (codex for the marble_run review +
the full reskin drill, per the night-run cross-vendor plan) exist as prose in the
notes, not as joinable ledger fields. This is a schema gap, filed as rec #8.

The one cross-vendor outcome we *can* read: **MQPvX0qi** (reskin-drill-acceptance,
run fully on codex) landed **partial-accepted** with `plan_friction = 3` — the
lowest friction score and the only non-clean verdict, tied to the state-drift
caveat the harness eval documents. One data point, not a verdict on the vendor.

### 1d. Instrumentation gaps that cap this analysis

- `cost.tokens` and `cost.wall_s`: **0/319 populated.** Token economics of the run
  are unmeasured; the metrics report shows `Tokens: 0` everywhere.
- Active-time: 0s in every stage (5-minute-idle-capped agent-log estimate found no
  Codex activity logs to attribute). Wall time is the only usable time signal.
- **The `plan_friction` scale is inverted between sources** (see 1e) — a
  correctness bug in the metric itself.

### 1e. The friction scale is defined two opposite ways — fix before trusting it

The ledger's `plan_friction` and the `twf handoff --friction` flag describe
"how well the plan survived contact with reality," where the data shows **5 = plan
survived cleanly** (20 of 29 cards scored 5, almost all with 0 rework and
`accepted`). But `harness-evaluation.md`'s friction table defines **1 =
frictionless … 5 = blocked / had to hand-roll** — the *opposite* direction. Two
docs, same word, inverted scales. Any future `route-suggest` or dashboard that
mixes them will rank backwards. Cheap to fix (rec #17); flagged loudly because it
silently corrupts every downstream aggregate.

---

## 2. Prioritized, effort-estimated update list

Priority ≈ (incident frequency × cost-per-incident) ÷ effort. Effort: **XS** <30min,
**S** ~1–2h, **M** ~half-day, **L** ~1+ day. Every item cites its incident
evidence (F# from the night-run ledger, idea# from the improvement doc, and/or the
numbers above). Targets are tagged: `[twf]` CLI, `[AGENTS]` policy doc,
`[skill]` twf-conduct/trello-pipeline, `[card-tmpl]` card-writing templates.

### Tier S — do these first (detailed specs in §3)

| # | Update | Targets | Evidence | Effort |
|---|---|---|---|---|
| 1 | Per-project merge gate (config-driven, `npm install` pre-step) | `[twf]` | F2, F8, idea 1; hit **every** TS landing (22 cards) | M |
| 2 | Honor card classification + collapse non-applicable gates | `[twf][card-tmpl][skill]` | F1, F3, F16, idea 2/3; §1b ceremony, §1c routing | M |
| 3 | Contract-ownership line + zero-adaptation round-trip test for cross-card seams | `[card-tmpl][skill]` | F5, idea 9; §1a rework on `sdk-contract`/`generalize` | S |
| 4 | merge-card: auto-append `land` ledger record + no-hand-merge guard + refusal hints | `[twf]` | F7, F7b, F8, idea 4/5/8; §1c ledger gap | M |
| 5 | Shared-utils preflight in multi-subtree cards | `[card-tmpl][skill]` | F4, idea 10; `with-timeout` vendored 3× (real defect) | S |

### Tier A — high value, next wave

| # | Update | Targets | Evidence | Effort |
|---|---|---|---|---|
| 6 | `.twf/` in project-bootstrap gitignore | `[twf][AGENTS]` | F9, idea 7; first-spawn stranded | XS |
| 7 | `twf next --through <col>` batch advance / `pipeline: short` class profile | `[twf][skill]` | F1, idea 2; §1b (overlaps #2, ship together) | M |
| 8 | Ledger: `land` records must carry per-stage `worker.model` | `[twf]` | §1c; unblocks idea 14 route-suggest | S |
| 9 | Capacity preflight live-quota probe + `twf agents failover` routine | `[twf]` | idea 13a/13; codex cap + Gemini 429 (F16 NEEDS-BATU) | M |
| 10 | `run-card` cwd-safe + `--sync-main` | `[twf]` | F12, idea 6/17; manual main-merge every 2nd pass | S–M |

### Tier B — codify when convenient

| # | Update | Targets | Evidence | Effort |
|---|---|---|---|---|
| 11 | Session-history skills in default install set | `[AGENTS]` | F10, idea 12; lost v1 corrections evidence | XS |
| 12 | Conductor evidence-capture → gitignored `.work/` convention | `[skill][AGENTS]` | F11, idea 16; dirty-tree respawn | XS |
| 13 | Aesthetics-gate transfer semantics (name receiving card on both) | `[skill][card-tmpl]` | idea 11; worked well, codify | XS |
| 14 | Template/linter co-evolution rule per new generated-artifact class | `[skill][AGENTS]` | F15, idea 19; ios/ tripped whitelist | S |
| 15 | Background-worker respawn playbook / `run-card --resume` PID check | `[twf][skill]` | F6, idea 15; 6 workers died on interrupt | M |
| 16 | Native-build playbook (SPM Capacitor) → skill/tool | `[skill]` | F13, F14, idea 18; an evening of cwd archaeology | L |
| 17 | Disambiguate the `plan_friction` scale (one direction, documented) | `[twf][skill]` | §1e; scale inverted across two docs | XS |

### Out of scope for *this* card (product/testkit cards, already drafted)

The in-situ device gaps (`insitu-testing-capability-notes.md` items 1–7) and the
six harness-evaluation card drafts (reach-recipe state-pinning, `refs/manifest.yaml`,
blank-canvas-witness signal, merceka-core two-image judge, Gemini billing top-up,
DS13 page-card round-trip) are **feature cards for the board**, not process/policy
updates. They are already carded in `harness-evaluation.md` §"Card drafts" and
belong in the fabrikav2 / testkit / design-sheets repos. Listed here only so the
end-of-process view is complete; do not fold them into the agency-policy pass.

---

## 3. Top-5 "do these first" — concrete diffs / specs

### #1 — Per-project merge gate `[twf]` (F2, F8, idea 1)

**Problem.** `twf.py:_run_verification_gate` (line 1240) hardcodes
`uv run python -m pytest -q` then `uv run ruff check`. Every TS-repo landing (all
22 fabrikav2 cards) fails this gate, so the conductor runs the npm gate by hand
each time. And after dep-adding merges (happy-dom, yaml) the main checkout's
`node_modules` is stale, causing false-fails (F8).

**Spec.** Read the gate from `agents/config.json`, run an optional pre-step first,
fall back to the current Python default when unconfigured.

```jsonc
// agents/config.json (fabrikav2)
{
  "trello": { /* ... */ },
  "twf_gate": {
    "pre": ["npm install --no-audit --no-fund"],   // F8: refresh node_modules first
    "cmds": ["npm run typecheck", "npm run lint", "npm run test:unit", "npm run audit"]
  }
}
```

```python
# twf.py — replace the hardcoded body of _run_verification_gate
def _run_verification_gate(repo_root: Path) -> None:
    cfg = _load_raw_config(repo_root)              # nearest agents/config.json
    gate = (cfg or {}).get("twf_gate")
    if gate:
        cmds = [shlex.split(c) if isinstance(c, str) else c
                for c in gate.get("pre", []) + gate["cmds"]]
    else:
        cmds = [["uv", "run", "python", "-m", "pytest", "-q"],
                ["uv", "run", "ruff", "check"]]
    for cmd in cmds:
        proc = subprocess.run(cmd, cwd=str(repo_root), capture_output=True, text=True)
        if proc.returncode != 0:
            if proc.stdout: sys.stdout.write(proc.stdout)
            if proc.stderr: sys.stderr.write(proc.stderr)
            err(f"verification gate failed: `{' '.join(cmd)}` (exit {proc.returncode}). "
                f"Merge left in the tree for inspection — no cleanup performed.", exit_code=1)
```

**Test.** Existing tests stub `gate_fn`; add one that writes a `twf_gate` config
and asserts the configured commands run in order (pre before cmds) and that a
missing config falls back to the pytest/ruff pair.

### #2 — Honor card classification + collapse non-applicable gates `[twf][card-tmpl][skill]` (F1, F3, F16)

**Problem.** Pickup routing is nondeterministic (F3): identical card shapes got a
brainstorm-artifact pass or a full implementation at the same column. And a
one-pass card is then marched through 6–8 ceremony gates (§1b), some of which
demand artifacts that make no sense for its class (F16: analysis/impl card vs a
`brainstormed` requirements-doc checklist).

**Spec (two parts).**

1. **Card carries its own classification and pipeline profile.** Add to the
   card-writing template + parse in `twf pickup`/`run-card`:

   ```
   Classification: direct-to-work        # direct-to-work | needs-plan | needs-brainstorm
   Pipeline: short                        # full | short | analysis
   ```

   `twf pickup` already accepts `--classification` and maps it
   (`CLASSIFICATION_LANDING`, twf.py:108). Make it read the card body when the flag
   is omitted, instead of the conductor guessing.

2. **Pipeline profiles gate which columns are applicable.** Define profiles as
   sets of *applicable* columns; `twf next` skips (auto-stamps "n/a for
   `<profile>`") the columns not in the set:

   ```python
   PIPELINE_PROFILES = {
       "full":     PIPELINE_SEQUENCE,                       # unchanged default
       "short":    ["todo","planned","worked","reviewed","merged"],       # infra/tooling
       "analysis": ["todo","worked","reviewed","merged"],   # docs/spec cards (THIS card)
   }
   ```

   The `analysis` profile is exactly what this review card wants: one work column
   (the report) + review + merge, no brainstorm/aesthetics/insitu/video/evidence
   ceremony. Fixes F16 at the root instead of per-card self-skips.

**Migration note.** This subsumes idea 3 and half of idea 2; ship rec #7
(`--through`) as the manual escape hatch in the same PR.

### #3 — Contract-ownership line + round-trip test for cross-card seams `[card-tmpl][skill]` (F5, idea 9)

**Problem.** The sdk owned-mirror sink and the services worker shipped
*incompatible wire shapes under the same schema tag* — each card internally green,
the mismatch cost a full extra pass (F5). §1a shows `sdk-contract`/`generalize`
cards carrying the rework. No gate caught it; only a conductor memory-note did.

**Spec.** Card-writing checklist addition (twf-conduct skill + card template):

> **Cross-card contract seam?** If this card *produces* or *consumes* a type/wire
> shape that another card on the same board consumes/produces:
> 1. Name the shared contract file in **both** card bodies:
>    `Contract: packages/sdk/src/analytics/wire.ts (owner: this card)`.
> 2. Declare exactly **one owner** card; consumers import, never re-declare.
> 3. Acceptance artifact is a **zero-adaptation round-trip test**: producer emits →
>    consumer parses with no massaging. (Pattern already proven — see the resolved
>    analytics wire-contract reconciliation.)

Add a card-lint (idea, low priority): `twf` warns if two in-flight cards both
declare `owner: this card` for the same `Contract:` path.

### #4 — merge-card: auto-ledger + no-hand-merge guard + refusal hints `[twf]` (F7, F7b, F8, ideas 4/5/8)

**Problem.** Three linked incidents: (a) conductor forgets `twf ledger add` under
load, so outcome records are sparse and per-stage model is lost (§1c); (b) two
premature "Landed" comments posted before the gate actually ran (F7); (c) on a
merge-card refusal the conductor hand-merged and hit the truncated-branch-name trap
(F7b), briefly believing code landed when it hadn't.

**Spec (three changes to `cmd_merge_card` / `twf_merge.run_merge_card`).**

1. **Auto-append the `land` record** from inside `run_merge_card` after the gate
   passes — it already has card, stage (`landed["stage"]`), verify result, and the
   worker model per stage. This closes idea 8 *and* the §1c schema gap (rec #8):
   stamp `worker.model` from the spawn record of the stage being landed.
2. **"Landed" comment only after gate-pass, from inside merge-card** (idea 5). The
   comment_fn call already lives in `run_merge_card`; assert it is unreachable
   before `gate_fn` returns 0.
3. **Refusal remediation text** (idea 4): on dirty-tree / wrong-branch refusal,
   print the exact resolving command and end with **"re-run `twf merge-card
   <shortid>` — do NOT hand-merge (truncated-branch-name trap, F7b)."** Add
   `--fix-dirty` to auto-commit lockfile-only changes.

### #5 — Shared-utils preflight in multi-subtree cards `[card-tmpl][skill]` (F4, idea 10)

**Problem.** `with-timeout` was vendored **3× inside one package in one night** —
a real defect, not just churn — because parallel cards each added a subtree to the
same package without a named home for shared helpers (F4).

**Spec.** Card-writing checklist addition:

> **Adding parallel subtrees to one package?** Name shared utilities and their
> canonical path up front in the card body:
> `Shared: with-timeout lives at packages/sdk/src/with-timeout.ts — import, do not
> vendor.` The first card to land owns the shared file; later parallel cards import
> it. Applies to any util plausibly needed by >1 sibling card.

Optional guardrail (overlaps the audit linters that "paid for themselves within
hours"): extend the duplication linter to flag two files with identical exported
function bodies across sibling subtrees.

---

## Appendix A — reproduce the numbers

```bash
# Metrics (per-stage wall time, ceremony tax §1b):
cd /Users/base/dev/appletolye/fabrikav2 && twf metrics report

# Ledger aggregates (§1a rework, §1c routing, §1e friction):
python3 - <<'PY'
import json, collections
recs=[json.loads(l) for l in open('/Users/base/.local/share/agency/ledger/board.jsonl') if l.strip()]
rich=[r for r in recs if r.get('outcome',{}).get('rework_rounds') is not None]
print("rework:", collections.Counter(r['outcome']['rework_rounds'] for r in rich))
print("friction:", collections.Counter(r['bias']['plan_friction'] for r in rich))
print("spawn models:", collections.Counter(r['worker']['model'] for r in recs if r['event']=='spawn'))
print("land models:", collections.Counter(r['worker']['model'] for r in rich))
PY
```

Ledger snapshot at analysis time: 319 records (279 spawn / 40 land), 29 outcome-bearing.
