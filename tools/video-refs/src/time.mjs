export function formatTimestamp(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`invalid timestamp: ${value}`);
  const rounded = Math.round(n * 1e12) / 1e12;
  const text = rounded.toFixed(12).replace(/\.?0+$/, '');
  return text === '-0' || text === '' ? '0' : text;
}

export function parseFrameRate(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const trimmed = value.trim();
  const [numeratorText, denominatorText = '1'] = trimmed.split('/');
  if (trimmed.split('/').length > 2) return null;

  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;

  const fps = numerator / denominator;
  return Number.isFinite(fps) && fps > 0 ? fps : null;
}

export function selectFrameRate({ avgFrameRate, rFrameRate }, tolerance = 1e-6) {
  const avg = parseFrameRate(avgFrameRate);
  const real = parseFrameRate(rFrameRate);
  if (avg !== null && real !== null && Math.abs(avg - real) > tolerance) {
    throw new Error(`conflicting video frame rates: avg_frame_rate=${avgFrameRate}, r_frame_rate=${rFrameRate}`);
  }
  const fps = avg ?? real;
  if (fps === null) {
    throw new Error(`could not determine video frame rate: avg_frame_rate=${avgFrameRate}, r_frame_rate=${rFrameRate}`);
  }
  return fps;
}

export function snapToFrameMidpoint(value, fps) {
  const t = Number(value);
  const rate = Number(fps);
  if (!Number.isFinite(t)) throw new Error(`invalid timestamp: ${value}`);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`fps must be a positive number`);
  const frameIndex = Math.round(t * rate);
  return (frameIndex + 0.5) / rate;
}
