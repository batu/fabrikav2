# U5 authoring handoff

## Accepted immutable publications

Republished chain after the VIP-Bundle overlap repair (card comment 48/49):
the `shop.fab.item-locked-icon` (`progression_node_locked`) companion that
overlapped the VIP Bundle trophy was removed from the Phaser Editor authority
(`visualSeed.ts` recipe + committed `Shop.scene`/`Shop.ts`), and a fresh
content-addressed P0/A/B chain was produced by the deterministic authoring
publisher (`reset` scratch → `publish`) over the committed editor-source
authority. The superseded pre-repair chain (`d7a7b49f…` / `42b1755b…` /
`132969b9…`) is preserved byte-for-byte on disk but is no longer referenced by
`accepted.json`.

| Role | Publication ID | Manifest digest |
|---|---|---|
| P0 | `sha256-c27be2bfce72bf8950347f28ddba6867ed36c65ebb54849b1f376ff5dc14b8b7` | `sha256-6edee67520410af86a1d6b6c63b50f5ee323aca0330a15dd9493332331b29361` |
| A | `sha256-3b4d7cdb957751919a8c8fe1fbaa795ea8d5f64c6e51c8f3300c691cb258b1e8` | `sha256-969edc50c218a1cd9c280867e3506fd77f72f5ed6c1912cef76183f3f3988e39` |
| B | `sha256-35690099c42593fc9811c2def04218957aa918111d110a174a2bfb9485e7bbb9` | `sha256-d224948748ea0837eba7effbfed2c1dfe0fe980622cffb8ce8a005b92c326458` |

`authoring/publications/accepted.json` is the machine-readable authority. Each
publication passes the CLI `status` and offline `proof` commands, renders all
seven states in the browser suite, and has publication-keyed captures under
`authoring/refs/authoring/<publicationId>/`.

## Verification completed

- `npm run verify-authoring -w @fabrikav2/phaser-shell`
  - 198 tooling tests passed.
  - Six browser proofs passed: P0/A/B across seven states plus the interaction journey.
  - Tooling typecheck, lint, validation, and build passed.
  - Runtime proof-game typecheck, 95 tests, and production build passed.
- `npm run audit` passed with existing repository warnings.
- `npm run freeze-gate` passed.
- `git diff --check` passed.

## Real-Editor provenance (recovered and committed)

The accepted P0/A/B chain was authored and published through the real,
licensed, **desktop + unlocked** Phaser Editor 5.0.2 session on 2026-07-14 (the
`f0879738` authoring pass, card comment 52). Durable, scrubbed provenance
recovered from that session's actual `tool_result` records (card comments 55/56)
is now committed under `authoring/publications/`:

- `recovered-provenance.json` — the index. Records the accepted P0/A/B
  publicationIds (validated **byte-identical** to `accepted.json`; 3 distinct
  IDs, `A != B`, zero validation issues), the recovered `launch`/`publish`
  result flags per role, and the matched-edit descriptors (A = `menu.title` →
  "Morning Shell"; B = `menu.settings` texture → `icon_control_confirm`).
- `provenance-b.full.json` — the complete `u5.phaser.provenance/1` record for the
  **B** run, committed byte-for-byte, independently verifiable
  (`shasum -a 256` → `e47181ddfee2c7d7883ef3625fd58f9637b4ddf6c44f29fdb8e6c871fe889676`).
  It proves `CompileProject`-twice determinism (generation 1 == generation 2),
  scene authority + generated graph byte-stable across a full
  terminate / restart / reopen, and the loopback endpoint proven down between runs.

**Evidence classes differ — stated honestly:**

- **B is full hash-rich** (the complete `u5.phaser.provenance/1` file survives).
- **P0 and A are reduced tool-output**: only their `launch`/`publish` result
  flags survived in the recovered records (`result: ok`, `deterministic`,
  `endpointDown`, `authStable`, `genStable` all true, plus the matching
  `publicationId`). Their per-run full provenance files were written to a
  disposable scratch **outside** the repo and are no longer available, so their
  per-path hash detail cannot be re-committed. All three launch results were
  `ok` with `deterministic`/`endpointDown`/`authStable`/`genStable` true, and the
  recovered handoff validation reported 3 distinct IDs and zero issues.

These records were captured during the authoring session, not this handoff
worker's session. The raw session transcript (JSONL) is deliberately **not**
committed — only scrubbed, hash-only facts are recorded, with no credentials,
account owner, or absolute/home paths.

## Honest remaining gates

- **Proof-game generated-code lint is a conductor-owned seam, not a lane fix.**
  `games/shell_proof_phaser/eslint.config.js` is outside the Phaser lane's
  writable fence (a U1-owned game identity file), so the earlier lane-added
  ignore for Editor-generated `.ts` and immutable publication snapshots was
  removed and the file restored byte-for-byte to the integration baseline. As a
  result, root `npm run lint` (which is NOT part of the card's Verification
  command `verify-authoring && audit && project-gate`, nor of `verify-authoring`
  itself) reports `@typescript-eslint/no-explicit-any` on the Editor-emitted
  `authoring/phaser-editor/src/**/*.ts` and the immutable `authoring/publications/**`
  snapshots. Those files are validated by the phaser AST/manifest/provenance
  gates and are never hand-edited, so the ignore must be added by the conductor
  at integration on the U1-owned `eslint.config.js` (the same seam used for the
  prior `Semantic.ts` / `docs/plans` preseeds), not by a lane worker.
- **Fence-gate reports inherited-prerequisite copy artifacts.**
  `FENCE_GATE_LANE=phaser npm run fence-gate` measures from the current
  `experiment/dual-design-frontends` tip (`9781e179`), which does not yet carry
  the U1 seal + S1–S6 prerequisite history this branch already inherited.
  `git diff --raw -M -C --find-copies-harder` therefore attributes the lane's
  `authoring/publications/**` assets (>50% similar to unchanged `games/_template/**`
  and `experiments/design-frontends/**` sources) as copies from those out-of-fence
  sources. These are attribution false-positives, not out-of-fence writes; every
  real lane write stays within `tools/phaser-shell/**`,
  `games/shell_proof_phaser/authoring/**`, and `games/shell_proof_phaser/evidence/**`.
  The integration branch must first regain the U1 prerequisite history before the
  fence reads clean; this is a conductor landing step.
- Runtime projection selection, pointer updates, native build application, and
  device identity proof belong to U6.
