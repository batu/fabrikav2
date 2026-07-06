# @fabrikav2/ui

The DOM shell kit — screens and primitives, token-themed only, with zero game
knowledge. Screens are themeable components with data contracts (`HomeMenu`+`SagaMap`,
`Shop`, `Settings`, `ResultCard`, `PauseOverlay`); primitives cover `Button`,
`ModalShell`, `ToastSystem`, `ToggleRow`, `EconomyTransfer` (coin-fly, extracted from
FTD's 300-line version), `ConnectivityIndicator`, `RestorePurchasesRow`, `OfferSurface`,
`TutorialOverlay`, and `SceneTransitionCover`. **Hard rule:** this package contains zero
literal colors, copy strings, or asset paths — everything resolves through `--fab-*` CSS
tokens and the generated copy/asset modules, enforced by lint (see Guardrails in
`docs/architecture/v2-architecture.md`). Source-shipped, DOM only.

## Wave B modules (implemented)

`animateEconomyTransfer`, `resolveDomAnchorToCanvasPoint`, `mountConnectivityIndicator`,
and the motion utils `prefersReducedMotion` / `retriggerCssAnimation` are live. All
inputs that would otherwise be literals are injected: `animateEconomyTransfer` takes the
token glyph URL (`tokenImage`) and the landing-target selector list (`targets`);
`mountConnectivityIndicator` takes the online/offline copy plus an `onToast` callback
(wire it to `mountToaster`) instead of hard-calling a toaster.

**Coin-fly anchor attributes** (both roles kept, namespaced under `fab-`):

- `data-fab-economy-target="<kind>"` — marks a container eligible as a landing target.
  Passed to `animateEconomyTransfer({ targets: [...] })` as a selector, e.g.
  `[data-fab-economy-target="hints"]`.
- `data-fab-economy-anchor="<kind>"` — marks the precise glyph **inside** a target to
  fly toward. `visibleTransferAnchor` prefers it, then falls back to a nested `img`, then
  the container center.

`<kind>` is `'coin' | 'hint'`; it also selects the `fab-economy-token--<kind>` CSS
modifier and the token-count heuristic — never asset resolution.

_Remaining screens (`HomeMenu`, `Shop`, …) are stubs, extracted by later cards._
