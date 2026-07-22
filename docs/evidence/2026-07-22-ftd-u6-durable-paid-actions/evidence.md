# Evidence: FTD U6 — Durable paid actions and provider boundary

- Date: 2026-07-22
- Card: cMHI3PVc ([FTD U6] Durable paid actions and provider boundary)
- Branch: trello-cMHI3PVc-ftd-u6-durable-paid-actions-and-provider @ a18d285f (baseline main bc04c2a4)
- Contract classification: **headless-logic** (backend durable jobs + provider trust boundary; only UI changes are two non-rendering durable-start adapters; no .tsx/.css/.html touched, Activity unmounted — aesthetics/in-situ stages self-skipped upstream)
- Status: **passed**

## Verdict

Fresh full-suite and focused-matrix runs in the card worktree confirm every paid kind is durable-job-owned behind the fail-closed provider trust boundary, with zero live provider calls, no request-owned provider path, no sprite mini-ledger, and no contract drift.

## Commands and results (all run fresh this session, in this worktree)

Working dir: `tools/ftd-level-editor`

| Check | Command | Result |
|---|---|---|
| Full backend suite | `uv run pytest -q` | **305 passed** (5.4s; 1 starlette deprecation warning only) |
| U6 focused matrices | `uv run pytest -q tests/contracts/test_paid_job_kinds.py tests/contracts/test_provider_boundary.py tests/contracts/test_observer_free_completion.py tests/contracts/test_paid_artifact_conflict.py` | **94 passed** |
| UI unit tests | `ui: npm run test:unit` | **52/52 pass, 0 fail** |
| Typecheck | `npm run typecheck` (tsc -p ui/tsconfig.json) | clean |
| Lint | `npx eslint ui/src` | clean, exit 0 |
| Contract drift | `uv run python scripts/generate_contracts.py` then `git status --porcelain` | regenerated openapi.json + generated.ts, **zero diff** |

Worktree is clean with the single feature commit a18d285f on top of main baseline bc04c2a4.

## What the focused matrices prove (acceptance mapping)

- `test_paid_job_kinds.py` — parameterized over all 10 registered paid kinds (incl. new ftd.magenta_inpaint, ftd.dog_regenerate): Request-ID identity reuse / single spend, Input-Hash conflict, queued cancel, pre-side-effect retry, ambiguous post-submit orphan + grant-gated force-new (unknown submission requires a grant), sprite resume-without-resubmit, restart-before-intent, and a source-inventory scan asserting **no request-owned provider call** (no providers.require/httpx outside generation+app) and **no sprite JSON mini-ledger markers** anywhere in backend/ui.
- `test_provider_boundary.py` — HTTPS-only fixed host allowlists; redirect/private/link-local/userinfo/port rejection; deadline, 64MiB streamed byte cap, MIME-vs-decoded-media + dimension validation; output quarantine; secret isolation — all fail closed with scripted providers (FailClosedProviders otherwise).
- `test_observer_free_completion.py` — every paid kind completes with no observer attached.
- `test_paid_artifact_conflict.py` — late/stale results recoverable; ApplicationConflict retains paid output on stale session revision.

No live credential or provider call was made at any point (all transports scripted).

## Gaps / deferred (owned by U7 per conductor comment 1)

- Activity remains unmounted: real-browser focus/aria-live journey deferred to U7.
- Retained-artifact apply endpoint lands with its owning feature.
- Cutout ships passthrough (`ftd-cutout-passthrough-r1`) and band canvas/mask pixel assembly deferred — imaging deps (PIL/numpy/opencv) outside the migrated dependency set.

These are explicit scope deferrals, not verification gaps in U6's fenced scope; status is therefore **passed**.
