---
title: "Real-game editor U0 verified baseline"
date: 2026-07-15
goal: ../../goal.md
plan: ../plans/2026-07-15-001-chore-real-game-u0-baseline-plan.md
trello: https://trello.com/c/81E78eqU
scope: preflight-only
---

# Real-game editor U0 verified baseline

This report freezes the starting point for the real-game UI round-trip goal. U0 now proves both native editor-persistence lanes and a fresh exact-SHA Android build/install/capture lane. It does **not** prove a Marble Run editor mapping or round trip, publish an editor, prove mobile fidelity, or change any external service. Current observations below were rechecked on 2026-07-15 (Europe/Istanbul); historical editor claims are explicitly marked as prior work.

## Source baseline

| Ref | Frozen SHA | Meaning |
| --- | --- | --- |
| `origin/main` | `b53b9b04e7dbfdda9404f55cb12047e02af5af80` | Current remote integration baseline at U0 inspection time. |
| `origin/goal/real-game-ui-roundtrip` | `58f94d2f68d1a5bca7c886b7e047069822734097` | Governing goal document. |

The card worktree contains a merge commit used only to reconcile the goal branch with the worktree. It is not a replacement baseline and is not evidence that any editor implementation landed on `origin/main`.

## U0 proof result

| Lane | Result | What is proven | What is not proven |
| --- | --- | --- | --- |
| Native GrapesJS persistence | **PASS** | Raw `editor.getProjectData()` remained the sole saved authority; stable component and semantic IDs, text, style, and project hash survived a complete browser/server stop and restart. | Mouse-drag usability, Marble mapping, Preview publication, reset, or device propagation. |
| Licensed Phaser Editor persistence | **PASS** | Phaser Editor 5.0.2 saved a native `.scene`; stable object identity, position, copy, native-scene hash, and deterministic generated graph survived complete editor-server termination and reopen. | Manual-drag usability, Marble mapping, Preview publication, reset, or device propagation. |
| Exact-SHA Android preflight | **PASS** | A fresh sparse clone at exact commit `b53b9b04e7dbfdda9404f55cb12047e02af5af80` built, installed, cold-launched, dwelled 12 seconds, and produced a live Pixel 6a menu capture tied to the installed APK hash. | Either editor's output on device, cross-editor parity, or a fidelity verdict. |

Committed evidence is under [`docs/evidence/2026-07-15-realgame-editor-preflight`](../evidence/2026-07-15-realgame-editor-preflight/). The root [`SHA256SUMS`](../evidence/2026-07-15-realgame-editor-preflight/SHA256SUMS) binds every curated artifact. The evidence intentionally omits the 7.6 MB debug APK; its exact SHA-256, source SHA, build commands, package metadata, and install proof remain recorded in the Android report and logs.

The editor proof used disposable projects only. GrapesJS was changed through its native component API and Phaser through the live licensed Scene Editor model/save method. Neither authority file was edited outside its editor. This establishes native persistence without falsely claiming manual designer ergonomics.

## Editor baseline and authority decision

**No Marble Run mapping exists in GrapesJS or Phaser Editor at this baseline.** A case-insensitive search of the prior native Phaser authoring tree returns no Marble match. The old projects are generic shell experiments, not a faithful real-game specialization.

### Phaser Editor

- `/Applications/Phaser Editor 5.app` is installed at version **5.0.2**.
- Prior generic-shell work contains seven native `.scene` documents under `games/shell_proof_phaser/authoring/phaser-editor` and previously demonstrated real-editor save/reopen/regeneration behavior.
- That historical proof is useful feasibility evidence only. Marble Run persistence, exact-asset mapping, Preview freshness, and device propagation are all **unproven**.
- Reusable, selective prior plumbing:
  - `64dbba32`: native scene/catalog and validation core.
  - `7687e18c`: deterministic publication, reset, and authoring verification.
  - `706d781b`: real-editor session and provenance evidence.
  - `0b979ff4`: editor-authored immutable publications and review surfaces.
  - the later `993f8be8..86329ae0` range: selected-revision runtime/device verification ideas.
