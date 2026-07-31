export interface LevelDimensions {
  width: number;
  height: number;
}

export interface LevelCoverFit {
  scale: number;
  displayWidth: number;
  displayHeight: number;
  initialScrollX: number;
  initialScrollY: number;
}

export interface LevelPanBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Cover fit for one continuous, full-bleed level image.
 *
 * The image remains at a non-negative world origin so reveal canvases and hit
 * tests cover its complete extent. The initial camera scroll centers the crop;
 * overflow stays reachable by panning.
 */
export function resolveLevelCoverFit(
  level: LevelDimensions,
  viewport: LevelDimensions,
): LevelCoverFit {
  const scale = Math.max(viewport.width / level.width, viewport.height / level.height);
  const displayWidth = level.width * scale;
  const displayHeight = level.height * scale;

  return {
    scale,
    displayWidth,
    displayHeight,
    initialScrollX: (displayWidth - viewport.width) / 2,
    initialScrollY: (displayHeight - viewport.height) / 2,
  };
}

/**
 * Camera bounds for continuous levels. Bounds never extend beyond the rendered
 * artwork, so panning cannot expose the world background at any edge.
 */
export function resolveLevelPanBounds(
  _level: LevelDimensions,
  viewport: LevelDimensions,
  fit: LevelCoverFit,
): LevelPanBounds {
  return {
    x: 0,
    y: 0,
    width: Math.max(viewport.width, fit.displayWidth),
    height: Math.max(viewport.height, fit.displayHeight),
  };
}
