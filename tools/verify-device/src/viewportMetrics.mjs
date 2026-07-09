import { shotToken } from './states.mjs';

export function stateFromViewportMetricsAttachmentName(name, states = []) {
  if (typeof name !== 'string') return null;
  const validStates = new Set(Array.isArray(states) ? states : []);
  const token = shotToken(name);
  const state = token.replace(/-viewportmetrics(?:-missing)?$/, '');
  return validStates.has(state) && state !== token ? state : null;
}

export function parseViewportMetricsLabel(label) {
  if (typeof label !== 'string' || !label.startsWith('viewportmetrics:')) {
    throw new Error(`invalid viewport metrics label: ${label}`);
  }

  const [prefix, ...parts] = label.split(';');
  const markerState = prefix.startsWith('viewportmetrics:state=')
    ? prefix.slice('viewportmetrics:state='.length)
    : null;
  const parsed = { markerState };

  for (const part of parts) {
    const [key, value] = part.split('=');
    if (!key || value === undefined) continue;
    switch (key) {
      case 'inner': {
        const [width, height] = parseSize(value);
        parsed.windowInnerWidth = width;
        parsed.windowInnerHeight = height;
        break;
      }
      case 'vv': {
        const [size, scale] = value.split('@');
        const [width, height] = parseSize(size);
        parsed.visualViewportWidth = width;
        parsed.visualViewportHeight = height;
        parsed.visualViewportScale = parseMetric(scale);
        break;
      }
      case 'screen': {
        const [width, height] = parseSize(value);
        parsed.screenWidth = width;
        parsed.screenHeight = height;
        break;
      }
      case 'safe': {
        const [top, right, bottom, left] = value.split(',').map(parseMetric);
        parsed.safeAreaInsetTop = top;
        parsed.safeAreaInsetRight = right;
        parsed.safeAreaInsetBottom = bottom;
        parsed.safeAreaInsetLeft = left;
        break;
      }
      case 'canvas': {
        const [css, backing] = value.split('/');
        const [cssWidth, cssHeight] = parseSize(css);
        const [backingWidth, backingHeight] = parseSize(backing);
        parsed.canvasCssWidth = cssWidth;
        parsed.canvasCssHeight = cssHeight;
        parsed.canvasBackingWidth = backingWidth;
        parsed.canvasBackingHeight = backingHeight;
        break;
      }
      case 'dpr':
        parsed.devicePixelRatio = parseMetric(value);
        break;
    }
  }

  return parsed;
}

export function resolveViewportMetricRanges(manifest = {}) {
  const raw = manifest.verifyDevice?.viewportMetrics?.ranges;
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error('verifyDevice.viewportMetrics.ranges must be a list');
  }
  const validStates = new Set((manifest.states || []).map((state) => state.name));

  return raw.map((entry, index) => {
    const label = `verifyDevice.viewportMetrics.ranges[${index}]`;
    const metric = entry?.metric;
    if (typeof metric !== 'string' || metric.length === 0) {
      throw new Error(`${label}.metric is required`);
    }
    const min = optionalFinite(entry?.min, `${label}.min`);
    const max = optionalFinite(entry?.max, `${label}.max`);
    if (min === null && max === null) {
      throw new Error(`${label} must declare min and/or max`);
    }
    if (min !== null && max !== null && min > max) {
      throw new Error(`${label}.min must be <= max`);
    }
    const states = entry?.states == null
      ? [...validStates]
      : normalizeStates(entry.states, validStates, `${label}.states`);
    return {
      metric,
      min,
      max,
      states,
      label: typeof entry?.label === 'string' && entry.label.length > 0 ? entry.label : metric,
    };
  });
}

export function evaluateViewportMetricAssertions({ manifest = {}, metricsByState = {} } = {}) {
  const ranges = resolveViewportMetricRanges(manifest);
  const assertions = [];
  for (const range of ranges) {
    for (const state of range.states) {
      const metrics = metricsByState[state] || null;
      const value = metrics?.[range.metric];
      const status = classifyRangeValue(value, range);
      assertions.push({
        state,
        metric: range.metric,
        label: range.label,
        min: range.min,
        max: range.max,
        value: Number.isFinite(value) ? value : null,
        status,
        reason: rangeReason(value, range, status),
      });
    }
  }
  return assertions;
}

export function viewportMetricAssertionsPass(assertions = []) {
  return assertions.every((assertion) => assertion.status === 'pass');
}

export function summarizeViewportMetricAssertions(assertions = []) {
  if (assertions.length === 0) return null;
  const failed = assertions.filter((assertion) => assertion.status !== 'pass').length;
  return `${failed === 0 ? 'PASS' : 'FAIL'} — ${assertions.length - failed} pass, ${failed} fail`;
}

export function formatViewportMetricAssertions(assertions = []) {
  if (assertions.length === 0) return '';
  const stateWidth = Math.max(5, ...assertions.map((assertion) => assertion.state.length));
  const metricWidth = Math.max(6, ...assertions.map((assertion) => assertion.metric.length));
  const lines = [
    '  viewport-metrics assertions:',
    `    ${'state'.padEnd(stateWidth)}  ${'metric'.padEnd(metricWidth)}  value  range  status`,
    ...assertions.map((assertion) => {
      const range = formatRange(assertion.min, assertion.max);
      const value = Number.isFinite(assertion.value) ? String(assertion.value) : '-';
      return `    ${assertion.state.padEnd(stateWidth)}  ${assertion.metric.padEnd(metricWidth)}  `
        + `${value.padStart(5)}  ${range.padEnd(13)}  ${assertion.status}`;
    }),
  ];
  return `${lines.join('\n')}\n`;
}

function parseSize(value) {
  const [width, height] = String(value || '').split('x');
  return [parseMetric(width), parseMetric(height)];
}

function parseMetric(value) {
  if (value === 'null' || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalFinite(value, label) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number`);
  return number;
}

function normalizeStates(raw, validStates, label) {
  if (!Array.isArray(raw)) throw new Error(`${label} must be a list`);
  return raw.map((state) => {
    if (!validStates.has(state)) throw new Error(`${label} contains unknown state "${state}"`);
    return state;
  });
}

function classifyRangeValue(value, range) {
  if (!Number.isFinite(value)) return 'missing';
  if (range.min !== null && value < range.min) return 'fail';
  if (range.max !== null && value > range.max) return 'fail';
  return 'pass';
}

function rangeReason(value, range, status) {
  if (status === 'missing') return `${range.metric} was not published`;
  if (status === 'pass') return `${range.metric} within ${formatRange(range.min, range.max)}`;
  if (range.min !== null && value < range.min) return `${range.metric} ${value} < min ${range.min}`;
  return `${range.metric} ${value} > max ${range.max}`;
}

function formatRange(min, max) {
  if (min !== null && max !== null) return `${min}..${max}`;
  if (min !== null) return `>=${min}`;
  return `<=${max}`;
}