- Do not merge those branches wholesale. In particular, `86329ae0` is not an ancestor of `origin/main`; any useful code must be re-evaluated and ported surgically on a Marble card.
- The custom web review/runtime is Preview infrastructure, not the Phaser editing frontend. The installed licensed Phaser Editor must own authoring.

### GrapesJS

- The prior `tools/grapes-shell` experiment embeds GrapesJS, but its canonical presentation is a closed `ShellPresentationDocumentV2`; pages/components are rebuilt from it and divergence is rejected.
- That authority direction is invalid for this goal because it creates another editable source between GrapesJS and the game. Native GrapesJS project state must be the presentation authority.
- Reuse only publication mechanics that remain authority-neutral: immutable revision IDs, hashes, status/apply/drift checks, portable Preview output, and accepted-revision records from the `52f04fe8..58b61265` lineage.
- Do not reuse the closed AST as authority. Its browser-test `localStorage.clear()` setup is also not a sufficient project reset/reopen proof.

## Physical devices

### Android primary lane

- SSH host: `ubuntu-server`.
- ADB must be invoked by absolute path: `/home/batu/android-sdk/platform-tools/adb`.
- Device `27091JEGR22183` is currently in state `device`; it reports **Pixel 6a**, Android **16**.
- The remote checkout at `/home/batu/Desktop/utolye/fabrikav2` is **not provenance-safe**: its `.git` file points to a Mac-local worktree path for old card `s1P6oJI2`. Existing remote files or the already installed Marble build therefore cannot attest a source SHA.
- U0 closed the clean-source preflight: a new disposable partial clone checked out exact commit `b53b9b04e7dbfdda9404f55cb12047e02af5af80`, built Marble Run, installed `com.appletolye.marblerun.dev`, cleared prior app data, cold-launched it, waited 12 seconds, and captured the rendered menu from the expected foreground activity.
- The installed APK SHA-256 was `692b21d528e33a45fc3a3d08bd5bc5928eb28026f5528f8b9c9211854e696e30`; the 1080 x 2400 RGBA capture SHA-256 was `df4bb57bfdb651cb2bab725741ba71799a676a9d84c4593bcbe982a6f092754e`.
- The build exposed a real seam: Marble Run does not itself declare `@capacitor/android`, so the exact tracked `games/arrow` workspace was included to make the lockfile-pinned package available without changing source or lockfile. Logcat also records the current AdMob native-only web-stub fallback. Neither issue invalidates the U0 build/install/capture proof, but neither is a production SDK proof.
- Later editor/device gates must repeat this provenance discipline and additionally bind the installed build to the selected editor revision.

### iPhone opportunistic lane

- `devicectl` currently reports **Batu's iPhone**, iPhone 12, available and paired.
- CoreDevice identifier: `2D894791-A5A3-58BE-9C88-AE0AF08B8C09`; hardware UDID used by existing tooling: `00008101-000410EC3EF9001E`.
- Developer Mode is enabled, pairing is active, and the tunnel is connected; iOS reports **18.7.8**.
- Earlier `xctrace` offline output is stale. Current `devicectl`/CoreDevice state is authoritative for this preflight.
- Marble Run is not currently installed, so this is connectivity readiness—not app or round-trip proof.

## Portal transport baseline

- `https://portal.basegamelab.com` is publicly reachable (HTTP 200), contrary to the repository's stale Tailscale-only wording.
- The current implementation accepts query-string bearer tokens, and a token-shaped query value is present in `~/.gallery/logs/stdout.log`. Never paste or reproduce that value in evidence.
- Authentication cookies are created without the `Secure` attribute in `gallery/server.py`.
- A Portal backend is running as a child process of the active agent session; the installed launchd plist is not loaded. It is therefore not a durable unattended service yet.
- No dedicated live editor route exists. The existing dual-editor Portal stream is a static report, not an editor endpoint.
- Until the Portal security/durability card resolves these facts, do not publish token-bearing editor URLs or claim the public endpoint is a safe unattended editor surface. U0 does not deploy or restart Portal.

## PixelSmith boundary

