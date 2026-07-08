export const CAMELEON_DIRECTIONS = ["poster", "riso", "night"] as const;
export type CameleonDirection = (typeof CAMELEON_DIRECTIONS)[number];

export const CAMELEON_BODY_MODES = ["painted", "white", "off"] as const;
export type CameleonBodyMode = (typeof CAMELEON_BODY_MODES)[number];

export const CAMELEON_PLAY_MODES = ["tap", "shoot", "confirm"] as const;
export type CameleonPlayMode = (typeof CAMELEON_PLAY_MODES)[number];

export interface WorldRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface CameleonWorld {
  readonly width: number;
  readonly height: number;
  readonly zoneWidth: number;
}

export type CameleonZone = 1 | 2 | 3 | 4 | 5;

export interface HideSpritePairKeys {
  readonly white: string;
  readonly painted: Readonly<Record<CameleonDirection, string>>;
}

/**
 * CAM-1 level.json schema, consumed by CAM-2 art importers and CAM-3 runtime
 * polish. Rects are world-space hit rectangles in the production panorama.
 * `spritePair.white` and each `spritePair.painted[dir]` must be silhouette
 * siblings: the art can recolor/fill differently per direction, but the alpha
 * mask is shared. Runtime hide objects are keyed by `id`; do not infer identity
 * from asset keys or array order.
 */
export interface CameleonHideDefinition {
  readonly id: string;
  readonly zone: CameleonZone;
  readonly pose: string;
  readonly disguise: string;
  readonly rect: WorldRect;
  readonly tell: string;
  readonly difficulty: string;
  readonly spritePair: HideSpritePairKeys;
}

export interface CameleonDecoyDefinition {
  readonly id: string;
  readonly zone: CameleonZone;
  readonly kind: string;
  readonly spriteKey: string;
  readonly rect: WorldRect;
}

export interface CameleonVisualOverlayDefinition {
  readonly id: string;
  readonly kind: string;
  readonly spriteKey: string;
  readonly rect: WorldRect;
}

export interface CameleonLevelAssetKeys {
  readonly zonePanels: Readonly<Record<CameleonDirection, readonly string[]>>;
}

export interface CameleonLevelDefinition {
  readonly id: string;
  readonly name: string;
  readonly world: CameleonWorld;
  readonly winAt: number;
  readonly assetKeys: CameleonLevelAssetKeys;
  readonly hides: readonly CameleonHideDefinition[];
  readonly decoys: readonly CameleonDecoyDefinition[];
  readonly visualOverlays: readonly CameleonVisualOverlayDefinition[];
}

const MIN_HIDE_EDGE = 72;
const LIDO_PANEL_COUNT = 3;
const LOGICAL_ZONE_COUNT = 5;

export function parseLevelDefinition(raw: unknown): CameleonLevelDefinition {
  const root = asRecord(raw, "level");
  const id = stringField(root, "id", "level.id");
  const name = stringField(root, "name", "level.name");
  const world = parseWorld(required(root, "world", "level.world"));
  const winAt = positiveInteger(root, "winAt", "level.winAt");
  const assetKeys = parseAssetKeys(required(root, "assetKeys", "level.assetKeys"));
  const hides = arrayField(root, "hides", "level.hides").map((value, index) =>
    parseHide(value, `level.hides[${index}]`, world),
  );
  const decoys = arrayField(root, "decoys", "level.decoys").map((value, index) =>
    parseDecoy(value, `level.decoys[${index}]`, world),
  );
  const visualOverlays = arrayField(root, "visualOverlays", "level.visualOverlays").map((value, index) =>
    parseVisualOverlay(value, `level.visualOverlays[${index}]`, world),
  );

  if (hides.length === 0) throw new Error("level.hides must contain at least one hide.");
  if (winAt > hides.length) throw new Error("level.winAt cannot exceed hide count.");
  assertUnique(hides.map((hide) => hide.id), "hide id");
  assertUnique(decoys.map((decoy) => decoy.id), "decoy id");
  assertUnique(visualOverlays.map((overlay) => overlay.id), "visual overlay id");

  return { id, name, world, winAt, assetKeys, hides, decoys, visualOverlays };
}

export function zoneForWorldX(world: CameleonWorld, x: number): CameleonZone {
  const zoneWidth = world.width / LOGICAL_ZONE_COUNT;
  const clampedX = clamp(x, 0, Math.max(0, world.width - 1));
  return clampZone(Math.floor(clampedX / zoneWidth) + 1);
}

export function worldXForZone(world: CameleonWorld, zone: CameleonZone): number {
  return ((zone - 1) * world.width) / LOGICAL_ZONE_COUNT;
}

export function rectCenter(rect: WorldRect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

export function containsPoint(rect: WorldRect, point: { readonly x: number; readonly y: number }): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  );
}

export function clampScrollX(level: CameleonLevelDefinition, x: number, viewportWidth: number): number {
  return clamp(x, 0, Math.max(0, level.world.width - viewportWidth));
}

function parseWorld(value: unknown): CameleonWorld {
  const world = asRecord(value, "level.world");
  const width = positiveInteger(world, "width", "level.world.width");
  const height = positiveInteger(world, "height", "level.world.height");
  const zoneWidth = positiveInteger(world, "zoneWidth", "level.world.zoneWidth");
  if (width !== zoneWidth * LIDO_PANEL_COUNT) {
    throw new Error(`level.world.width must equal zoneWidth * ${LIDO_PANEL_COUNT}.`);
  }
  return { width, height, zoneWidth };
}

