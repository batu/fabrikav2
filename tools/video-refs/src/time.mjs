export function formatTimestamp(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`invalid timestamp: ${value}`);
  const rounded = Math.round(n * 1000) / 1000;
  const text = rounded.toFixed(3).replace(/\.?0+$/, '');
  return text === '-0' || text === '' ? '0' : text;
}
