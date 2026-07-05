export interface ResponsiveSize {
  width: number;
  height: number;
}

export type ResponsiveOrientation = 'auto' | 'portrait' | 'landscape';
export type ResponsiveFitMode = 'contain' | 'cover';

export interface ResponsiveLayoutOptions {
  deviceWidth: number;
  deviceHeight: number;
  devicePixelRatio?: number;
  maxDpr?: number;
  orientation?: ResponsiveOrientation;
  fitMode?: ResponsiveFitMode;
  portraitSize?: ResponsiveSize;
  landscapeSize?: ResponsiveSize;
}

export interface ResponsiveLayout {
  dpr: number;
  canvasWidth: number;
  canvasHeight: number;
  designWidth: number;
  designHeight: number;
  designAspect: number;
  px: number;
  isPortrait: boolean;
}

const DEFAULT_PORTRAIT_SIZE: ResponsiveSize = {
  width: 540,
  height: 960,
};

const DEFAULT_LANDSCAPE_SIZE: ResponsiveSize = {
  width: 960,
  height: 540,
};

function resolveOrientation(
  deviceWidth: number,
  deviceHeight: number,
  orientation: ResponsiveOrientation,
): boolean {
  if (orientation === 'portrait') return true;
  if (orientation === 'landscape') return false;
  return deviceHeight > deviceWidth;
}

export function createResponsiveLayout(options: ResponsiveLayoutOptions): ResponsiveLayout {
  const {
    deviceWidth,
    deviceHeight,
    devicePixelRatio = 1,
    maxDpr = 2,
    orientation = 'auto',
    fitMode = 'contain',
    portraitSize = DEFAULT_PORTRAIT_SIZE,
    landscapeSize = DEFAULT_LANDSCAPE_SIZE,
  } = options;

  const dpr = Math.min(devicePixelRatio || 1, maxDpr);
  const isPortrait = resolveOrientation(deviceWidth, deviceHeight, orientation);
  const designSize = isPortrait ? portraitSize : landscapeSize;
  const designAspect = designSize.width / designSize.height;

  const devicePixelWidth = deviceWidth * dpr;
  const devicePixelHeight = deviceHeight * dpr;
  const deviceAspect = devicePixelWidth / devicePixelHeight;

  let canvasWidth: number;
  let canvasHeight: number;

  if (fitMode === 'contain') {
    if (deviceAspect > designAspect) {
      canvasHeight = devicePixelHeight;
      canvasWidth = Math.round(devicePixelHeight * designAspect);
    } else {
      canvasWidth = devicePixelWidth;
      canvasHeight = Math.round(devicePixelWidth / designAspect);
    }
  } else if (deviceAspect > designAspect) {
    canvasWidth = devicePixelWidth;
    canvasHeight = Math.round(devicePixelWidth / designAspect);
  } else {
    canvasHeight = devicePixelHeight;
    canvasWidth = Math.round(devicePixelHeight * designAspect);
  }

  return {
    dpr,
    canvasWidth,
    canvasHeight,
    designWidth: designSize.width,
    designHeight: designSize.height,
    designAspect,
    px: canvasWidth / designSize.width,
    isPortrait,
  };
}