PixelSmith currently provides real-iPhone capture, model-assisted `judge`, crop-aware critique, and side-by-side `compose`. It does **not** provide Android capture, asset inventory, asset SHA verification, or a deterministic pixel-diff gate. Those deterministic checks must be separate scripts/commands, and Android capture must use the Android device lane.

The repository also exposes a `generate` command, but generation violates this goal's exact-existing-assets rule. **NEVER run `pixelsmith generate` for this work.** PixelSmith may compare and report; it may not create or alter art.

## Capacity and agent ledgers

`twf capacity status` reports both provider leases as elapsed/stale: Codex reset time 2026-07-14 11:34 +03:00 and Claude reset time 2026-07-14 18:00 +03:00. The current Codex session itself proves those lease rows are not reliable live-quota truth. This was reported to Batu; U0 does not force-clear either lease.

Per-agent evaluation records are machine-local and intentionally untracked:

- `~/.local/share/agency/ledger/conversation.jsonl`: read-only audit spawn/delegation records for `marble_inventory_research`, `editor_artifact_audit`, and `portal_device_audit`.
- `~/.local/share/agency/ledger/board.jsonl`: board worker/delegation records for card `81E78eqU`.
- `/Users/base/dev/appletolye/fabrikav2/.twf/metrics/events.jsonl`: repo-local mechanical card comments/transitions, including the corrected live-device facts.

These ledgers record who investigated what; they are not a substitute for committed evidence or live verification.

## Reproducible read-only checks

Run from a Fabrikav2 checkout unless a command uses an absolute path. None of these commands changes an editor, device, service, branch, or lease. Remote fetch is intentionally excluded because it mutates local remote-tracking refs.

```sh
git rev-parse origin/main
git rev-parse origin/goal/real-game-ui-roundtrip
defaults read '/Applications/Phaser Editor 5.app/Contents/Info' CFBundleShortVersionString

git grep -n -i marble \
  trello-gJtZP63y-dual-u5-seven-page-phaser-editor-authori -- \
  games/shell_proof_phaser/authoring/phaser-editor tools/phaser-shell
git grep -n ShellPresentationDocumentV2 \
  trello-orfV5tNV-dual-u4-grapes-immutable-dom-application -- tools games
git merge-base --is-ancestor 86329ae0 origin/main

ssh -o BatchMode=yes ubuntu-server \
  '/home/batu/android-sdk/platform-tools/adb -s 27091JEGR22183 get-state'
ssh -o BatchMode=yes ubuntu-server \
  "sed -n '1p' /home/batu/Desktop/utolye/fabrikav2/.git"
xcrun devicectl list devices
xcrun devicectl device info details \
  --device 2D894791-A5A3-58BE-9C88-AE0AF08B8C09

curl -L -sS -o /dev/null -w '%{http_code}\n' \
  --max-time 10 https://portal.basegamelab.com
rg -n 'set_cookie' /Users/base/dev/appletolye/portal/gallery/server.py
launchctl print "gui/$(id -u)/com.appletolye.gallery"

sed -n '1,180p' /Users/base/dev/appletolye/pixelsmith/README.md
twf capacity status

test -f docs/evidence/2026-07-15-realgame-editor-preflight/SHA256SUMS
(cd docs/evidence/2026-07-15-realgame-editor-preflight && shasum -a 256 -c SHA256SUMS)
file docs/evidence/2026-07-15-realgame-editor-preflight/android/menu.png
rg -n '"pass": true|"result": "ok"|"stableAcrossRestart": true' \
  docs/evidence/2026-07-15-realgame-editor-preflight/editor-persistence
```

Expected non-zero results are meaningful: the Marble search should find nothing, the ancestry check should exit 1, and `launchctl print` should fail while the service is not loaded. Do not turn those failures into success claims.

## Exit state and next gate

U0 is satisfied when this report and its curated evidence are committed and reviewed: both native persistence lanes pass, and the exact-`b53b9b04` Android build/install/capture preflight passes. This remains a preflight, not a Marble mapping claim.

The next unit must build the exact Marble state/asset inventory and complete the fresh physical-Android primary-state reference baseline. Neither editor implementation may claim readiness until its own native edit, save/reopen, reset, accepted-revision Preview, clean-SHA device build, and complete primary-state capture gates pass.
