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

_Stub — no implementation yet. Extracted by a later card (ui shell-kit extraction)._
