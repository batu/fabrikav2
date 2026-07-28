import {
  createAssetCache,
  createManifestClient,
  isBucketInCohort,
  type AssetCache,
  type LevelAsset,
  type ManifestClient,
  type ManifestLevelEntry,
  type ManifestV1,
} from '../v1core/assets';

import { getCdnOrigin, isCdnExplicitlyDisabled } from '../config/cdn';
import { remoteConfigService } from '../config/RemoteConfigService';
import {
  DEFAULT_LEVEL_PACKAGE_CACHE_BUDGET_BYTES,
  type SequenceDiagnostic,
} from '../sequence/sequenceValidation';
import {
  RUNTIME_SEQUENCE_STORAGE_KEY,
  parseRuntimeCatalogManifest,
  parseStoredRuntimeSequence,
  resolveRuntimeSequence,
  serializeStoredRuntimeSequence,
  type RuntimeCatalogManifest,
  type RuntimeRemoteConfigValueSource,
  type RuntimeSequenceResolution,
  type StoredRuntimeSequence,
} from '../sequence/runtimeSequence';
import { hasLowDataConnection, runWhenVisibleAndIdle } from '../platform/browserScheduling';
import { cohortBucket } from './cohortContext';
import { manifestEntryFromCatalogLevel } from './catalogManifestEntry';
import { assertRuntimeLevelFile } from './levelFileRuntimeGuard';
import {
  buildPackageCatalogSnapshot,
  LAST_KNOWN_LIVE_LISTED_STORAGE_KEY,
  locallyAvailableLevelIds,
  planRollingPackageRetention,
  readLastKnownLiveListed,
  readRecentlyServedLevelIds,
  rememberServedLevelId,
  selectFallbackLevel,
  syncRollingPackageCache,
  writeLastKnownLiveListed,
  type FallbackReason,
  type LevelPackageDescriptor,
  type PackageAssetDescriptor,
  type PackageCatalogSnapshot,
} from './levelPackageCache';
import { isPlayableLevelAspect } from './playableAspect';
import type { AnalyticsSequenceSource } from '../analytics/AnalyticsEventContract';
import type {
  LevelFileV1,
  Dog as LevelFileDog,
  DogSprite as LevelFileDogSprite,
  Section as LevelFileSection,
} from './generated/levelFile';

/**
 * Runtime dog / sprite / section shapes. These are aliases of the generated
 * on-disk types (source of truth: pipeline/levelbuilder/api/level_schema.py),
 * so any schema change flows here automatically and a divergence breaks the
 * typecheck. Structurally identical to the on-disk shape; the only difference
 * is semantic — at runtime `sprite.image` is a resolved URL, not the on-disk
 * `levels/<id>/...` path.
 */
export type LevelDog = LevelFileDog;
export type LevelDogSprite = LevelFileDogSprite;
export type LevelSection = LevelFileSection;

/**
 * Level data as consumed by game scenes.
 *
 * `colorImage` is a runtime URL — for bundled levels in no-CDN mode it's a
 * same-origin relative path (`levels/<id>/color.png` or packaged `color.webp`); for CDN-fetched levels
 * or bundled-via-cache paths it's a Blob Object URL. The scene passes this
 * directly to Phaser's `this.load.image('color', url)`. Object URLs MUST be
 * revoked when the scene shuts down — callers use `disposeLevelUrls(id)`.
 *
 * **Security:** `name` originates in the manifest, which originates in our
 * own publish pipeline. No user-authored content today; audit
 * `level.name` template-literal interpolations if community-authored
 * levels ever land (current callsites: `shareWin.ts` canvas fillText —
 * safe; no innerHTML sites today).
 *
 * **Schema evolution:** landscape levels set `sections: [...]`; portrait
 * levels omit it. The `sections?.length > 0` check in `GameScene.setupLevel`
 * is the single runtime branch; no separate version field is needed.
 */
export interface LevelServingAttempt {
  intendedLevelId: string;
  servedLevelId: string;
  progressionIndex: number;
  runtimeLevelIds: readonly string[];
  displayLevelNumber: number;
  sequenceSource: AnalyticsSequenceSource;
  sequenceVersion: string | null;
  catalogRevision?: string;
  fallbackReason: FallbackReason | null;
}

/**
 * Level data as consumed by game scenes. Derived from the generated on-disk
 * type `LevelFileV1` minus the fields the runtime doesn't carry (`bwImage`,
 * `tags`), plus runtime-only additions.
 *
 * `colorImage` (and `sprite.image`, `bgImageUrls`) are runtime URLs — a
 * same-origin relative path in bundled no-CDN mode (`levels/<id>/color.png` or
 * packaged `color.webp`), a Blob Object URL for CDN-fetched / cached levels.
 * Object URLs MUST be revoked on scene shutdown — callers use
 * `disposeLevelUrls(id)`.
 *
 * **Security:** `name` originates in the manifest from our own publish
 * pipeline. No user-authored content today; audit `level.name`
 * template-literal interpolations if community-authored levels ever land.
 *
 * **Schema evolution:** landscape levels set `sections: [...]`; portrait levels
 * omit it. The `sections?.length > 0` check in `GameScene.setupLevel` is the
 * single runtime branch; no separate version field is needed.
 *
 * `bgImageUrls`: clean (pre-dog) background URLs — one per section (landscape)
 * or one total (portrait), from `assets.bgImages`. Restoration levels require
 * these assets; missing bg data is a broken restoration asset contract.
 */
export type LevelData = Omit<LevelFileV1, 'bwImage' | 'tags'> & {
  servingAttempt?: LevelServingAttempt;
  bgImageUrls?: string[];
};
// Note: `extension` (from LevelFileV1) is intentionally NOT consumed at runtime.
// It's pipeline-only bookkeeping for the vertical-extension bake; the shipped
// width/height already reflect the baked geometry, so no scene code needs the
// native/baked provenance. loadLevelFromEntry deliberately does not copy it onto
// LevelData. (The type still structurally allows it via LevelFileV1 — do not
// pattern-match the `sections` handling and start propagating it.)

export interface LevelIndexEntry {
  id: string;
  name: string;
  width: number;
  height: number;
  /**
   * Stable pointer to the level's source-of-truth. Undefined in no-CDN
   * bundled mode (the level is resolvable by id alone). In CDN mode it's
   * the content-hash used as the AssetCache key. Kept as an opaque
   * identifier; consumers should not parse it.
   */
  hash?: string;
}

export interface LevelSelectEntry extends LevelIndexEntry {
  thumbnailImage: string;
}

// --- Internal module state -------------------------------------------

