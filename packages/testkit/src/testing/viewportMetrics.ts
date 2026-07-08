export interface ViewportMetricsSnapshot {
  windowInnerWidth: number;
  windowInnerHeight: number;
  visualViewportWidth: number | null;
  visualViewportHeight: number | null;
  visualViewportOffsetTop: number | null;
  visualViewportOffsetLeft: number | null;
  visualViewportPageTop: number | null;
  visualViewportPageLeft: number | null;
  visualViewportScale: number | null;
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
  documentElementClientWidth: number;
  documentElementClientHeight: number;
  bodyClientWidth: number;
  bodyClientHeight: number;
  safeAreaInsetTop: number | null;
  safeAreaInsetRight: number | null;
  safeAreaInsetBottom: number | null;
  safeAreaInsetLeft: number | null;
  canvasCssWidth: number | null;
  canvasCssHeight: number | null;
  canvasBackingWidth: number | null;
  canvasBackingHeight: number | null;
  orientationType: string | null;
  timestampMs: number;
}

const VIEWPORT_METRICS_MARKER_ID = '__viewportmetrics__';

export function readViewportMetrics(canvas: HTMLCanvasElement | null = findCanvas()): ViewportMetricsSnapshot {
  const visualViewport = window.visualViewport;
  const canvasRect = canvas?.getBoundingClientRect();
  const safeArea = measureSafeAreaInsets();

  return {
    windowInnerWidth: window.innerWidth,
    windowInnerHeight: window.innerHeight,
    visualViewportWidth: visualViewport?.width ?? null,
    visualViewportHeight: visualViewport?.height ?? null,
    visualViewportOffsetTop: visualViewport?.offsetTop ?? null,
    visualViewportOffsetLeft: visualViewport?.offsetLeft ?? null,
    visualViewportPageTop: visualViewport?.pageTop ?? null,
    visualViewportPageLeft: visualViewport?.pageLeft ?? null,
    visualViewportScale: visualViewport?.scale ?? null,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    devicePixelRatio: window.devicePixelRatio || 1,
    documentElementClientWidth: document.documentElement.clientWidth,
    documentElementClientHeight: document.documentElement.clientHeight,
    bodyClientWidth: document.body?.clientWidth ?? 0,
    bodyClientHeight: document.body?.clientHeight ?? 0,
    safeAreaInsetTop: safeArea.top,
    safeAreaInsetRight: safeArea.right,
    safeAreaInsetBottom: safeArea.bottom,
    safeAreaInsetLeft: safeArea.left,
    canvasCssWidth: canvasRect?.width ?? null,
    canvasCssHeight: canvasRect?.height ?? null,
    canvasBackingWidth: canvas?.width ?? null,
    canvasBackingHeight: canvas?.height ?? null,
    orientationType: window.screen.orientation?.type ?? null,
    timestampMs: Math.round(performance.now()),
  };
}

export function publishViewportMetricsMarker(state?: string): ViewportMetricsSnapshot {
  const metrics = readViewportMetrics();
  const marker = ensureViewportMetricsMarker();
  const label = formatViewportMetricsLabel(metrics, state);
  marker.setAttribute('aria-label', label);
  marker.textContent = label;
  return metrics;
}

function findCanvas(): HTMLCanvasElement | null {
  return document.querySelector('canvas');
}

function measureSafeAreaInsets(): { top: number | null; right: number | null; bottom: number | null; left: number | null } {
  if (!document.body) return { top: null, right: null, bottom: null, left: null };

  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.left = '0';
  probe.style.top = '0';
  probe.style.width = '0';
  probe.style.height = '0';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.paddingTop = 'env(safe-area-inset-top, 0px)';
  probe.style.paddingRight = 'env(safe-area-inset-right, 0px)';
  probe.style.paddingBottom = 'env(safe-area-inset-bottom, 0px)';
  probe.style.paddingLeft = 'env(safe-area-inset-left, 0px)';
  document.body.appendChild(probe);

  const computed = window.getComputedStyle(probe);
  const insets = {
    top: parseCssPx(computed.paddingTop),
    right: parseCssPx(computed.paddingRight),
    bottom: parseCssPx(computed.paddingBottom),
    left: parseCssPx(computed.paddingLeft),
  };
  probe.remove();
  return insets;
}

function parseCssPx(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? roundMetric(parsed) : null;
}

function ensureViewportMetricsMarker(): HTMLElement {
  const existing = document.getElementById(VIEWPORT_METRICS_MARKER_ID);
  if (existing !== null) return existing;

  const marker = document.createElement('div');
  marker.id = VIEWPORT_METRICS_MARKER_ID;
  marker.setAttribute('role', 'text');
  marker.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none;';
  document.body.appendChild(marker);
  return marker;
}

function formatViewportMetricsLabel(metrics: ViewportMetricsSnapshot, state?: string): string {
  return [
    state === undefined ? 'viewportmetrics:' : `viewportmetrics:state=${state}`,
    `inner=${fmt(metrics.windowInnerWidth)}x${fmt(metrics.windowInnerHeight)}`,
    `vv=${fmt(metrics.visualViewportWidth)}x${fmt(metrics.visualViewportHeight)}@${fmt(metrics.visualViewportScale)}`,
    `screen=${fmt(metrics.screenWidth)}x${fmt(metrics.screenHeight)}`,
    `safe=${fmt(metrics.safeAreaInsetTop)},${fmt(metrics.safeAreaInsetRight)},${fmt(metrics.safeAreaInsetBottom)},${fmt(metrics.safeAreaInsetLeft)}`,
    `canvas=${fmt(metrics.canvasCssWidth)}x${fmt(metrics.canvasCssHeight)}/${fmt(metrics.canvasBackingWidth)}x${fmt(metrics.canvasBackingHeight)}`,
    `dpr=${fmt(metrics.devicePixelRatio)}`,
  ].join(';');
}

function fmt(value: number | null): string {
  return value === null ? 'null' : String(roundMetric(value));
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}
