# src/shell/

The DOM-shell glue: wires the game's `game.config.ts` to the shared screens in
`@fabrikav2/ui` and to the kernel flow machine. **Token-only zone** — the audit
`no-literals` linter forbids literal colors, user-facing copy, and asset paths in
`src/shell/**`. All values resolve through `--fab-*` CSS tokens (`design/tokens.css`)
and the generated `design/copy.ts` / `design/assets.ts` modules. The bundled
`App.ts` owns the v2 shell surfaces for Arrow.
