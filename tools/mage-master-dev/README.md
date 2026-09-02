# mage-master-dev — device loop scripts for games/mage_master

Shell and Python helpers used to build, install, drive, capture, and soak-test
Mage Master on Batu's iPhone (2026-09-02). Not a workspace; run them directly.
All device commands assume the phone UDID `00008101-000410EC3EF9001E`, team
`42L77JAX72`, and the pymobiledevice3 tunnel (`--rsd` values from
`curl http://127.0.0.1:49151/`).

- `mm-install.sh` — standalone bundle build → cap sync → native recipe → xcodebuild → install → launch.
- `mm-install-dev.sh` — same, but the bundle loads from the Mac's Vite server (`--host 0.0.0.0 --port 5199`) for live reload and the dev drive.
- `mm-drive.sh OP ARGS_JSON` — write a command for the dev drive (`src/dev/devDrive.ts`): `driveTo`, `verb`, `frames`, `snapshot`, `inspect`, `eval`, `reload`.
- `mm-shot.sh OUT.png` — screenshot the phone over the tunnel.
- `mm-soak.sh MINUTES OUTDIR` + `mm-soak-summary.py OUTDIR` — a real-time on-device play session driven like a player, with periodic screenshots and error checks, then a Markdown summary.
- `mm-matte.py`, `mm-garment.py`, `mm-preview.py` — codex art pipeline: flat #333333 matte → alpha; magenta garment split; composite preview. Run with the pixelsmith venv (`cd ../../../pixelsmith && uv run python ...`).

Evidence produced with these lives under `games/mage_master/evidence/`.
