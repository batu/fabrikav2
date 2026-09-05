# Level Editor

One hidden-object level editor serving per-game workspaces: the FastAPI
backend and React wizard forked from fabrika's v1 Find the Dog levelbuilder,
plus an agentic CLI with full wizard parity. The fabrika copy remains Find the
Dog's frozen authoring archive; this tool owns new-level authoring here,
starting with Find the Bird. Schema/geometry authority stays owned by
`tools/ftd-level-editor` (imported as a uv path dependency, never copied).

Authoring data lives in the selected game: sessions/state under
`games/<game>/.levelbuilder/` (gitignored), validated exports under
`games/<game>/public/levels/` (tracked).

## Quickstart

```sh
cd tools/level-editor

# Backend (5192). --game is a name under games/ or an absolute game path.
uv run level-editor serve --game find_the_bird
# equivalent: LEVEL_EDITOR_GAME=find_the_bird uv run python -m levelbuilder.api.server

# Wizard UI (5193). LEVEL_EDITOR_API points the proxy at a non-default backend.
cd ui && npx vite --port 5193
```

Environment notes:

- Setting only one of `LEVELBUILDER_WORKSPACE` / `LEVELBUILDER_GAME_ROOT` is a
  startup **error** (a half-set pair once split the workspace from the export
  root and exports landed in `tools/public/levels`). Prefer `--game`.
- `.env` files load from the ancestor chain, parent-first (deeper overrides),
  bounded at `$HOME` — provider keys live in the base dir's `.env`. Do not
  stop the walk at the first `.git`: in a worktree that is a *file* two levels
  below the shared env, and the keys silently vanish.
- Sprite repair defaults **on** (`FTD_SPRITE_REPAIR=0` disables). Off, weak-alpha
  birds silently ship without pickup sprites and export refuses later.
- `FTD_BUILDER_TOKEN` enables bearer-token auth for tunneled deployments; the
  CLI sends it via `--token` / `LEVEL_EDITOR_TOKEN`.

## CLI

`uv run level-editor [--url URL] [--token T] [--json] <verb>`. Every verb
supports `--json` (stable machine-readable output). Exit codes: `0` success,
`2` structured failure (`{"error": {code, stage, message}}` in json mode).
Long-running verbs take `--wait` (durable-job polling that survives transient
transport blips, fails fast on 4xx) and `--force-disk` to bypass the free-disk
floor (`LEVEL_EDITOR_DISK_FLOOR_GIB`, default 5).

| Verb | Does |
|---|---|
| `author --template T [--session-id S]` | resumable authoring flow; stops after painting for human hitbox blessing, then resumes through cutouts, recenter, and export |
| `serve --game G [--port]` | run the backend for one game |
| `doctor --game G` | server-free workspace census: orphans, stuck jobs, locks, disk |
| `status` / `config` | server + generation status / full recipe catalog |
| `sessions` / `session <id>` | gallery listing / one session |
| `create --template T \| --setting --scene --style --view --entity --model` | new session (`--count` overrides bird count) |
| `generate-bg <id> [--wait]` | background generation job |
| `select-bg <id> <index>` | choose a background |
| `upscale <id> [--wait]` | background upscale job |
| `auto-hitboxes <id> [--count N] [--strategy smart] [--radius R]` | place hiding spots; shrinks the radius until they fit |
| `set-hitboxes <id> --file F` | replace hitboxes from JSON |
| `bless-hitboxes <id>` | approve the current hitbox geometry; required before any cutout extraction |
| `fix-hitboxes <id> [--max-offset]` | recenter hitboxes onto painted sprites (server-side) |
| `repair-sprites <id> [--drop-unrepairable]` | regenerate birds missing a pickup sprite; explicit drop for hopeless placements |
| `auto-place-sprites <id>` | run best-safe placement over ready cutouts; preserves human-confirmed geometry by default |
| `visibility-check <id>` | contrast/visibility report |
| `inpaint <id> [--wait] [--hard-percent] [--retry-failed]` | paint all birds (durable job) |
| `regenerate <id> --dog <stable-id>` | repaint one bird (note: stable dog id, not `dog_NN`) |
| `cutouts <id> --dog <stable-id> [--dog ...] [--operation extract\|regenerate] [--crop-box ID=x0,y0,x1,y1] [--model M] [--wait]` | run the focused cutout flow for selected birds; both operations cut and Best-safe-place the resulting pickup sprite |
| `bless-cutouts <id>` | final-approve current cutouts and sprite placements after hitboxes are blessed |
| `dogs <id> [--set-active ID --variant N \| --delete ID]` | list/manage variants (`--set-active` requires `--variant`) |
| `review <id> --out DIR` | download bg/color/eval + per-dog variants for visual inspection |
| `watch <id>` | stream job status + session-revision changes (co-presence) |
| `approve <id>` | register the package in the production catalog |
| `export [<id>] [--skip-approve] [--force-reapprove] [--wait]` | approve → bundle → lineup draft → packaging job |
| `validate --game G` | server-free corpus check (same engine as the export gate) |
| `jobs [--session]` / `job <id> [--events]` | durable job inspection |
| `archive <id> [--restore]` | archive/unarchive a session |
| `templates` / `prompts [kind]` | recipe templates / prompt library |