function parseAssetKeys(value: unknown): CameleonLevelAssetKeys {
  const assetKeys = asRecord(value, "level.assetKeys");
  const zonePanels = parseDirectionStringArrays(required(assetKeys, "zonePanels", "level.assetKeys.zonePanels"));
  for (const direction of CAMELEON_DIRECTIONS) {
    if (zonePanels[direction].length !== LIDO_PANEL_COUNT) {
      throw new Error(`level.assetKeys.zonePanels.${direction} must contain ${LIDO_PANEL_COUNT} keys.`);
    }
  }
  return { zonePanels };
}

function parseHide(value: unknown, path: string, world: CameleonWorld): CameleonHideDefinition {
  const hide = asRecord(value, path);
  const rect = parseRect(required(hide, "rect", `${path}.rect`), `${path}.rect`, world);
  if (Math.min(rect.w, rect.h) < MIN_HIDE_EDGE) {
    throw new Error(`${path}.rect violates the ${MIN_HIDE_EDGE}px minimum hide edge.`);
  }
  return {
    id: stringField(hide, "id", `${path}.id`),
    zone: zoneField(hide, "zone", `${path}.zone`),
    pose: stringField(hide, "pose", `${path}.pose`),
    disguise: stringField(hide, "disguise", `${path}.disguise`),
    rect,
    tell: stringField(hide, "tell", `${path}.tell`),
    difficulty: stringField(hide, "difficulty", `${path}.difficulty`),
    spritePair: parseSpritePair(required(hide, "spritePair", `${path}.spritePair`), `${path}.spritePair`),
  };
}

function parseDecoy(value: unknown, path: string, world: CameleonWorld): CameleonDecoyDefinition {
  const decoy = asRecord(value, path);
  return {
    id: stringField(decoy, "id", `${path}.id`),
    zone: zoneField(decoy, "zone", `${path}.zone`),
    kind: stringField(decoy, "kind", `${path}.kind`),
    spriteKey: stringField(decoy, "spriteKey", `${path}.spriteKey`),
    rect: parseRect(required(decoy, "rect", `${path}.rect`), `${path}.rect`, world),
  };
}

function parseVisualOverlay(value: unknown, path: string, world: CameleonWorld): CameleonVisualOverlayDefinition {
  const overlay = asRecord(value, path);
  return {
    id: stringField(overlay, "id", `${path}.id`),
    kind: stringField(overlay, "kind", `${path}.kind`),
    spriteKey: stringField(overlay, "spriteKey", `${path}.spriteKey`),
    rect: parseRect(required(overlay, "rect", `${path}.rect`), `${path}.rect`, world),
  };
}

function parseSpritePair(value: unknown, path: string): HideSpritePairKeys {
  const pair = asRecord(value, path);
  return {
    white: stringField(pair, "white", `${path}.white`),
    painted: parseDirectionStrings(required(pair, "painted", `${path}.painted`)),
  };
}

function parseRect(value: unknown, path: string, world: CameleonWorld): WorldRect {
  const rect = asRecord(value, path);
  const out = {
    x: nonNegativeNumber(rect, "x", `${path}.x`),
    y: nonNegativeNumber(rect, "y", `${path}.y`),
    w: positiveNumber(rect, "w", `${path}.w`),
    h: positiveNumber(rect, "h", `${path}.h`),
  };
  if (out.x + out.w > world.width || out.y + out.h > world.height) {
    throw new Error(`${path} must fit inside the level world.`);
  }
  return out;
}

function parseDirectionStrings(value: unknown): Readonly<Record<CameleonDirection, string>> {
  const record = asRecord(value, "direction map");
  return {
    poster: stringField(record, "poster", "direction map.poster"),
    riso: stringField(record, "riso", "direction map.riso"),
    night: stringField(record, "night", "direction map.night"),
  };
}

function parseDirectionStringArrays(value: unknown): Readonly<Record<CameleonDirection, readonly string[]>> {
  const record = asRecord(value, "direction array map");
  return {
    poster: arrayField(record, "poster", "direction array map.poster").map((item, index) =>
      ensureString(item, `direction array map.poster[${index}]`),
    ),
    riso: arrayField(record, "riso", "direction array map.riso").map((item, index) =>
      ensureString(item, `direction array map.riso[${index}]`),
    ),
    night: arrayField(record, "night", "direction array map.night").map((item, index) =>
      ensureString(item, `direction array map.night[${index}]`),
    ),
  };
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function required(record: Record<string, unknown>, key: string, path: string): unknown {
  if (!(key in record)) throw new Error(`${path} is required.`);
  return record[key];
}

function stringField(record: Record<string, unknown>, key: string, path: string): string {
  return ensureString(required(record, key, path), path);
}

function ensureString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${path} must be a non-empty string.`);
  return value;
}

function arrayField(record: Record<string, unknown>, key: string, path: string): unknown[] {
  const value = required(record, key, path);
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
}

function zoneField(record: Record<string, unknown>, key: string, path: string): CameleonZone {
  return clampZone(positiveInteger(record, key, path));
}

function clampZone(zone: number): CameleonZone {
  if (!Number.isInteger(zone) || zone < 1 || zone > 5) throw new Error(`zone must be an integer from 1 to 5.`);
  return zone as CameleonZone;
}

function positiveInteger(record: Record<string, unknown>, key: string, path: string): number {
  const value = positiveNumber(record, key, path);
  if (!Number.isInteger(value)) throw new Error(`${path} must be an integer.`);
  return value;
}

function positiveNumber(record: Record<string, unknown>, key: string, path: string): number {
  const value = required(record, key, path);
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${path} must be a positive number.`);
  }
  return value;
}

function nonNegativeNumber(record: Record<string, unknown>, key: string, path: string): number {
  const value = required(record, key, path);
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be a non-negative number.`);
  }
  return value;
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
