export const REQUIRED_PAGES = [
  "menu",
  "gameplay-hud",
  "pause",
  "settings-menu",
  "settings-level",
  "win",
  "fail",
  "finale",
  "shop",
] as const;

export interface AssetEntry {
  readonly role: string;
  readonly file: string;
  readonly sha256: string;
  readonly width?: number;
  readonly height?: number;
  readonly alpha?: boolean;
  readonly status: string;
  readonly description: string;
  readonly tray: boolean;
}

export interface AssetManifest {
  readonly schema: "fabrikav2-grapes-assets/v1";
  readonly game: "marble_run";
  readonly assets: readonly AssetEntry[];
  readonly fonts: readonly AssetEntry[];
}