let manifestClient: ManifestClient | null = null;
let assetCache: AssetCache | null = null;
const LEVEL_ASSET_CACHE_DB_NAME = 'ftd-level-assets-v2';
const LEGACY_ASSET_CACHE_DB_NAMES = ['ftd-assets', 'ftd-assets-blobs', 'ftd-assets-index'];
const ROLLING_CACHE_SYNC_DELAY_MS = 5_000;
const ROLLING_CACHE_IDLE_TIMEOUT_MS = 10_000;
const RUNTIME_ROLLING_CACHE_LOOKAHEAD_COUNT = 2;
let legacyAssetCacheCleanupStarted = false;
let cachedIndex: LevelIndexEntry[] | null = null;
let bundledManifestPromise: Promise<ManifestV1> | null = null;
let bundledManifestSnapshot: ManifestV1 | null = null;
let catalogManifestPromise: Promise<RuntimeCatalogManifest | null> | null = null;
const catalogSnapshotPromises = new Map<string, Promise<RuntimeCatalogManifest | null>>();
let lastCatalogManifestFetchFailed = false;
let lastRuntimeSequenceResolution: RuntimeSequenceResolution | null = null;
let lastPackageCatalogSnapshot: PackageCatalogSnapshot | null = null;
let lastPackageRetentionPlan: ReturnType<typeof planRollingPackageRetention> | null = null;
let lastLevelServingAttempt: LevelServingAttempt | null = null;
const levelCache = new Map<string, LevelData>();
const colorUrlByLevel = new Map<string, string>();
const bgUrlsByLevel = new Map<string, string[]>();
const spriteUrlsByLevel = new Map<string, string[]>();
const CATALOG_FETCH_TIMEOUT_MS = 5_000;
const CATALOG_FETCH_RETRY_BACKOFF_MS = 15_000;
let catalogManifestRetryAfterMs = 0;
const catalogSnapshotRetryAfterMsByRevision = new Map<string, number>();
let rollingCacheSyncGeneration = 0;

/**
 * Monotonic per-id load token. A concurrent loadLevel() for the same
 * id (e.g. rapid style toggles) bumps the token; the in-flight loader
 * checks its captured token before calling disposeLevelUrls so it
 * never revokes a URL that a more-recent load already handed to Phaser.
 */
const loadTokenByLevel = new Map<string, number>();

/**
 * Fetch the bundled manifest from the same-origin webroot. Cached for
 * the session. The manifest is generated by
 * `tools/publish-levels.mjs --bundled-only` and committed under
 * `public/levels/bundled-manifest.json` — Vite/APK serve it directly.
 */
async function getBundledManifest(): Promise<ManifestV1> {
  if (bundledManifestPromise !== null) return bundledManifestPromise;
  // Reset the promise cache on rejection so a transient fetch failure
  // doesn't poison every subsequent caller forever. Without this, a
  // black-screen on first launch becomes a permanent black-screen
  // until full app reload.
  const pending = (async (): Promise<ManifestV1> => {
    const response = await fetch('levels/bundled-manifest.json');
    if (!response.ok) {
      throw new Error(
        `bundled manifest fetch failed: ${response.status}. ` +
          `Re-run 'node tools/publish-levels.mjs --bundled-only'.`,
      );
    }
    const manifest = (await response.json()) as ManifestV1;
    bundledManifestSnapshot = manifest;
    return manifest;
  })();
  pending.catch((): void => {
    bundledManifestPromise = null;
    bundledManifestSnapshot = null;
  });
  bundledManifestPromise = pending;
  return pending;
}

function getBundledEntry(id: string): ManifestLevelEntry | null {
  return bundledManifestSnapshot?.levels.find((entry) => entry.id === id) ?? null;
}

function manifestWithBundledFallbackEntries(activeManifest: ManifestV1): ManifestV1 {
  if (bundledManifestSnapshot === null) return activeManifest;
  const activeIds = new Set(activeManifest.levels.map((entry) => entry.id));
  const levels: ManifestLevelEntry[] = [...activeManifest.levels];
  for (const bundledEntry of bundledManifestSnapshot.levels) {
    if (!activeIds.has(bundledEntry.id)) levels.push(bundledEntry);
  }
  return { ...activeManifest, levels };
}

async function fetchRuntimeCatalogJson(path: string): Promise<RuntimeCatalogManifest | null> {
  try {
    const result = await fetchWithTimeout(path, CATALOG_FETCH_TIMEOUT_MS, async (response) => {
      if (!response.ok) return { ok: false as const };
      return { ok: true as const, text: await response.text() };
    });
    if (!result.ok) {
      lastCatalogManifestFetchFailed = true;
      return null;
    }
    const rawCatalog = result.text;
    if (rawCatalog.trimStart().startsWith('<')) {
      lastCatalogManifestFetchFailed = true;
      return null;
    }
    const parsed = parseRuntimeCatalogManifest(JSON.parse(rawCatalog));
    if (parsed === null) lastCatalogManifestFetchFailed = true;
    return parsed;
  } catch (err) {
    lastCatalogManifestFetchFailed = true;
    console.warn('[levels] catalog manifest unavailable; preserving cached sequence/fallback state', err);
    return null;
  }
}

async function getCatalogManifest(): Promise<RuntimeCatalogManifest | null> {
  if (catalogManifestPromise !== null) {
    if (catalogManifestRetryAfterMs === 0 || Date.now() < catalogManifestRetryAfterMs) {
      return catalogManifestPromise;
    }
    catalogManifestPromise = null;
  }
  lastCatalogManifestFetchFailed = false;
  const pending = fetchRuntimeCatalogJson('levels/catalog-manifest.json');
  pending.then((catalog): void => {
    catalogManifestRetryAfterMs = catalog === null ? Date.now() + CATALOG_FETCH_RETRY_BACKOFF_MS : 0;
  }).catch((): void => {
    catalogManifestRetryAfterMs = Date.now() + CATALOG_FETCH_RETRY_BACKOFF_MS;
    catalogManifestPromise = null;
  });
  catalogManifestPromise = pending;
  return pending;
}

async function getCatalogSnapshot(catalogRevision: string): Promise<RuntimeCatalogManifest | null> {
  const existing = catalogSnapshotPromises.get(catalogRevision);
  const retryAfterMs = catalogSnapshotRetryAfterMsByRevision.get(catalogRevision) ?? 0;
  if (existing !== undefined) {
    if (retryAfterMs === 0 || Date.now() < retryAfterMs) return existing;
    catalogSnapshotPromises.delete(catalogRevision);
  }
  const pending = fetchRuntimeCatalogJson(`levels/catalog-snapshots/${encodeURIComponent(catalogRevision)}.json`);
  pending.then((catalog): void => {
    if (catalog === null) catalogSnapshotRetryAfterMsByRevision.set(
      catalogRevision,
      Date.now() + CATALOG_FETCH_RETRY_BACKOFF_MS,
    );
    else catalogSnapshotRetryAfterMsByRevision.delete(catalogRevision);
  }).catch((): void => {
    catalogSnapshotRetryAfterMsByRevision.set(catalogRevision, Date.now() + CATALOG_FETCH_RETRY_BACKOFF_MS);
    catalogSnapshotPromises.delete(catalogRevision);
  });
  catalogSnapshotPromises.set(catalogRevision, pending);
  return pending;
}

