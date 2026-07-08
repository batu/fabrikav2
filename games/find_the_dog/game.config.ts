// The game's declarative contract with the DOM shell. The shell consumes this;
// the game never reaches into shell internals. Shape matches the design-sheets
// fabrikav2 ingester contract (id/title/screens drive structural page cards).
// `create-game` substitutes id + the "game.title" copy value; everything else is
// edited per game.
import type { CopyKey } from "./design/copy.ts";

export const gameConfig = {
  id: "find_the_dog",
  // `title` is a copy KEY (typed CopyKey), never a literal user-facing string:
  // the actual title lives in design/copy.ts and a reskin edits it through the
  // design sheet. `satisfies CopyKey` fails typecheck if a literal is pasted here.
  title: "game.title" satisfies CopyKey,
  screens: ["HomeMenu", "SagaMap", "Shop", "Settings", "ResultCard", "PauseOverlay", "Toast", "ConnectivityIndicator"],
  saga: { levels: 54 },
  economy: { softCurrency: "coins" },
  adPlacements: ["rewarded_hint", "level_complete_claim_x2", "interstitial_level", "banner_gameplay"],
  productCatalog: [
    "no_ads",
    "no_ads_premium",
    "hints_10",
    "hints_25",
    "hints_50",
    "coins_1000",
    "coins_5000",
    "coins_10000",
    "coins_25000",
    "coins_50000",
    "coins_100000",
  ],
  // Canonical @fabrikav2/sdk analytics events (see packages/sdk analytics contract).
  analyticsEvents: [
    "session_start",
    "session_end",
    "level_start",
    "level_complete",
    "level_fail",
    "resource_change",
    "ad_request",
    "ad_impression",
    "ad_reward",
    "purchase",
  ],
} as const;
