# tools/audit

The duplication and literal-value linters that enforce the anti-v1 guardrails. Fails a
game that reimplements something whose name/shape already exists in `packages/` (the
"extract after 2nd use" rule inverts to "shell code starts shared", because v1 proved
retro-extraction never gets adopted), and greps for literal hex/rgba/copy-string patterns
outside `design/` so `packages/ui` and game-shell code stay token-only. This replaces v1's
broken `grep-affected-games.sh` — this time with tests. Not an npm workspace (lives under
`tools/`). See the Guardrails section of `docs/architecture/v2-architecture.md`.

_Stub — no implementation yet. Built alongside the guardrail lint rules._
