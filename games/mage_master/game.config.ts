// The game's declarative contract with the DOM shell. Mage Master mounts the
// kit surfaces below; screens are the harness drive states.
import type { CopyKey } from "./design/copy.ts";

export const gameConfig = {
  id: "mage_master",
  title: "game.title" satisfies CopyKey,
  screens: ["menu", "level", "settings", "pause", "win", "fail"],
  saga: { levels: 10 },
  economy: { softCurrency: "gold" },
  adPlacements: [],
  productCatalog: [
    "com.basegamelab.magemaster.gems.small",
    "com.basegamelab.magemaster.gems.medium",
    "com.basegamelab.magemaster.gems.large",
  ],
  analyticsEvents: [
    "session_start",
    "level_start",
    "level_complete",
    "level_fail",
    "resource_change",
    "rift_pull",
    "rift_upgrade",
    "rift_skip",
    "item_use",
    "item_discard",
    "offline_claim",
    "battle_quit",
    "gems_purchased",
  ],
} as const;