## The authoring flow that works

Proven end-to-end (two shipped pilot levels, both 20/20 winnable in-game):

```sh
level-editor create --template ftb-cardboard-forest
level-editor generate-bg <id> --wait          # review the art before continuing
level-editor review <id> --out /tmp/look && open /tmp/look/bg_00.png
level-editor select-bg <id> 0
level-editor auto-hitboxes <id> --count 20 --strategy smart   # auto-fits radius
level-editor inpaint <id> --wait
level-editor repair-sprites <id>              # close pickup-sprite gaps
level-editor fix-hitboxes <id>                # recenter taps onto painted birds
level-editor export <id> --wait
level-editor validate --game find_the_bird
```

Radius: `auto-hitboxes` now starts at `--radius` (default 30) and shrinks by
`--shrink-step` down to `--min-radius` until the requested count fits,
reporting `radiusUsed`. Historical note: the original default (50) is sized
for the old broad FTD
framing. Close-camera scenes (`isometric_close_20`, 768px wide) fit 20 spots
at `--radius 24..26`; the smart strategy refuses rather than overcrowding.

Templates come from `/api/config`: seeds plus per-workspace overrides in
`<workspace>/templates.json` (merged by id; malformed file logs a warning and
seeds still serve).

## Deliberate boundaries

- **No remote publication.** The packaging job's final phase is Firebase
  Remote Config activation; this fork wires `DisabledRemoteConfigPublisher`,
  so that phase always refuses. This is by design — the game consumes the
  bundled + catalog manifests, which are complete without RC. Whether Find
  the Bird ever uses RC sequences is an open product decision; do not "fix"
  the refusal.
- The FTD corpus, its cutover, and `tools/ftd-level-editor` (beyond the
  `--root` parameterization of its corpus validator) are out of scope here.

## Verification

The dedicated CI job runs the Python backend suite and every `*-smoke.mjs`
browser fixture, then builds the UI. To run the same gate locally after
`npm ci` and `npx playwright install chromium`:

```sh
npm run editor2:ci -w @fabrikav2/level-editor-tool
# Optional: EDITOR2_VERIFY_DIR=/tmp/my-editor-check to retain a named result.
```

The gate uses Python 3.12 in its own temporary venv. It writes per-step logs,
`backend.xml`, generated `requirements.txt`, screenshots, build output, and
`results.json` under the reported directory. Every backend/browser failure or
unexpected network/provider attempt fails the gate. Backend tests use temporary
game/workspace/ledger roots and an empty model cache, disable dotenv and startup
model downloads, and block external network/CLI calls. Browser tests start their own loopback Vite
server with no backend proxy and explicitly mock API responses. No operator
service, real provider, physical device, or live publishing behavior is verified.

