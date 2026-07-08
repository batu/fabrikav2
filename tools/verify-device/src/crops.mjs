import fs from 'node:fs';
import path from 'node:path';
import { decodePng, encodePng } from '../../refcap-compare/src/png.mjs';
import { diffThumbnail } from '../../refcap-compare/src/diff.mjs';

const REGION_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;
const EPSILON = 1e-9;

/**
 * @param {object} manifest loaded game refs manifest
 * @returns {Array<{name:string,label:string,states:string[],coords:'normalized',box:{x:number,y:number,width:number,height:number}}>}
 */
export function resolveCropRegions(manifest = {}) {
  const raw = manifest.verifyDevice?.regions;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error('verifyDevice.regions must be a list');
  }
  const validStates = (manifest.states || []).map((s) => s.name);
  const seen = new Set();
  return raw.map((region, index) => normalizeRegion(region, index, validStates, seen));
}

function normalizeRegion(region, index, validStates, seen) {
  const label = `verifyDevice.regions[${index}]`;
  if (!region || typeof region !== 'object') {
    throw new Error(`${label} must be a mapping`);
  }
  const name = requireString(region.name, `${label}.name`);
  if (!REGION_NAME_RE.test(name)) {
    throw new Error(`${label}.name must be machine-safe [a-z0-9_-], got: ${name}`);
  }
  if (seen.has(name)) throw new Error(`duplicate verifyDevice region "${name}"`);
  seen.add(name);

  const coords = requireString(region.coords, `${label}.coords`);
  if (coords !== 'normalized') {
    throw new Error(`${label}.coords must be "normalized", got: ${coords}`);
  }
  return {
    name,
    label: requireString(region.label, `${label}.label`),
    states: normalizeStates(region.states, validStates, `${label}.states`),
    coords,
    box: normalizeBox(region.box, `${label}.box`),
  };
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeStates(value, validStates, label) {
  let states;
  if (value === 'all') {
    states = validStates;
  } else if (Array.isArray(value)) {
    states = value;
  } else if (typeof value === 'string') {
    states = [value];
  } else {
    throw new Error(`${label} must be "all", a state name, or a list of state names`);
  }
  if (!states.length) throw new Error(`${label} must include at least one state`);
  const seen = new Set();
  for (const state of states) {
    if (typeof state !== 'string' || !state.trim()) throw new Error(`${label} contains a non-string state`);
    if (!validStates.includes(state)) {
      throw new Error(`${label} contains unknown state "${state}" (expected one of ${validStates.join(', ')})`);
    }
    if (seen.has(state)) throw new Error(`${label} contains duplicate state "${state}"`);
    seen.add(state);
  }
  return states;
}

function normalizeBox(value, label) {
  if (!value || typeof value !== 'object') throw new Error(`${label} must be a mapping`);
  const box = {
    x: finiteNumber(value.x, `${label}.x`),
    y: finiteNumber(value.y, `${label}.y`),
    width: finiteNumber(value.width, `${label}.width`),
    height: finiteNumber(value.height, `${label}.height`),
  };
  if (box.x < 0 || box.y < 0) throw new Error(`${label}.x/y must be >= 0`);
  if (box.width <= 0 || box.height <= 0) throw new Error(`${label}.width/height must be > 0`);
  if (box.x + box.width > 1 + EPSILON || box.y + box.height > 1 + EPSILON) {
    throw new Error(`${label} normalized coordinates must stay within the source image`);
  }
  return box;
}

function finiteNumber(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number, got: ${value}`);
  return n;
}

export function cropImage(img, box) {
  const pixels = normalizedBoxToPixels(img, box);
  const data = new Uint8Array(pixels.width * pixels.height * 4);
  const cropRowBytes = pixels.width * 4;
  for (let y = 0; y < pixels.height; y++) {
    const srcStart = ((pixels.y + y) * img.width + pixels.x) * 4;
    data.set(img.data.subarray(srcStart, srcStart + cropRowBytes), y * cropRowBytes);
  }
  return {
    img: { width: pixels.width, height: pixels.height, data },
    pixels,
  };
}

function normalizedBoxToPixels(img, box) {
  const x = Math.floor(box.x * img.width);
  const y = Math.floor(box.y * img.height);
  const right = Math.ceil((box.x + box.width) * img.width);
  const bottom = Math.ceil((box.y + box.height) * img.height);
  const width = right - x;
  const height = bottom - y;
  if (x < 0 || y < 0 || right > img.width || bottom > img.height || width <= 0 || height <= 0) {
    throw new Error(
      `crop box ${JSON.stringify(box)} resolves outside source image ${img.width}x${img.height}`
    );
  }
  return { x, y, width, height };
}

/**
 * Emit named crops under <outDir>/crops and write <outDir>/crops/inventory.json.
 * @param {object} params
 * @param {object} params.manifest loaded game refs manifest
 * @param {Array} params.rows verify-device rows built from judged captures
 * @param {string} params.outDir run output dir
 * @param {string} params.repoRoot repository root for human-readable paths
 * @param {string} [params.generatedAt] run stamp
 */
export function writeCropArtifacts({ manifest, rows, outDir, repoRoot, generatedAt }) {
  const regions = resolveCropRegions(manifest);
  if (!regions.length) {
    return { regions, entries: [], cropDir: null, inventoryPath: null, count: 0, skipped: 0 };
  }

  const cropDir = path.join(outDir, 'crops');
  fs.rmSync(cropDir, { recursive: true, force: true });
  fs.mkdirSync(cropDir, { recursive: true });

  const entries = [];
  const regionsByState = new Map();
  for (const region of regions) {
    for (const state of region.states) {
      if (!regionsByState.has(state)) regionsByState.set(state, []);
      regionsByState.get(state).push(region);
    }
  }

  for (const row of rows || []) {
    for (const region of regionsByState.get(row.state) || []) {
      const device = writeSideCrop({ manifest, row, region, side: 'device', cropDir, repoRoot });
      const reference = writeSideCrop({ manifest, row, region, side: 'reference', cropDir, repoRoot });
      entries.push(device.entry, reference.entry);
      entries.push(writeDiffCrop({ row, region, cropDir, device, reference }));
    }
  }

  const inventoryPath = path.join(cropDir, 'inventory.json');
  const inventory = {
    game: manifest.game,
    generatedAt,
    schema: 'verifyDevice.regions coords=normalized',
    cropDir: pathLabel(cropDir, repoRoot),
    entries,
  };
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2));
  return {
    regions,
    entries,
    cropDir,
    inventoryPath,
    count: entries.filter((e) => e.path && !e.skipReason).length,
    skipped: entries.filter((e) => e.skipReason).length,
  };
}

function writeSideCrop({ manifest, row, region, side, cropDir, repoRoot }) {
  const cell = row[side];
  const base = baseEntry({ row, region, side });
  if (!cell || cell.gap) {
    return { entry: { ...base, skipReason: cell?.gap || `no ${side} cell` } };
  }
  const source = resolveCellSource({ manifest, cell, side });
  if (!source || !fs.existsSync(source)) {
    return { entry: { ...base, sourceImage: source || cell.source || null, skipReason: `${side} source missing` } };
  }
  const img = decodePng(fs.readFileSync(source));
  const crop = cropImage(img, region.box);
  const filename = `${safeSegment(row.state)}--${safeSegment(region.name)}--${side}.png`;
  const outPath = path.join(cropDir, filename);
  fs.writeFileSync(outPath, encodePng(crop.img.width, crop.img.height, crop.img.data));
  return {
    entry: {
      ...base,
      sourceImage: pathLabel(source, repoRoot),
      path: path.posix.join('crops', filename),
      geometry: geometry(region, crop.pixels, img),
      cropResolution: `${crop.img.width}x${crop.img.height}`,
    },
    img: crop.img,
  };
}

function writeDiffCrop({ row, region, cropDir, device, reference }) {
  const base = baseEntry({ row, region, side: 'diff' });
  if (!device.img || !reference.img) {
    return {
      ...base,
      sourceImage: {
        device: device.entry.sourceImage || null,
        reference: reference.entry.sourceImage || null,
      },
      skipReason: 'diff requires both device and reference crops',
    };
  }
  const diff = diffThumbnail(reference.img, device.img);
  const filename = `${safeSegment(row.state)}--${safeSegment(region.name)}--diff.png`;
  const outPath = path.join(cropDir, filename);
  fs.writeFileSync(outPath, diff.png);
  return {
    ...base,
    sourceImage: {
      device: device.entry.sourceImage,
      reference: reference.entry.sourceImage,
    },
    path: path.posix.join('crops', filename),
    geometry: {
      coords: region.coords,
      normalized: region.box,
      sourceResolution: {
        device: device.entry.geometry.sourceResolution,
        reference: reference.entry.geometry.sourceResolution,
      },
    },
    cropResolution: '90x200',
    changedFraction: diff.changedFraction,
    meanDelta: diff.meanDelta,
  };
}

function baseEntry({ row, region, side }) {
  return {
    state: row.state,
    region: region.name,
    label: region.label,
    side,
  };
}

function geometry(region, pixels, img) {
  return {
    coords: region.coords,
    normalized: region.box,
    pixels,
    sourceResolution: `${img.width}x${img.height}`,
  };
}

function resolveCellSource({ manifest, cell, side }) {
  if (!cell?.source) return null;
  if (path.isAbsolute(cell.source)) return cell.source;
  if (side === 'reference') return path.join(manifest.gameDir, cell.source);
  return path.resolve(cell.source);
}

function safeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function pathLabel(file, repoRoot) {
  const rel = path.relative(repoRoot, file);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
  return file;
}
