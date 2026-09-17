/**
 * Sanctuary geometry: turn the asset manifest's background-pixel space into CSS
 * rects for a given viewport.
 *
 * The manifest is authored against a 1024x1536 background. Everything (house
 * anchor, pedestal anchors, marker sizes) is expressed in those pixels, so the
 * page only ever needs one transform: cover-fit the background, then map.
 *
 * Cover-fit can crop. The branch band is where the whole feature lives, so the
 * vertical offset is biased to keep that band on screen rather than centring
 * blindly.
 */

export interface ManifestPoint { x: number; y: number }

export interface SanctuaryManifest {
  background: { src: string; size: [number, number]; placementBand: { x: [number, number]; y: [number, number] } };
  houseAnchor: { x: number; bottom: number; scale: number };
  houseTiers: Array<{
    tier: number;
    src: string;
    size: [number, number];
    bbox: [number, number, number, number];
    pedestals: Array<{ anchor: [number, number]; width: number }>;
  }>;
  /** Foot centre per bird per costume (fraction of sprite width); falls back to birdFootCenterX. */
  birdFoot?: Record<string, Record<string, number>>;
  /** The next plot's placeholder house, drawn locked in its own slide. */
  lockedHouse?: { src: string; size: [number, number]; bbox: [number, number, number, number] };
  birds: Record<string, Record<string, string>>;
  markers: { plot: string; pedestalEmpty: string; coinPile: string };
  /** Where the feet sit across each bird sprite, as a fraction of its width. */
  birdFootCenterX?: Record<string, number>;
  markerFootCenterX?: number;
}

export interface Rect { left: number; top: number; width: number; height: number }

export interface PedestalLayout {
  index: number;
  /** Where the bird's feet land, in CSS px. */
  anchor: ManifestPoint;
  /** Rendered bird height in CSS px. */
  birdHeight: number;
  /** Contact-shadow ellipse under the feet. */
  shadow: Rect;
}

export interface SanctuaryLayout {
  /** Background image rect, cover-fitted; may extend past the viewport. */
  background: Rect;
  /** Scale from manifest background px to CSS px. */
  scale: number;
  /** House sprite rect, or null when no house is built. */
  house: Rect | null;
  pedestals: PedestalLayout[];
  /** Build-site marker rect, shown only when no house is built. */
  plotMarker: Rect;
  /** Coin pile rect, to the right of the house on the branch. */
  coinPile: Rect;
  /** The locked next-plot house at the same anchor (for its own slide), null without art. */
  lockedHouse: Rect | null;
}

const COIN_PILE_BG_WIDTH = 170;
const PLOT_MARKER_BG_WIDTH = 300;
/** Widest a house may draw, as a fraction of the viewport, so a wide tier keeps
 *  its perches on screen with a little breathing room at the edges. */
const HOUSE_VIEWPORT_FRACTION = 0.92;

/** Map a point in manifest background px to CSS px. */
function toCss(point: ManifestPoint, bg: Rect, scale: number): ManifestPoint {
  return { x: bg.left + point.x * scale, y: bg.top + point.y * scale };
}

/**
 * Cover-fit the background into the viewport, biased so the branch band stays
 * visible: the band's vertical centre is pinned to the viewport centre and then
 * clamped so no gap can appear at either edge.
 */
/** Where the branch's top surface sits, as a fraction of the viewport height. */
const BRANCH_VIEWPORT_Y = 0.70;
/** Birds are drawn larger than the perch geometry alone would give them. */
const BIRD_SCALE = 1.5;

export function fitBackground(
  manifest: SanctuaryManifest,
  viewport: { width: number; height: number },
): { rect: Rect; scale: number } {
  const [bgW, bgH] = manifest.background.size;
  const cover = Math.max(viewport.width / bgW, viewport.height / bgH);
  // On a phone the cover fit already spans the viewport exactly, so the branch
  // cannot be pushed lower without zooming: scale up just enough that the
  // branch top lands at BRANCH_VIEWPORT_Y with the image still covering.
  const scale = Math.max(cover, (viewport.height * BRANCH_VIEWPORT_Y) / manifest.houseAnchor.bottom);
  const width = bgW * scale;
  const height = bgH * scale;
  const left = (viewport.width - width) / 2;

  // The branch (where the house stands) is pinned low in the viewport so the
  // scene reads as tree above, house on the log, valley below.
  const branchY = manifest.houseAnchor.bottom * scale;
  const desiredTop = viewport.height * BRANCH_VIEWPORT_Y - branchY;
  // Never expose the canvas edges: the image must still cover the viewport.
  const top = Math.min(0, Math.max(viewport.height - height, desiredTop));

  return { rect: { left, top, width, height }, scale };
}

