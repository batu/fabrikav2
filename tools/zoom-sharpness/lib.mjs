import crypto from 'node:crypto';

export const SEED = 0x5a17c0de;
export const MAX_ZOOM = 2.5;
export const MS_SSIM_WEIGHTS = [0.0448, 0.2856, 0.3001, 0.2363, 0.1333];

export function hashBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function luminance(data, offset) {
  return 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
}

export function edgeEnergy(image) {
  const { width, height, data } = image;
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = (xx, yy) => luminance(data, (yy * width + xx) * 4);
      const gx = -at(x - 1, y - 1) + at(x + 1, y - 1) - 2 * at(x - 1, y) + 2 * at(x + 1, y) - at(x - 1, y + 1) + at(x + 1, y + 1);
      const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      sum += Math.hypot(gx, gy);
      count += 1;
    }
  }
  return count === 0 ? 0 : sum / count;
}

export function psnr(candidate, reference) {
  assertSameDimensions(candidate, reference);
  let error = 0;
  const pixels = candidate.width * candidate.height;
  for (let i = 0; i < candidate.data.length; i += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = candidate.data[i + channel] - reference.data[i + channel];
      error += delta * delta;
    }
  }
  const mse = error / (pixels * 3);
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

export function psnrBand(value) {
  if (value === Infinity) return 1;
  return Math.max(0, Math.min(1, (value - 20) / 20));
}

function ssimScale(a, b) {
  assertSameDimensions(a, b);
  const n = a.width * a.height;
  let ax = 0; let bx = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    ax += luminance(a.data, i);
    bx += luminance(b.data, i);
  }
  ax /= n; bx /= n;
  let av = 0; let bv = 0; let covariance = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const da = luminance(a.data, i) - ax;
    const db = luminance(b.data, i) - bx;
    av += da * da; bv += db * db; covariance += da * db;
  }
  const denominator = Math.max(1, n - 1);
  av /= denominator; bv /= denominator; covariance /= denominator;
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  return Math.max(0, Math.min(1, ((2 * ax * bx + c1) * (2 * covariance + c2)) / ((ax * ax + bx * bx + c1) * (av + bv + c2))));
}

function downsample(image) {
  const width = Math.max(1, Math.floor(image.width / 2));
  const height = Math.max(1, Math.floor(image.height / 2));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const dst = (y * width + x) * 4;
    for (let c = 0; c < 4; c += 1) {
      let sum = 0; let count = 0;
      for (let yy = 0; yy < 2; yy += 1) for (let xx = 0; xx < 2; xx += 1) {
        const sx = Math.min(image.width - 1, x * 2 + xx);
        const sy = Math.min(image.height - 1, y * 2 + yy);
        sum += image.data[(sy * image.width + sx) * 4 + c]; count += 1;
      }
      data[dst + c] = Math.round(sum / count);
    }
  }
  return { width, height, data };
}

export function msSsim(candidate, reference) {
  let a = candidate; let b = reference; let product = 1;
  for (let scale = 0; scale < MS_SSIM_WEIGHTS.length; scale += 1) {
    product *= ssimScale(a, b) ** MS_SSIM_WEIGHTS[scale];
    if (scale < MS_SSIM_WEIGHTS.length - 1) { a = downsample(a); b = downsample(b); }
  }
  return product;
}

export function scorePair(candidate, reference) {
  assertSameDimensions(candidate, reference);
  const similarity = msSsim(candidate, reference);
  const candidateEdge = edgeEnergy(candidate);
  const referenceEdge = edgeEnergy(reference);
  const edgeRatio = referenceEdge === 0 ? (candidateEdge === 0 ? 1 : 0) : Math.min(candidateEdge / referenceEdge, 1);
  const psnrDb = psnr(candidate, reference);
  const band = psnrBand(psnrDb);
  return { msSsim: similarity, edgeEnergyRatio: edgeRatio, candidateEdgeEnergy: candidateEdge, referenceEdgeEnergy: referenceEdge, psnrDb, psnrBand: band, composite: 100 * (0.5 * similarity + 0.3 * edgeRatio + 0.2 * band) };
}

