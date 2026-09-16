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
  birds: Record<string, Record<string, string>>;
  markers: { plot: string; pedestalEmpty: string; coinPile: string };
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
}

const COIN_PILE_BG_WIDTH = 170;
const PLOT_MARKER_BG_WIDTH = 300;

/** Map a point in manifest background px to CSS px. */
function toCss(point: ManifestPoint, bg: Rect, scale: number): ManifestPoint {
  return { x: bg.left + point.x * scale, y: bg.top + point.y * scale };
}

/**
 * Cover-fit the background into the viewport, biased so the branch band stays
 * visible: the band's vertical centre is pinned to the viewport centre and then
 * clamped so no gap can appear at either edge.
 */
export function fitBackground(
  manifest: SanctuaryManifest,
  viewport: { width: number; height: number },
): { rect: Rect; scale: number } {
  const [bgW, bgH] = manifest.background.size;
  const scale = Math.max(viewport.width / bgW, viewport.height / bgH);
  const width = bgW * scale;
  const height = bgH * scale;
  const left = (viewport.width - width) / 2;

  const [bandTop, bandBottom] = manifest.background.placementBand.y;
  const bandCentre = ((bandTop + bandBottom) / 2) * scale;
  const desiredTop = viewport.height / 2 - bandCentre;
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
  const houseScale = scale * anchor.scale;

  const plotWidth = PLOT_MARKER_BG_WIDTH * scale;
  const plotAnchor = toCss({ x: anchor.x, y: anchor.bottom }, background, scale);
  const plotMarker: Rect = {
    left: plotAnchor.x - plotWidth / 2,
    top: plotAnchor.y - plotWidth,
    width: plotWidth,
    height: plotWidth,
  };

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
    };
  }

  // The sprite is a 1024-square canvas with the house inside `bbox`; the bbox's
  // bottom-centre is what sits on the branch, not the canvas centre.
  const [spriteW, spriteH] = entry.size;
  const [x0, , x1, y1] = entry.bbox;
  const bboxCentreX = ((x0 + x1) / 2) * houseScale;
  const bboxBottomY = y1 * houseScale;
  const house: Rect = {
    left: plotAnchor.x - bboxCentreX,
    top: plotAnchor.y - bboxBottomY,
    width: spriteW * houseScale,
    height: spriteH * houseScale,
  };

  const pedestals: PedestalLayout[] = entry.pedestals.map((pedestal, index) => {
    const feet = {
      x: house.left + pedestal.anchor[0] * houseScale,
      y: house.top + pedestal.anchor[1] * houseScale,
    };
    const birdHeight = pedestal.width * houseScale;
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

  return { background, scale, house, pedestals, plotMarker, coinPile };
}
