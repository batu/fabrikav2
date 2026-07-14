# U5 authoring handoff

## Accepted immutable publications

Republished chain after the VIP-Bundle overlap repair (card comment 48/49):
the `shop.fab.item-locked-icon` (`progression_node_locked`) companion that
overlapped the VIP Bundle trophy was removed from the Phaser Editor authority
(`visualSeed.ts` recipe + committed `Shop.scene`/`Shop.ts`), and a fresh
content-addressed P0/A/B chain was authored through the real unlocked Phaser
Editor 5.0.2 provenance flow (`reset` → `launch` → `publish`). The superseded
pre-repair chain (`d7a7b49f…` / `42b1755b…` / `132969b9…`) is preserved
byte-for-byte on disk but is no longer referenced by `accepted.json`.

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
- `git diff --check` passed.

## Honest remaining gates

- No durable real-Editor `CompileProject`-twice plus terminate/restart/reopen
  provenance record is present in this evidence directory. The deterministic
  tooling and accepted publications are ready, but that vendor-authenticated
  provenance gate must not be inferred from browser or device captures.
- `FENCE_GATE_LANE=phaser npm run project-gate` reaches the fence and fails on
  prerequisite/shared files inherited by this branch but absent from the
  current `experiment/dual-design-frontends` tip. The U5 dirty files themselves
  stay within the Phaser lane; the integration branch must first regain the U1
  prerequisite history before this card can land cleanly.
- Runtime projection selection, pointer updates, native build application, and
  device identity proof belong to U6.