export function assertSameDimensions(a, b) {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`image dimension mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
}

function lanczos(x, a = 3) {
  if (x === 0) return 1;
  if (Math.abs(x) >= a) return 0;
  return (Math.sin(Math.PI * x) * Math.sin(Math.PI * x / a)) / (Math.PI * Math.PI * x * x / a);
}

export function resampleLanczos(source, crop, width, height) {
  if (width <= 0 || height <= 0 || crop.width <= 0 || crop.height <= 0) throw new Error('invalid resample dimensions');
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sx = crop.x + ((x + 0.5) * crop.width / width) - 0.5;
    const sy = crop.y + ((y + 0.5) * crop.height / height) - 0.5;
    const dst = (y * width + x) * 4;
    let weightSum = 0; const sums = [0, 0, 0, 0];
    for (let yy = Math.floor(sy) - 2; yy <= Math.floor(sy) + 3; yy += 1) for (let xx = Math.floor(sx) - 2; xx <= Math.floor(sx) + 3; xx += 1) {
      const weight = lanczos(sx - xx) * lanczos(sy - yy);
      const px = Math.max(0, Math.min(source.width - 1, xx));
      const py = Math.max(0, Math.min(source.height - 1, yy));
      const src = (py * source.width + px) * 4;
      for (let c = 0; c < 4; c += 1) sums[c] += source.data[src + c] * weight;
      weightSum += weight;
    }
    for (let c = 0; c < 4; c += 1) data[dst + c] = Math.max(0, Math.min(255, Math.round(sums[c] / weightSum)));
  }
  return { width, height, data };
}

export function cropImage(image, rect) {
  const data = new Uint8Array(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y += 1) {
    const start = ((rect.y + y) * image.width + rect.x) * 4;
    data.set(image.data.subarray(start, start + rect.width * 4), y * rect.width * 4);
  }
  return { width: rect.width, height: rect.height, data };
}

export function sourceCropForCapture(capture) {
  const viewLeft = capture.scrollX + (capture.canvasWidth - capture.canvasWidth / capture.zoom) / 2;
  const viewTop = capture.scrollY + (capture.canvasHeight - capture.canvasHeight / capture.zoom) / 2;
  const viewWidth = capture.canvasWidth / capture.zoom;
  const viewHeight = capture.canvasHeight / capture.zoom;
  const x0 = Math.max(0, (viewLeft - capture.imgOffsetX) / capture.imgScale);
  const y0 = Math.max(0, (viewTop - capture.imgOffsetY) / capture.imgScale);
  const x1 = Math.min(capture.levelWidth, (viewLeft + viewWidth - capture.imgOffsetX) / capture.imgScale);
  const y1 = Math.min(capture.levelHeight, (viewTop + viewHeight - capture.imgOffsetY) / capture.imgScale);
  const canvasX = Math.max(0, Math.round((capture.imgOffsetX + x0 * capture.imgScale - viewLeft) * capture.zoom));
  const canvasY = Math.max(0, Math.round((capture.imgOffsetY + y0 * capture.imgScale - viewTop) * capture.zoom));
  const canvasWidth = Math.min(capture.canvasWidth - canvasX, Math.max(1, Math.round((x1 - x0) * capture.imgScale * capture.zoom)));
  const canvasHeight = Math.min(capture.canvasHeight - canvasY, Math.max(1, Math.round((y1 - y0) * capture.imgScale * capture.zoom)));
  return { source: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, canvas: { x: canvasX, y: canvasY, width: canvasWidth, height: canvasHeight } };
}

function stringSeed(text) {
  let value = SEED;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return value || 1;
}

function random01(levelId) {
  let state = stringSeed(levelId);
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x100000000; };
}

export function selectPoses(level, source, cropSize) {
  const halfW = cropSize.width / 2; const halfH = cropSize.height / 2;
  const clamp = (value, half, size) => Math.max(half, Math.min(size - half, value));
  const dog = level.dogs[0];
  const stride = Math.max(1, Math.floor(Math.min(cropSize.width, cropSize.height) / 32));
  const integralWidth = source.width + 1;
  const integral = new Float64Array(integralWidth * (source.height + 1));
  for (let y = 1; y < source.height - 1; y += 1) {
    let row = 0;
    for (let x = 1; x < source.width - 1; x += 1) {
      const at = (xx, yy) => luminance(source.data, (yy * source.width + xx) * 4);
      const gx = -at(x - 1, y - 1) + at(x + 1, y - 1) - 2 * at(x - 1, y) + 2 * at(x + 1, y) - at(x - 1, y + 1) + at(x + 1, y + 1);
      const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      row += Math.hypot(gx, gy);
      integral[(y + 1) * integralWidth + (x + 1)] = integral[y * integralWidth + (x + 1)] + row;
    }
  }
  const rectEnergy = (left, top, width, height) => {
    const x0 = Math.max(0, Math.floor(left)); const y0 = Math.max(0, Math.floor(top));
    const x1 = Math.min(source.width, Math.ceil(left + width)); const y1 = Math.min(source.height, Math.ceil(top + height));
    return integral[y1 * integralWidth + x1] - integral[y0 * integralWidth + x1] - integral[y1 * integralWidth + x0] + integral[y0 * integralWidth + x0];
  };
  let dense = { x: halfW, y: halfH, energy: -1 };
  for (let y = halfH; y <= level.height - halfH; y += stride) for (let x = halfW; x <= level.width - halfW; x += stride) {
    const energy = rectEnergy(x - halfW, y - halfH, cropSize.width, cropSize.height);
    if (energy > dense.energy) dense = { x, y, energy };
  }
  const random = random01(level.id);
  return [
    { name: 'dog', centerX: clamp(dog.x, halfW, level.width), centerY: clamp(dog.y, halfH, level.height) },
    { name: 'dense', centerX: dense.x, centerY: dense.y },
    { name: 'random', centerX: halfW + random() * Math.max(0, level.width - cropSize.width), centerY: halfH + random() * Math.max(0, level.height - cropSize.height) },
  ];
}

export function scrollForCenter(center, geometry, zoom) {
  return { scrollX: geometry.imgOffsetX + center.centerX * geometry.imgScale - geometry.canvasWidth / 2, scrollY: geometry.imgOffsetY + center.centerY * geometry.imgScale - geometry.canvasHeight / 2 };
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function worstDecile(values) {
  const count = Math.max(1, Math.ceil(values.length * 0.1));
  return [...values].sort((a, b) => a - b).slice(0, count).reduce((sum, value) => sum + value, 0) / count;
}

export function rounded(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 'Infinity';
}
