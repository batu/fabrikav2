# .work/ — HUMAN SEAM (gitignored agent scratch)

Agent scratch space. **Gitignored** (only this README is committed) — nothing
here is a source of truth, and it must never be checked in (v1's `.work/` grew to
4.5GB of unstructured junk; see `docs/research/09-game-folder-chaos-analysis.md`).
Use one dated, slug-named subdirectory per task: `<date>-<slug>/` (e.g.
`2026-07-06-icon-explore/`).

**Promotion rule:** when scratch output is worth keeping, MOVE it to its real
home — screenshots/reels to `evidence/`, shippable art to `design/assets/`,
human reference to `refs/` — and let everything else be deleted. If it stays in
`.work/`, it is disposable by definition.

## collectRun evidence

`tests/e2e/collect-run.spec.ts` writes its run bundle here by DEFAULT
(`.work/<date>-harness-first-run/`), so a plain `playwright test` / CI run is
side-effect-free. To (re)generate the committed evidence artifact
(`evidence/<date>-harness-first-run/`), run the promotion opt-in:

    PROMOTE_EVIDENCE=1 npx playwright test --config games/marble_run/playwright.config.ts collect-run.spec.ts
