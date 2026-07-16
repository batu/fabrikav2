# Wool Crush Pixelsmith runbook

All Pixelsmith commands run from `/Users/base/dev/appletolye/pixelsmith`.
Game paths therefore use the absolute Codex worktree path. The Portal stream is
`wool-crush-codex` (not the generic `<game>-assets` example).

No paid generation or candidate installation was performed while preparing
this runbook.

## Ingest and pin

```bash
cd /Users/base/dev/appletolye/pixelsmith
uv run pixelsmith ingest \
  /Users/base/dev/appletolye/.codex-worktrees/wool-crush-codex/games/wool_crush/refs/art/*.png \
  --game-root /Users/base/dev/appletolye/.codex-worktrees/wool-crush-codex/games/wool_crush_x \
  --out /Users/base/dev/appletolye/.codex-worktrees/wool-crush-codex/games/wool_crush_x/design/style-guide.json
```

`ingest` refuses to overwrite a pinned guide. Use `--force` only when the
existing pinned guide has been backed up and replacement is intentional. After
hand correction, set `"pinned": true` and post the guide plus refs:

```bash
portal post \
  --stream wool-crush-codex \
  --kind approve \
  --title "Wool Crush pinned style guide" \
  --step "asset style ingest" \
  --purpose "Review the reference-derived wool palette and rendering rules" \
  --ask "Approve or leave corrections; overnight silence is approval" \
  /Users/base/dev/appletolye/.codex-worktrees/wool-crush-codex/games/wool_crush_x/design/style-guide.json \
  /Users/base/dev/appletolye/.codex-worktrees/wool-crush-codex/games/wool_crush/refs/art/*.png
```

## Generate candidates

For a non-sheet spec, `--out` is a PNG filename. For a sheet spec it must be a
directory; named cells are emitted inside it. Pixelsmith expands every model ×
variant in the spec and suffixes candidate paths. Always source the key and use
the ledger's current remaining budget:

```bash
cd /Users/base/dev/appletolye/pixelsmith
set -a && source /Users/base/dev/appletolye/.env && set +a
GAME=/Users/base/dev/appletolye/.codex-worktrees/wool-crush-codex/games/wool_crush_x
uv run pixelsmith generate \
  --spec "$GAME/design/asset-specs/coin.json" \
  --out design/candidates/coin.png \
  --game-root "$GAME" \
  --max-cost 15.00 | tee "$GAME/design/candidates/coin.generate.json"
```

Sheet example:

```bash
uv run pixelsmith generate \
  --spec "$GAME/design/asset-specs/saga-nodes.json" \
  --out design/candidates/saga-nodes \
  --game-root "$GAME" \
  --max-cost <remaining-usd> | tee "$GAME/design/candidates/saga-nodes.generate.json"
```

Do not point `anchors` at the old Wool Crush assets. After a winning identity
asset is generated and installed, a later tier spec may anchor to that new
winner in a follow-up edit.

## Pick pages

Create a captions manifest mapping each candidate filename to
`{"caption":"…","meta":{"model":"…","variant":"…","cost_usd":0.00}}`,
then post all candidates and the current shell asset as `--before`:

```bash
portal post \
  --stream wool-crush-codex \
  --kind pick-one \
  --title "Wool Crush yarn-ball currency candidates" \
  --step "asset pick: coin" \
  --purpose "Choose the economy identity anchor" \
  --ask "Pick the strongest phone-readable yarn ball; overnight silence is approval" \
  --before "$GAME/public/ui/menu-icons/icon_coin.png" \
  --manifest "$GAME/design/candidates/coin.manifest.json" \
  "$GAME"/design/candidates/coin*.png
```

## Reports

There is no `pixelsmith report` subcommand in the current checkout. Human-facing
HTML reports use Portal:

```bash
portal report \
  --stream wool-crush-codex \
  --title "Wool Crush asset generation ledger" \
  --step "asset pipeline" \
  --purpose "Show candidate decisions, cost and remaining work" \
  "$GAME/design/reports/assets.html" \
  "$GAME/design/COST-LEDGER.md"
```

Machine-readable provenance is emitted to stdout by `pixelsmith generate` and
appended to `$GAME/design/asset-identity.json`. Use those two sources to update
the ledger; do not scrape Portal captions as the cost authority.