function remotePayloadCatalogRevision(rawPayload: string): string | null {
  if (rawPayload.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(rawPayload) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const catalogRevision = (parsed as { catalogRevision?: unknown }).catalogRevision;
    return typeof catalogRevision === 'string' && catalogRevision.trim().length > 0 ? catalogRevision : null;
  } catch {
    return null;
  }
}

function isExplicitRemoteSequenceDisable(
  remoteConfigSnapshot: ReturnType<typeof remoteConfigService.snapshot>,
): boolean {
  return remoteConfigSnapshot.sources.levelSequencePayload === 'remote'
    && remoteConfigSnapshot.active.levelSequencePayload.trim().length === 0;
}

function catalogManifestWithRetentionOverlay(
  catalogManifest: RuntimeCatalogManifest | null,
  retentionSource: RuntimeCatalogManifest | null,
): RuntimeCatalogManifest | null {
  if (catalogManifest === null || retentionSource === null) return catalogManifest;
  const retentionByLevelId = new Map(
    retentionSource.levels
      .filter((level) => level.retention !== undefined)
      .map((level) => [level.id, level.retention]),
  );
  if (retentionByLevelId.size === 0) return catalogManifest;
  return {
    ...catalogManifest,
    levels: catalogManifest.levels.map((level) => ({
      ...level,
      ...(retentionByLevelId.has(level.id) ? { retention: retentionByLevelId.get(level.id) } : {}),
    })),
  };
}

async function catalogManifestForSequenceRevision(
  currentCatalogManifest: RuntimeCatalogManifest | null,
  catalogRevision: string | null,
): Promise<RuntimeCatalogManifest | null> {
  if (catalogRevision === null) return currentCatalogManifest;
  if (catalogRevision.startsWith('manifest-')) return null;
  if (currentCatalogManifest?.catalogRevision === catalogRevision) return currentCatalogManifest;
  const snapshot = await getCatalogSnapshot(catalogRevision);
  return catalogManifestWithRetentionOverlay(snapshot, currentCatalogManifest);
}

function sequenceNeedsRemotePackages(
  levelIds: readonly string[],
  manifest: ManifestV1,
  catalogManifest: RuntimeCatalogManifest | null,
): boolean {
  const bundledManifestIds = new Set(
    manifest.levels
      .filter((level) => level.bundled && isPlayableLevelAspect(level.width, level.height))
      .map((level) => level.id),
  );
  const catalogLevelsById = new Map((catalogManifest?.levels ?? []).map((level) => [level.id, level]));
  return levelIds.some((levelId) => {
    if (bundledManifestIds.has(levelId)) return false;
    return catalogLevelsById.get(levelId)?.bundledInApp !== true;
  });
}

async function resolveBundledOnlyRuntimeSequence(manifest: ManifestV1): Promise<RuntimeSequenceResolution> {
  return await resolveRuntimeSequence({
    manifest,
    catalogManifest: null,
    remoteValues: { levelSequencePayload: '', levelSequenceSha256: '' },
    storedSequence: null,
  });
}

/**
 * Playable aspect ratios: portrait (h > w) OR wide-landscape (w/h >= 1.5).
 * Excludes square / near-square (e.g. legacy 1024×1024 debug levels) while
 * still admitting 16:9 (1.78:1) and wider landscapes like the 3-panel maps.
 */
function getManifestClient(): ManifestClient {
  if (manifestClient === null) manifestClient = createManifestClient();
  return manifestClient;
}

function getAssetCache(): AssetCache {
  void cleanupLegacyAssetCacheDatabases();
  if (assetCache === null) {
    assetCache = createAssetCache({
      dbName: LEVEL_ASSET_CACHE_DB_NAME,
      maxBytes: DEFAULT_LEVEL_PACKAGE_CACHE_BUDGET_BYTES,
    });
  }
  return assetCache;
}