/** Full layout for a tier (0 = nothing built) and its current tenants. */
export function layoutSanctuary(
  manifest: SanctuaryManifest,
  tier: number,
  viewport: { width: number; height: number },
): SanctuaryLayout {
  const { rect: background, scale } = fitBackground(manifest, viewport);
  const anchor = manifest.houseAnchor;
  const uncappedHouseScale = scale * anchor.scale;

  const plotWidth = PLOT_MARKER_BG_WIDTH * scale;
  const plotAnchor = toCss({ x: anchor.x, y: anchor.bottom }, background, scale);
  const plotMarker: Rect = {
    left: plotAnchor.x - plotWidth / 2,
    top: plotAnchor.y - plotWidth,
    width: plotWidth,
    height: plotWidth,
  };

  // Every tier (and the locked placeholder) shares one scale, capped so the
  // widest tier fits the viewport; see the note below the early return.
  const widestBboxSprite = manifest.houseTiers.reduce(
    (widest, candidate) => Math.max(widest, candidate.bbox[2] - candidate.bbox[0]),
    1,
  );
  const maxHouseWidth = viewport.width * HOUSE_VIEWPORT_FRACTION;
  const houseScale = Math.min(uncappedHouseScale, maxHouseWidth / widestBboxSprite);
  const margin = (viewport.width - maxHouseWidth) / 2;
  const placeSprite = (size: [number, number], bbox: [number, number, number, number]): Rect => {
    const [spriteW, spriteH] = size;
    const [x0, , x1, y1] = bbox;
    const bboxWidth = (x1 - x0) * houseScale;
    const bboxCentreX = ((x0 + x1) / 2) * houseScale;
    const bboxBottomY = y1 * houseScale;
    const centreX = Math.min(
      Math.max(plotAnchor.x, margin + bboxWidth / 2),
      viewport.width - margin - bboxWidth / 2,
    );
    return { left: centreX - bboxCentreX, top: plotAnchor.y - bboxBottomY, width: spriteW * houseScale, height: spriteH * houseScale };
  };
  const lockedHouse = manifest.lockedHouse ? placeSprite(manifest.lockedHouse.size, manifest.lockedHouse.bbox) : null;

  const entry = manifest.houseTiers.find((candidate) => candidate.tier === tier) ?? null;
  if (entry === null) {
    const pileWidth = COIN_PILE_BG_WIDTH * scale;
    return {
      background,
      scale,
      house: null,
      pedestals: [],
      plotMarker,
      coinPile: {
        left: plotAnchor.x + plotWidth * 0.3,
        top: plotAnchor.y - pileWidth,
        width: pileWidth,
        height: pileWidth,
      },
      lockedHouse,
    };
  }

  // The sprite is a 1024-square canvas with the house inside `bbox`; the bbox's
  // bottom-centre is what sits on the branch, not the canvas centre.
  const house = placeSprite(entry.size, entry.bbox);

  const pedestals: PedestalLayout[] = entry.pedestals.map((pedestal, index) => {
    const feet = {
      x: house.left + pedestal.anchor[0] * houseScale,
      y: house.top + pedestal.anchor[1] * houseScale,
    };
    const birdHeight = pedestal.width * houseScale * BIRD_SCALE;
    const shadowWidth = birdHeight * 0.8;
    const shadowHeight = birdHeight / 5;
    return {
      index,
      anchor: feet,
      birdHeight,
      shadow: {
        left: feet.x - shadowWidth / 2,
        top: feet.y - shadowHeight / 2,
        width: shadowWidth,
        height: shadowHeight,
      },
    };
  });

  const pileWidth = COIN_PILE_BG_WIDTH * scale;
  const coinPile: Rect = {
    left: house.left + house.width * 0.62,
    top: plotAnchor.y - pileWidth * 0.95,
    width: pileWidth,
    height: pileWidth,
  };

  return { background, scale, house, pedestals, plotMarker, coinPile, lockedHouse };
}