Normal development still uses the editable `../../../merceka-core` dependency.
CI exports all other versions directly from `uv.lock` and installs public core
commit `ccba881b3b1367fbb72ec1119a1bc553e09cc848` into the isolated venv. The
editor already depends on the 30-line cost-attribution addition in local core
commit `927f3f5402f10ee7227eabcb22a9965c74a0625c`; that commit is not published.
`scripts/prepare-dependency.py` reproduces only its `costs.py` delta, validates
the installed Git revision and exact before/after SHA-256 hashes, and refuses
to touch editable/external sources. Attribution nesting, per-record overrides,
exception cleanup, idempotence, and drift rejection have regression coverage.
Remove this correction when the attribution API is available at a public pin.
The golden dataset also reads rejected sprites from its immutable review-input
revision `8a80bcfe2789015a330fd9e168e021f1b1d612f7`; CI fetches that commit explicitly.

The existing operator/corpus commands remain separate:

```sh
npm run editor2:verify          # from tools/level-editor: pytest + tsc + UI build
npm run editor2:verify -w @fabrikav2/level-editor-tool   # from repo root

# Corpus gate (same engine as the export gate; now part of editor2:verify):
uv run level-editor validate --game find_the_bird
npm run editor2:corpus:all      # every game with a public/levels corpus

# Per-bird reachability through the game's own test harness (game dev server
# must be running). Blind coordinate taps are NOT a valid substitute — they
# read as misses and burn lives:
GAME_URL=http://localhost:5177 LEVEL_ID=<level-id> node scripts/tap-audit.mjs
```

A refused export is fail-closed and atomic: level dirs and both manifests
stay untouched (proven by live probe, not just asserted).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `/api/config` reports `game: tools`, sessions land in the tool dir | game profile never bound — pass `--game`, or set BOTH `LEVELBUILDER_*` vars; partial env now fails at startup |
| `missing pickup sprite cleanup metadata for N dog(s)` | `repair-sprites <id>` (regenerates them); add `--drop-unrepairable` for placements that never yield a cutout |
| `N painted dog(s) no longer map to any hitbox` (409) | a hitbox moved away from its painted bird; `fix-hitboxes <id>` then re-export. The export refuses rather than silently shipping fewer birds |
| `Only selected N non-overlapping smart hitboxes` | scene too dense for that radius — `auto-hitboxes` auto-shrinks now; lower `--min-radius` or `--count` if it still gives up |
| Lineup "Start" fails with `catalogLevelMissing` | the level is not in the catalog yet — click **Publish to catalog** on its Gallery card, or run `level-editor approve <session-id>` |
| tap-audit passes but you doubt it | confirm the reported `level` matches what you asked for; it fails hard on mismatch, and index-based selection is not supported for exactly this reason |
| gate refusal: `cleanup geometry does not contain its center` | hitbox drifted off the painted bird — `fix-hitboxes <id>`, re-export |
| 409 `painted dog(s) no longer map to any hitbox` | a hitbox moved away from painted art; without this guard the bird silently vanished from the package — `fix-hitboxes` or restore placements |
| CLI dies mid `--wait` with connection reset | transient server stall; jobs are durable — re-attach with `level-editor job <id>`, polling now retries blips automatically |
| `smart_hitboxes_failed: only selected N of M` | radius too large for the scene — retry with `--radius 24..26` or lower `--count` |
| port 5192/5193/5177 already bound | another editor/game instance; `lsof -ti :PORT` (note: vite may bind IPv6-only — probe `localhost`, not `127.0.0.1`) |

Operational history and evidence: `docs/evidence/2026-07-28-level-editor-shakedown/`.

## Known gaps

- **Approval replay protection is process-memory only** — it does not survive
  a server restart (inherited v1 semantics).
- **No eslint config** for the forked UI (upstream had none either), so the
  repo's `npx eslint .` convention does not cover `ui/`.