function readStoredRuntimeSequence(): StoredRuntimeSequence | null {
  if (typeof window === 'undefined') return null;
  try {
    return parseStoredRuntimeSequence(window.localStorage.getItem(RUNTIME_SEQUENCE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeStoredRuntimeSequence(storedSequence: StoredRuntimeSequence | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (storedSequence === null) window.localStorage.removeItem(RUNTIME_SEQUENCE_STORAGE_KEY);
    else window.localStorage.setItem(RUNTIME_SEQUENCE_STORAGE_KEY, serializeStoredRuntimeSequence(storedSequence));
  } catch {
    // localStorage unavailable — current session can still use the resolved order.
  }
}

function catalogSnapshotUnavailableDiagnostic(catalogRevision: string): SequenceDiagnostic {
  return {
    code: 'catalogSnapshotUnavailable',
    severity: 'error',
    blocking: true,
    message: `Catalog snapshot ${catalogRevision} is not available.`,
  };
}

async function resolveActiveRuntimeSequence(manifest: ManifestV1): Promise<RuntimeSequenceResolution> {
  const remoteConfigSnapshot = remoteConfigService.snapshot();
  const storedSequence = readStoredRuntimeSequence();
  const remoteValueSources = {
    levelSequencePayload: remoteConfigSnapshot.sources.levelSequencePayload as RuntimeRemoteConfigValueSource,
    levelSequenceSha256: remoteConfigSnapshot.sources.levelSequenceSha256 as RuntimeRemoteConfigValueSource,
  };

  if (isExplicitRemoteSequenceDisable(remoteConfigSnapshot)) {
    const resolution = await resolveRuntimeSequence({
      manifest,
      catalogManifest: null,
      remoteValues: remoteConfigSnapshot.active,
      remoteValueSources,
      storedSequence,
    });
    lastRuntimeSequenceResolution = resolution;
    writeStoredRuntimeSequence(null);
    return resolution;
  }

  if (isCdnExplicitlyDisabled()) {
    const resolution = await resolveBundledOnlyRuntimeSequence(manifest);
    lastRuntimeSequenceResolution = resolution;
    writeStoredRuntimeSequence(null);
    return resolution;
  }

  const currentCatalogManifest = await getCatalogManifest();
  const requestedCatalogRevision = remotePayloadCatalogRevision(remoteConfigSnapshot.active.levelSequencePayload)
    ?? storedSequence?.catalogRevision
    ?? null;
  const catalogManifest = await catalogManifestForSequenceRevision(currentCatalogManifest, requestedCatalogRevision);

  if (lastCatalogManifestFetchFailed && storedSequence !== null) {
    const cachedResolution: RuntimeSequenceResolution = {
      source: 'cached',
      levelIds: storedSequence.levelIds,
      sequenceVersion: storedSequence.sequenceVersion,
      catalogRevision: storedSequence.catalogRevision,
      diagnostics: requestedCatalogRevision === null
        ? []
        : [catalogSnapshotUnavailableDiagnostic(requestedCatalogRevision)],
      nextStoredSequence: storedSequence,
    };
    lastRuntimeSequenceResolution = cachedResolution;
    return cachedResolution;
  }
  const resolution = await resolveRuntimeSequence({
    manifest,
    catalogManifest,
    remoteValues: remoteConfigSnapshot.active,
    remoteValueSources,
    storedSequence,
  });

  if (getCdnOrigin() === null && sequenceNeedsRemotePackages(resolution.levelIds, manifest, catalogManifest)) {
    const bundledOnlyResolution = await resolveBundledOnlyRuntimeSequence(manifest);
    lastRuntimeSequenceResolution = bundledOnlyResolution;
    writeStoredRuntimeSequence(null);
    return bundledOnlyResolution;
  }

  lastRuntimeSequenceResolution = resolution;
  if (!lastCatalogManifestFetchFailed || resolution.nextStoredSequence !== null) {
    writeStoredRuntimeSequence(resolution.nextStoredSequence);
  }
  return resolution;
}

/**
 * Initialize the manifest once per session. Called lazily by
 * `getLevelIndex()`. ManifestClient is session-locked — the second
 * call is a no-op.
 *
 * In no-CDN mode (getCdnOrigin returns null), pass null as the URL;
 * ManifestClient skips the network entirely and uses the bundled
 * fallback as the live manifest.
 */
async function ensureManifestInitialized(): Promise<void> {
  const origin = getCdnOrigin();
  const client = getManifestClient();
  const bundled = await getBundledManifest();
  const cdnUrl = origin === null ? null : `${origin.replace(/\/$/, '')}/manifest.json`;
  await client.initialize(cdnUrl, bundled);
}

async function getRuntimeEntry(id: string): Promise<ManifestLevelEntry | null> {
  const manifestEntry = getManifestClient().getManifest().levels.find((entry) => entry.id === id) ?? null;
  if (manifestEntry !== null) return manifestEntry;
  const bundledEntry = getBundledEntry(id);
  if (bundledEntry !== null) return bundledEntry;
  const catalogManifest = await getCatalogManifest();
  const catalogLevel = catalogManifest?.levels.find((level) => level.id === id) ?? null;
  return catalogLevel === null ? null : manifestEntryFromCatalogLevel(catalogLevel);
}

/** Resolve a content-addressed URL to either CDN origin or bundled same-origin. */
function resolveAssetUrl(entryPath: string, useCdnForRelativePath: boolean = false): string {
  const origin = getCdnOrigin();
  if (origin === null || (!useCdnForRelativePath && !entryPath.startsWith('/assets/'))) {
    // Bundled/same-origin mode: paths like `levels/<id>/color.png`
    // are served by the APK/Vite webroot even when a CDN origin is
    // configured for non-bundled `/assets/<hash>` entries.
    return entryPath.replace(/^\/+/, '');
  }
  // CDN mode: content-addressed paths start with '/assets/<hash>.<ext>'.
  const normalizedPath = entryPath.startsWith('/') ? entryPath : `/${entryPath}`;
  return `${origin.replace(/\/$/, '')}${normalizedPath}`;
}

function mimeForAssetPath(path: string): string {
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

function extensionForAssetPath(path: string): string {
  const match = path.match(/\.(json|png|webp)$/);
  return match ? `.${match[1]}` : '';
}

function cdnAssetPath(path: string, hash: string): string {
  if (path.startsWith('/assets/')) return path;
  if (path.includes('/dogs/')) return path.startsWith('/') ? path : `/${path}`;
  const extension = extensionForAssetPath(path);
  return `/assets/${hash}${extension}`;
}

function shouldUseBundledAssetPath(path: string, bundled: boolean): boolean {
  return bundled && !path.startsWith('/assets/');
}

const ASSET_FETCH_TIMEOUT_MS = 30_000;
const PREFETCH_ASSET_FETCH_TIMEOUT_MS = 8_000;
const OPTIONAL_SPRITE_FETCH_TIMEOUT_MS = 3_000;

async function fetchWithTimeout<T>(
  url: string,
  timeoutMs: number,
  readResponse: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout((): void => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return await readResponse(response);
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function verifyBlobHash(blob: Blob, expectedHash: string): Promise<void> {
  const actualHash = await sha256Hex(blob);
  if (actualHash !== expectedHash) {
    throw new Error(`Content hash mismatch: expected ${expectedHash}, got ${actualHash}`);
  }
}

function isBrokenAssetCacheError(error: unknown): boolean {
  const name = error instanceof DOMException ? error.name : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return name === 'NotFoundError' || message.includes('object stores was not found');
}

function canBypassCacheWriteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return !message.includes('Content hash mismatch') && !message.includes('Asset cache was cleared');
}

function deleteIndexedDbDatabase(name: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = (): void => resolve();
    request.onerror = (): void => reject(request.error ?? new Error(`Failed to delete IndexedDB database ${name}`));
    request.onblocked = (): void => resolve();
  });
}

async function cleanupLegacyAssetCacheDatabases(): Promise<void> {
  if (legacyAssetCacheCleanupStarted) return;
  legacyAssetCacheCleanupStarted = true;
  await Promise.allSettled(LEGACY_ASSET_CACHE_DB_NAMES.map((name) => deleteIndexedDbDatabase(name)));
}

/** Fetch a blob via the cache when CDN is live; direct fetch in bundled mode. */
async function fetchAssetBlob(
  hash: string,
  path: string,
  mime: string,
  bundled: boolean = false,
  timeoutMs: number = ASSET_FETCH_TIMEOUT_MS,
): Promise<Blob> {
  const origin = getCdnOrigin();
  if (origin === null || shouldUseBundledAssetPath(path, bundled)) {
    // Bundled / same-origin path: cache is pointless — the blob is
    // already served by the APK's webroot. Fetch, blob, return.
    const url = resolveAssetUrl(path);
    return await fetchWithTimeout(url, timeoutMs, async (response) => {
      if (!response.ok) throw new Error(`bundled asset fetch failed: ${url} (${response.status})`);
      return await response.blob();
    });
  }
  // CDN mode: cache by content-hash with sha256 verification.
  await cleanupLegacyAssetCacheDatabases();
  const url = resolveAssetUrl(cdnAssetPath(path, hash), true);
  let fetchedBlob: Blob | null = null;
  const fetchDirect = async (): Promise<Blob> => {
    fetchedBlob = await fetchWithTimeout(url, timeoutMs, async (response) => {
      if (!response.ok) {
        throw new Error(`CDN asset fetch failed: ${url} (${response.status})`);
      }
      return await response.blob();
    });
    return fetchedBlob;
  };
  try {
    return await getAssetCache().getOrFetch(hash, mime, fetchDirect);
  } catch (error) {
    if (!isBrokenAssetCacheError(error) && (fetchedBlob === null || !canBypassCacheWriteError(error))) throw error;
    console.warn('[levels] asset cache unavailable; fetching directly:', (error as Error).message);
    const blob = fetchedBlob ?? await fetchDirect();
    await verifyBlobHash(blob, hash);
    return blob;
  }
}

async function fetchPackageAssetForCache(asset: PackageAssetDescriptor): Promise<Blob> {
  const bundledLocal = shouldUseBundledAssetPath(asset.path, asset.bundled);
  const path = bundledLocal ? asset.path : cdnAssetPath(asset.path, asset.hash);
  return await fetchWithTimeout(resolveAssetUrl(path, !bundledLocal), PREFETCH_ASSET_FETCH_TIMEOUT_MS, async (response) => {
    if (!response.ok) throw new Error(`package asset fetch failed: ${asset.path} (${response.status})`);
    return await response.blob();
  });
}

async function locallyAvailableLevelIdsSafe(
  packagesByLevelId: ReadonlyMap<string, LevelPackageDescriptor>,
): Promise<ReadonlySet<string>> {
  try {
    await cleanupLegacyAssetCacheDatabases();
    return await locallyAvailableLevelIds(packagesByLevelId, getAssetCache());
  } catch (error) {
    if (!isBrokenAssetCacheError(error)) throw error;
    console.warn('[levels] asset cache availability unavailable; using bundled-only fallback:', (error as Error).message);
    const available = new Set<string>();
    for (const descriptor of packagesByLevelId.values()) {
      if (descriptor.listable && descriptor.complete && descriptor.bundled) available.add(descriptor.levelId);
    }
    return available;
  }
}

async function getActivePackageCatalog(manifest: ManifestV1): Promise<PackageCatalogSnapshot> {
  const currentCatalogManifest = await getCatalogManifest();
  const activeCatalogRevision = lastRuntimeSequenceResolution?.source === 'remote' || lastRuntimeSequenceResolution?.source === 'cached'
    ? lastRuntimeSequenceResolution.catalogRevision
    : null;
  const catalogManifest = await catalogManifestForSequenceRevision(currentCatalogManifest, activeCatalogRevision);
  const catalog = buildPackageCatalogSnapshot(manifest, catalogManifest);
  lastPackageCatalogSnapshot = catalog;
  return catalog;
}

function writeLiveListedIfFresh(resolution: RuntimeSequenceResolution): void {
  if (typeof window === 'undefined') return;
  if (resolution.source !== 'remote' && resolution.explicitRemoteDisable !== true) return;
  try {
    writeLastKnownLiveListed({
      catalogRevision: resolution.catalogRevision,
      sequenceVersion: resolution.sequenceVersion,
      levelIds: [...resolution.levelIds],
      updatedAtMs: Date.now(),
    });
  } catch {
    // localStorage unavailable: fallback can still use active in-memory sequence.
  }
}

function lastKnownLiveListedLevelIds(): ReadonlySet<string> {
  if (typeof window === 'undefined') return new Set<string>();
  const stored = readLastKnownLiveListed(window.localStorage);
  return new Set(stored?.levelIds ?? []);
}

async function startRollingCacheSync(
  sequenceLevelIds: readonly string[],
  progressionIndex: number,
  catalog: PackageCatalogSnapshot,
): Promise<void> {
  if (getCdnOrigin() === null) return;
  await cleanupLegacyAssetCacheDatabases();
  const result = await syncRollingPackageCache({
    sequenceLevelIds,
    progressionIndex,
    catalog,
    cache: getAssetCache(),
    fetchAsset: fetchPackageAssetForCache,
    lookaheadCount: RUNTIME_ROLLING_CACHE_LOOKAHEAD_COUNT,
  });
  lastPackageRetentionPlan = result.retentionPlan;
}

function scheduleRollingCacheSync(
  sequenceLevelIds: readonly string[],
  progressionIndex: number,
  catalog: PackageCatalogSnapshot,
): void {
  if (getCdnOrigin() === null || hasLowDataConnection()) return;
  const generation = rollingCacheSyncGeneration + 1;
  rollingCacheSyncGeneration = generation;
  runWhenVisibleAndIdle((): void => {
    if (generation !== rollingCacheSyncGeneration || getCdnOrigin() === null || hasLowDataConnection()) return;
    void startRollingCacheSync(sequenceLevelIds, progressionIndex, catalog).catch((err) => {
      console.warn('[levels] rolling package cache sync failed:', err);
    });
  }, {
    delayMs: ROLLING_CACHE_SYNC_DELAY_MS,
    idleTimeoutMs: ROLLING_CACHE_IDLE_TIMEOUT_MS,
    shouldRun: () => generation === rollingCacheSyncGeneration && getCdnOrigin() !== null && !hasLowDataConnection(),
  });
}

function setServingAttempt(levelData: LevelData, attempt: LevelServingAttempt): LevelData {
  const servedLevelData: LevelData = { ...levelData, servingAttempt: attempt };
  lastLevelServingAttempt = attempt;
  rememberServedLevelId(attempt.servedLevelId);
  return servedLevelData;
}

export function withDirectSelectServingAttempt(levelData: LevelData, progressionIndex: number, runtimeLevelIds: readonly string[]): LevelData {
  return setServingAttempt(levelData, {
    intendedLevelId: levelData.id,
    servedLevelId: levelData.id,
    progressionIndex,
    runtimeLevelIds: [...runtimeLevelIds],
    displayLevelNumber: progressionIndex + 1,
    sequenceSource: 'direct_select',
    sequenceVersion: null,
    fallbackReason: null,
  });
}

function buildServingAttempt(
  progressionIndex: number,
  runtimeLevelIds: readonly string[],
  runtimeSequence: RuntimeSequenceResolution | null,
  catalogRevision: string,
  intendedLevelId: string,
  servedLevelId: string,
  fallbackReason: FallbackReason | null,
): LevelServingAttempt {
  return {
    intendedLevelId,
    servedLevelId,
    progressionIndex,
    runtimeLevelIds: [...runtimeLevelIds],
    displayLevelNumber: progressionIndex + 1,
    sequenceSource: runtimeSequence?.source ?? 'unknown',
    sequenceVersion: runtimeSequence?.sequenceVersion ?? null,
    catalogRevision: runtimeSequence?.catalogRevision ?? catalogRevision,
    fallbackReason,
  };
}

// --- Public API ------------------------------------------------------

/**
 * Load + filter the level index for the current user's cohort.
 *
 * Only memoizes the result when the cohort bucket has resolved. If
 * called during the boot race (cohort still initializing), the
 * bundled-only list is returned but NOT cached — so a subsequent call
 * after cohort resolves gets the full cohort-aware index. Without this
 * guard, the first eager call in GameScene.create would poison
 * `cachedIndex` and lock the user to 3 bundled levels for the session.
 */
export async function getLevelIndex(): Promise<LevelIndexEntry[]> {
  if (cachedIndex !== null) return cachedIndex;
  await ensureManifestInitialized();

  const manifest = manifestWithBundledFallbackEntries(getManifestClient().getManifest());
  const runtimeSequence = await resolveActiveRuntimeSequence(manifest);
  writeLiveListedIfFresh(runtimeSequence);
  const catalog = await getActivePackageCatalog(manifest);
  const bucket = cohortBucket();
  const manifestLevelsById = new Map(manifest.levels.map((entry) => [entry.id, entry]));
  const catalogManifest = await catalogManifestForSequenceRevision(await getCatalogManifest(), catalog.catalogRevision);
  const catalogLevelsById = new Map((catalogManifest?.levels ?? []).map((level) => [level.id, level]));

  const entries: LevelIndexEntry[] = [];
  for (const levelId of runtimeSequence.levelIds) {
    const entry = manifestLevelsById.get(levelId);
    const catalogLevel = catalogLevelsById.get(levelId);
    const runtimeEntry = entry ?? (catalogLevel === undefined ? null : manifestEntryFromCatalogLevel(catalogLevel));
    if (runtimeEntry === null || runtimeEntry === undefined) continue;
    if (!isPlayableLevelAspect(runtimeEntry.width, runtimeEntry.height)) continue;
    // Cohort filter: bundled levels always pass (they're universally
    // cohorted). If cohort hasn't resolved yet (boot race), fall back
    // to showing only bundled levels so the user has something playable
    // — but do NOT cache this result so the next call gets the full
    // cohort-filtered index once cohort resolution completes.
    if (bucket === null) {
      if (!runtimeEntry.bundled) continue;
    } else if (!isBucketInCohort(bucket, runtimeEntry.cohort_buckets)) {
      continue;
    }
    entries.push({
      id: runtimeEntry.id,
      name: runtimeEntry.name,
      width: runtimeEntry.width,
      height: runtimeEntry.height,
      hash: runtimeEntry.assets.levelJson.hash,
    });
  }

  if (bucket !== null) cachedIndex = entries;
  return entries;
}

export async function getLevelSelectEntries(): Promise<LevelSelectEntry[]> {
  const index = await getLevelIndex();
  return await Promise.all(index.map(async (level): Promise<LevelSelectEntry> => {
    const entry = await getRuntimeEntry(level.id);
    const thumbnailAsset = entry?.assets.thumbnailImage ?? entry?.assets.colorImage ?? null;
    const thumbnailImage = thumbnailAsset === null
      ? `levels/${level.id}/color.png`
      : resolveAssetUrl(
        shouldUseBundledAssetPath(thumbnailAsset.path, entry?.bundled ?? false)
          ? thumbnailAsset.path
          : cdnAssetPath(thumbnailAsset.path, thumbnailAsset.hash),
        !shouldUseBundledAssetPath(thumbnailAsset.path, entry?.bundled ?? false),
      );
    return {
      ...level,
      thumbnailImage,
    };
  }));
}

/**
 * Load a single level's full data. Returns a cached instance if
 * previously loaded; `colorImage` is an Object URL for cache-served
 * blobs (CDN mode) or a same-origin relative path (bundled mode).
 * Call `disposeLevelUrls(id)` to revoke Object URLs on scene shutdown.
 */
export async function loadLevel(id: string): Promise<LevelData> {
  await ensureManifestInitialized();
  const entry = await getRuntimeEntry(id);
  if (entry === null) throw new Error(`Level not found in runtime manifest/catalog: ${id}`);
  return await loadLevelFromEntry(id, entry, true);
}

async function loadLevelFromEntry(id: string, entry: ManifestLevelEntry, useCache: boolean): Promise<LevelData> {
  const myToken = (loadTokenByLevel.get(id) ?? 0) + 1;
  loadTokenByLevel.set(id, myToken);

  const cached = useCache ? levelCache.get(id) : undefined;
  if (cached !== undefined) return cached;

  // Fetch level.json — parsed as JSON, doesn't need an Object URL.
  const jsonBlob = await fetchAssetBlob(
    entry.assets.levelJson.hash,
    entry.assets.levelJson.path,
    'application/json',
    entry.bundled,
  );
  const rawJson = await jsonBlob.text();
  const parsedJson: unknown = JSON.parse(rawJson);
  assertRuntimeLevelFile(parsedJson, { levelId: id });

  // Single colorImage per level \u2014 no style variants.
  const styleAsset = entry.assets.colorImage;

  // Fetch the dog-painted color image — return as Blob Object URL so Phaser's loader
  // consumes a same-origin URL (no canvas taint from CDN CORS).
  const origin = getCdnOrigin();
  const levelUsesRemoteAssets = origin !== null && (
    !shouldUseBundledAssetPath(entry.assets.levelJson.path, entry.bundled)
    || !shouldUseBundledAssetPath(styleAsset.path, entry.bundled)
  );
  let colorImageUrl: string;
  if (origin === null || shouldUseBundledAssetPath(styleAsset.path, entry.bundled)) {
    // Bundled mode: pass through the same-origin relative path.
    // Phaser resolves against document origin; no Object URL needed,
    // no revocation concern.
    colorImageUrl = styleAsset.path;
  } else {
    const colorBlob = await fetchAssetBlob(
      styleAsset.hash,
      styleAsset.path,
      mimeForAssetPath(styleAsset.path),
      entry.bundled,
    );
    colorImageUrl = URL.createObjectURL(colorBlob);
    // If a previous Object URL for this id is still held (rapid
    // re-load of same level after scene.restart), revoke it on the
    // next microtask. Synchronous revoke here could invalidate the
    // still-active Phaser texture mid-teardown; deferring to a
    // microtask lets the restart cycle complete first.
    const previous = colorUrlByLevel.get(id);
    if (previous !== undefined) {
      queueMicrotask((): void => {
        URL.revokeObjectURL(previous);
      });
    }
    colorUrlByLevel.set(id, colorImageUrl);
  }

  // bgImages: resolve URLs the same way (bundled → same-origin path,
  // CDN → Object URL from cached blob). Restoration uses these as the clean
  // layer behind the color image, so a listed bg asset is load-bearing.
  let bgImageUrls: string[] | undefined;
  if (entry.assets.bgImages && entry.assets.bgImages.length > 0) {
    const urls: string[] = [];
    const allBgImagesUseBundledPaths = entry.assets.bgImages.every((bg) => (
      shouldUseBundledAssetPath(bg.path, entry.bundled)
    ));
    if (origin === null || allBgImagesUseBundledPaths) {
      for (const bg of entry.assets.bgImages) urls.push(bg.path);
      bgImageUrls = urls;
    } else {
      try {
        for (const bg of entry.assets.bgImages) {
          const blob = await fetchAssetBlob(bg.hash, bg.path, mimeForAssetPath(bg.path), entry.bundled);
          urls.push(URL.createObjectURL(blob));
        }
        const previous = bgUrlsByLevel.get(id);
        if (previous !== undefined) {
          queueMicrotask((): void => {
            for (const url of previous) URL.revokeObjectURL(url);
          });
        }
        bgUrlsByLevel.set(id, urls);
        bgImageUrls = urls;
      } catch (err) {
        for (const url of urls) URL.revokeObjectURL(url);
        disposeLevelUrls(id);
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`[levels] bg fetch failed for '${id}': ${message}`);
      }
    }
  }
  if (bgImageUrls === undefined || bgImageUrls.length === 0) {
    disposeLevelUrls(id);
    throw new Error(`[levels] restoration bg assets missing for '${id}'`);
  }
  if (
    Array.isArray(parsedJson.sections)
    && parsedJson.sections.length > 0
    && bgImageUrls.length !== 1
    && bgImageUrls.length !== parsedJson.sections.length
  ) {
    disposeLevelUrls(id);
    throw new Error(
      `[levels] restoration bg asset count mismatch for '${id}': ` +
        `${bgImageUrls.length} bg images for ${parsedJson.sections.length} sections`,
    );
  }

  const dogSpritesByPath = new Map<string, LevelAsset>();
  for (const spriteAsset of entry.assets.dogSprites ?? []) {
    dogSpritesByPath.set(spriteAsset.path, spriteAsset);
  }
  const spriteObjectUrls: string[] = [];
  const dogResults = await Promise.allSettled(parsedJson.dogs.map(async (dog): Promise<LevelDog> => {
    const sourceSprite = dog.sprite;
    if (sourceSprite === undefined) {
      throw new Error(`[levels] dog '${id}/${dog.id}' is missing sprite metadata`);
    }
    if (sourceSprite.cleanup === undefined) {
      throw new Error(`[levels] dog '${id}/${dog.id}' is missing sprite cleanup metadata`);
    }

    let spriteUrl: string | null = null;
    if (
      origin === null
      || (shouldUseBundledAssetPath(sourceSprite.image, entry.bundled) && !levelUsesRemoteAssets)
    ) {
      spriteUrl = sourceSprite.image;
    } else {
      const spriteAsset = dogSpritesByPath.get(sourceSprite.image);
      if (spriteAsset === undefined) {
        throw new Error(`[levels] sprite asset missing from manifest for '${id}/${dog.id}': ${sourceSprite.image}`);
      }

      try {
        const blob = await fetchAssetBlob(
          spriteAsset.hash,
          spriteAsset.path,
          'image/png',
          entry.bundled,
          OPTIONAL_SPRITE_FETCH_TIMEOUT_MS,
        );
        spriteUrl = URL.createObjectURL(blob);
        spriteObjectUrls.push(spriteUrl);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`[levels] sprite fetch failed for '${id}/${dog.id}': ${message}`);
      }
    }

    return {
      id: dog.id,
      x: dog.x,
      y: dog.y,
      r: dog.r,
      ...(spriteUrl !== null
        ? {
            sprite: {
              ...sourceSprite,
              image: spriteUrl,
        },
      }
      : {}),
    };
  }));
  const failedDog = dogResults.find((result) => result.status === 'rejected');
  if (failedDog !== undefined) {
    for (const url of spriteObjectUrls) URL.revokeObjectURL(url);
    disposeLevelUrls(id);
    throw failedDog.reason instanceof Error
      ? failedDog.reason
      : new Error(String(failedDog.reason));
  }
  const dogs: LevelDog[] = dogResults.map((result) => {
    if (result.status === 'rejected') {
      throw result.reason instanceof Error ? result.reason : new Error(String(result.reason));
    }
    return result.value;
  });
  const previousSpriteUrls = spriteUrlsByLevel.get(id);
  if (previousSpriteUrls !== undefined) {
    spriteUrlsByLevel.delete(id);
    queueMicrotask((): void => {
      for (const url of previousSpriteUrls) URL.revokeObjectURL(url);
    });
  }
  if (spriteObjectUrls.length > 0) {
    spriteUrlsByLevel.set(id, spriteObjectUrls);
  }

  const data: LevelData = {
    id: parsedJson.id,
    name: parsedJson.name,
    width: parsedJson.width,
    height: parsedJson.height,
    colorImage: colorImageUrl,
    dogs,
    ...(parsedJson.sections !== undefined ? { sections: parsedJson.sections } : {}),
    ...(bgImageUrls !== undefined ? { bgImageUrls } : {}),
  };

  if (useCache) levelCache.set(id, data);
  return data;
}

async function loadBundledFallbackForSameLevel(id: string): Promise<LevelData | null> {
  const bundledEntry = getBundledEntry(id);
  if (bundledEntry === null) return null;
  disposeLevelUrls(id);
  return await loadLevelFromEntry(id, bundledEntry, true);
}

export async function loadLevelForProgression(progressionIndex: number): Promise<LevelData> {
  const index = await getLevelIndex();
  if (index.length === 0) throw new Error('No playable levels available');
  const safeIndex = ((progressionIndex % index.length) + index.length) % index.length;
  const intendedLevelId = index[safeIndex]?.id;
  if (intendedLevelId === undefined) throw new Error('No intended level resolved');

  const manifest = manifestWithBundledFallbackEntries(getManifestClient().getManifest());
  const catalog = lastPackageCatalogSnapshot ?? await getActivePackageCatalog(manifest);
  const sequenceLevelIds = index.map((entry) => entry.id);
  const runtimeSequence = lastRuntimeSequenceResolution;
  const exactPackage = catalog.packagesByLevelId.get(intendedLevelId);
  const exactPackageIsLoadable = exactPackage !== undefined && exactPackage.listable && exactPackage.complete;

  try {
    if (!exactPackageIsLoadable) {
      throw new Error(`Exact level ${intendedLevelId} has no complete listable package metadata`);
    }
    const exact = await loadLevel(intendedLevelId);
    const attempt = buildServingAttempt(progressionIndex, sequenceLevelIds, runtimeSequence, catalog.catalogRevision, intendedLevelId, intendedLevelId, null);
    scheduleRollingCacheSync(sequenceLevelIds, progressionIndex, catalog);
    return setServingAttempt(exact, attempt);
  } catch (exactError) {
    if (exactPackageIsLoadable && getManifestClient().getManifest().levels.some((entry) => entry.id === intendedLevelId)) {
      const sameIdBundledFallback = await loadBundledFallbackForSameLevel(intendedLevelId).catch((fallbackError: unknown): LevelData | null => {
        console.warn('[levels] same-id bundled fallback failed:', fallbackError);
        return null;
      });
      if (sameIdBundledFallback !== null) {
        const attempt = buildServingAttempt(progressionIndex, sequenceLevelIds, runtimeSequence, catalog.catalogRevision, intendedLevelId, intendedLevelId, 'exact-load-failed');
        scheduleRollingCacheSync(sequenceLevelIds, progressionIndex, catalog);
        return setServingAttempt(sameIdBundledFallback, attempt);
      }
    }

    const available = await locallyAvailableLevelIdsSafe(catalog.packagesByLevelId);
    const recent = typeof window === 'undefined' ? [] : readRecentlyServedLevelIds(window.localStorage);
    const fallback = selectFallbackLevel({
      intendedLevelId,
      activeLevelIds: sequenceLevelIds,
      packagesByLevelId: catalog.packagesByLevelId,
      availableLevelIds: available,
      lastKnownLiveListedLevelIds: lastKnownLiveListedLevelIds(),
      recentlyServedLevelIds: recent,
    });
    if (fallback === null) {
      throw exactError instanceof Error
        ? exactError
        : new Error(`Exact level ${intendedLevelId} unavailable and no eligible fallback exists`);
    }
    const fallbackData = await loadLevel(fallback.servedLevelId);
    const attempt = buildServingAttempt(
      progressionIndex,
      sequenceLevelIds,
      runtimeSequence,
      catalog.catalogRevision,
      intendedLevelId,
      fallback.servedLevelId,
      !exactPackageIsLoadable
        ? 'exact-package-unavailable'
        : 'exact-load-failed',
    );
    scheduleRollingCacheSync(sequenceLevelIds, progressionIndex, catalog);
    return setServingAttempt(fallbackData, attempt);
  }
}

/**
 * Revoke the Object URL held for a level, freeing its Blob. Safe to
 * call when no URL exists. Used by `GameScene.shutdown` to avoid
 * leaking blobs across level transitions.
 *
 * Revocation is deferred via queueMicrotask so Phaser's synchronous
 * texture-teardown in its own shutdown path completes first. Revoking
 * while Phaser still holds the URL bound to an `HTMLImageElement`
 * could invalidate in-flight GPU uploads during teardown. Deferring
 * one microtask preserves the "revoke eventually to free memory"
 * guarantee without racing Phaser.
 */
export function disposeLevelUrls(id: string): void {
  const url = colorUrlByLevel.get(id);
  if (url !== undefined) {
    colorUrlByLevel.delete(id);
    queueMicrotask((): void => {
      URL.revokeObjectURL(url);
    });
  }
  const bgUrls = bgUrlsByLevel.get(id);
  if (bgUrls !== undefined) {
    bgUrlsByLevel.delete(id);
    queueMicrotask((): void => {
      for (const u of bgUrls) URL.revokeObjectURL(u);
    });
  }
  const spriteUrls = spriteUrlsByLevel.get(id);
  if (spriteUrls !== undefined) {
    spriteUrlsByLevel.delete(id);
    queueMicrotask((): void => {
      for (const u of spriteUrls) URL.revokeObjectURL(u);
    });
  }
  levelCache.delete(id);
  loadTokenByLevel.delete(id);
}

/**
 * Whether a level's assets are available offline without a network
 * fetch. "Bundled" in the manifest marks levels that ship inside the
 * APK at a same-origin path — those are always offline-available
 * regardless of CDN mode. Other levels are offline-available only if
 * the IndexedDB AssetCache already has their content-hashed blob.
 *
 * In no-CDN (bundled-only) mode, every level is served from the APK
 * webroot and is therefore "cached."
 */
export async function isLevelCached(id: string): Promise<boolean> {
  if (levelCache.has(id)) return true;
  await ensureManifestInitialized();
  const manifest = manifestWithBundledFallbackEntries(getManifestClient().getManifest());
  const catalog = lastPackageCatalogSnapshot ?? await getActivePackageCatalog(manifest);
  const descriptor = catalog.packagesByLevelId.get(id);
  if (descriptor === undefined) return false;
  if (descriptor.bundled) return true;
  if (getCdnOrigin() === null) return false;
  return await locallyAvailableLevelIdsSafe(catalog.packagesByLevelId).then((ids) => ids.has(id));
}

/**
 * Current total bytes held by the IndexedDB AssetCache. Lazily
 * opens the cache so prior-session IDB data is reported correctly
 * even when no level has been loaded yet this session (e.g. user
 * opens Settings before first level tap on a cold launch that has
 * cached data from previous sessions).
 *
 * Intended for Settings UI ("X MB / 100 MB cached" readout).
 */
export async function getAssetCacheStats(): Promise<number> {
  await cleanupLegacyAssetCacheDatabases();
  return await getAssetCache().getTotalBytes();
}

/**
 * Clear the IndexedDB AssetCache — user-initiated from Settings.
 * Does NOT clear the bundled-manifest or levelCache (in-memory
 * session state). Lazily opens the cache so prior-session IDB
 * data is wiped even when no level has been loaded yet this
 * session.
 */
export async function clearAssetCache(): Promise<void> {
  rollingCacheSyncGeneration += 1;
  lastPackageRetentionPlan = null;
  await cleanupLegacyAssetCacheDatabases();
  await getAssetCache().clear();
}

export function runtimeSequenceSnapshot(): RuntimeSequenceResolution | null {
  return lastRuntimeSequenceResolution;
}

export function packageCacheSnapshot(): {
  catalogRevision: string | null;
  packageCount: number;
  lastRetentionPlan: ReturnType<typeof planRollingPackageRetention> | null;
  lastServingAttempt: LevelServingAttempt | null;
  lastKnownLiveListedStorageKey: string;
} {
  return {
    catalogRevision: lastPackageCatalogSnapshot?.catalogRevision ?? null,
    packageCount: lastPackageCatalogSnapshot?.packagesByLevelId.size ?? 0,
    lastRetentionPlan: lastPackageRetentionPlan,
    lastServingAttempt: lastLevelServingAttempt,
    lastKnownLiveListedStorageKey: LAST_KNOWN_LIVE_LISTED_STORAGE_KEY,
  };
}

/**
 * For tests / devtools — wipe in-memory caches AND the AssetCache.
 *
 * Object-URL revocation is deferred via queueMicrotask so an active
 * Phaser texture still bound to one of these URLs at clear-time gets
 * one microtask of grace before the backing blob disappears. Aligns
 * with `disposeLevelUrls`'s revoke semantics (todo 044). Tests that
 * need to observe post-revoke state should await a microtask after
 * calling this.
 */
export async function _clearAllLevelCaches(): Promise<void> {
  const colorUrls = Array.from(colorUrlByLevel.values());
  const bgUrls: string[] = [];
  for (const urls of bgUrlsByLevel.values()) bgUrls.push(...urls);
  const spriteUrls: string[] = [];
  for (const urls of spriteUrlsByLevel.values()) spriteUrls.push(...urls);
  queueMicrotask((): void => {
    for (const url of colorUrls) URL.revokeObjectURL(url);
    for (const url of bgUrls) URL.revokeObjectURL(url);
    for (const url of spriteUrls) URL.revokeObjectURL(url);
  });
  colorUrlByLevel.clear();
  bgUrlsByLevel.clear();
  spriteUrlsByLevel.clear();
  levelCache.clear();
  loadTokenByLevel.clear();
  cachedIndex = null;
  manifestClient = null;
  bundledManifestPromise = null;
  catalogManifestPromise = null;
  catalogManifestRetryAfterMs = 0;
  catalogSnapshotPromises.clear();
  catalogSnapshotRetryAfterMsByRevision.clear();
  lastRuntimeSequenceResolution = null;
  lastPackageCatalogSnapshot = null;
  lastPackageRetentionPlan = null;
  lastLevelServingAttempt = null;
  rollingCacheSyncGeneration += 1;
  if (assetCache !== null) {
    await assetCache.clear();
    assetCache = null;
  }
}
