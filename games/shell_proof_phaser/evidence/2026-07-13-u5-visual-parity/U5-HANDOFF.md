# U5 authoring handoff

## Accepted immutable publications

| Role | Publication ID | Manifest digest |
|---|---|---|
| P0 | `sha256-d7a7b49fd51d69c14a4fadea57d015389e4227e5a51fba16438ce067afc4ac64` | `sha256-d788b9ea29298c65289a0a715155085af9a0ff0482cee0ab9b2341bd4bbbc3cf` |
| A | `sha256-42b1755bbac7955087f7ba7fdb3f8ab6e41b90badd1010dcc0318b1e3684a826` | `sha256-f7ad9301f2d164101f8a9a72d7b2833eaf191c78673c44d3eacd981414185c68` |
| B | `sha256-132969b9fa15bbe89e91c9ee5900a2f3e953a76a1bb22e50f1d8972e196a7c56` | `sha256-348fa391948474ec8de40e9ff181d3bb186dafa222dcb9a4044d8cd15a24f3f9` |

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
