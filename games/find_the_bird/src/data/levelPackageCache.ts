import type { AssetCache, ManifestLevelEntry, ManifestV1, LevelAsset } from '../v1core/assets';
import {
  DEFAULT_LEVEL_PACKAGE_CACHE_BUDGET_BYTES,
  planPackageRetention,
  type LevelPackageReference,
  type PackageMetadata,
  type PackageRetentionPlan,
} from '../sequence/sequenceValidation';
import type {
  RuntimeCatalogManifest,
  RuntimeCatalogManifestLevel,
  RuntimeCatalogPackageAsset,
} from '../sequence/runtimeSequence';
import { manifestEntryFromCatalogLevel } from './catalogManifestEntry';
import { isPlayableLevelAspect } from './playableAspect';

export const PACKAGE_CACHE_LOOKAHEAD_COUNT = 10;
export const LAST_KNOWN_LIVE_LISTED_STORAGE_KEY = 'ftd_last_known_live_listed_levels_v1';
export const RECENTLY_SERVED_LEVELS_STORAGE_KEY = 'ftd_recently_served_levels_v1';
const RECENTLY_SERVED_LIMIT = 5;

export type FallbackReason = 'exact-load-failed' | 'exact-package-unavailable';

export interface PackageAssetDescriptor {
  readonly role: string;
  readonly hash: string;
  readonly size: number;
  readonly path: string;
  readonly bundled: boolean;
}

export interface LevelPackageDescriptor {
  readonly levelId: string;
  readonly packageId: string;
  readonly bundled: boolean;
  readonly listable: boolean;
  readonly catalogRevision: string;
  readonly complete: boolean;
  readonly requiredAssets: readonly PackageAssetDescriptor[];
  readonly requiredDownloadedBytes: number;
  readonly rollbackRetained: boolean;
}

export interface PackageCatalogSnapshot {
  readonly catalogRevision: string;
  readonly packagesByLevelId: ReadonlyMap<string, LevelPackageDescriptor>;
}

export interface FallbackSelectionInput {
  readonly intendedLevelId: string;
  readonly activeLevelIds: readonly string[];
  readonly packagesByLevelId: ReadonlyMap<string, LevelPackageDescriptor>;
  readonly availableLevelIds: ReadonlySet<string>;
  readonly lastKnownLiveListedLevelIds: ReadonlySet<string>;
  readonly recentlyServedLevelIds?: readonly string[];
}

export interface FallbackSelection {
  readonly servedLevelId: string;
  readonly reason: FallbackReason;
}

export interface PackageCacheSyncInput {
  readonly sequenceLevelIds: readonly string[];
  readonly progressionIndex: number;
  readonly catalog: PackageCatalogSnapshot;
  readonly cache: AssetCache;
  readonly fetchAsset: (asset: PackageAssetDescriptor) => Promise<Blob>;
  readonly budgetBytes?: number;
  readonly lookaheadCount?: number;
}

export interface PackageCacheSyncResult {
  readonly retentionPlan: PackageRetentionPlan;
  readonly prefetchedPackageIds: readonly string[];
  readonly evictedHashes: readonly string[];
}

export interface LastKnownLiveListedState {
  readonly catalogRevision: string;
  readonly sequenceVersion: string | null;
  readonly levelIds: readonly string[];
  readonly updatedAtMs: number;
}

function defaultStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readLastKnownLiveListed(storage: Storage | null = defaultStorage()): LastKnownLiveListedState | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(LAST_KNOWN_LIVE_LISTED_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<LastKnownLiveListedState>;
    if (typeof parsed.catalogRevision !== 'string') return null;
    if (parsed.sequenceVersion !== null && typeof parsed.sequenceVersion !== 'string') return null;
    if (!Array.isArray(parsed.levelIds) || !parsed.levelIds.every((levelId) => typeof levelId === 'string')) return null;
    if (typeof parsed.updatedAtMs !== 'number' || !Number.isFinite(parsed.updatedAtMs)) return null;
    return {
      catalogRevision: parsed.catalogRevision,
      sequenceVersion: parsed.sequenceVersion ?? null,
      levelIds: [...parsed.levelIds],
      updatedAtMs: parsed.updatedAtMs,
    };
  } catch {
    return null;
  }
}

export function writeLastKnownLiveListed(
  state: LastKnownLiveListedState,
  storage: Storage | null = defaultStorage(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(LAST_KNOWN_LIVE_LISTED_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Best-effort fallback eligibility persistence only.
  }
}

export function readRecentlyServedLevelIds(storage: Storage | null = defaultStorage()): readonly string[] {
  if (storage === null) return [];
  try {
    const raw = storage.getItem(RECENTLY_SERVED_LEVELS_STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((levelId): levelId is string => typeof levelId === 'string').slice(0, RECENTLY_SERVED_LIMIT);
  } catch {
    return [];
  }
}

export function rememberServedLevelId(levelId: string, storage: Storage | null = defaultStorage()): void {
  if (storage === null) return;
  try {
    const next = [levelId, ...readRecentlyServedLevelIds(storage).filter((item) => item !== levelId)]
      .slice(0, RECENTLY_SERVED_LIMIT);
    storage.setItem(RECENTLY_SERVED_LEVELS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Best-effort repeat avoidance only.
  }
}

function manifestAssets(entry: ManifestLevelEntry): readonly PackageAssetDescriptor[] {
  const assets: PackageAssetDescriptor[] = [];
  const pushAsset = (role: string, asset: LevelAsset | undefined): void => {
    if (asset === undefined) return;
    assets.push({
      role,
      hash: asset.hash,
      size: asset.size,
      path: asset.path,
      bundled: isBundledAssetPath(asset.path, entry.bundled),
    });
  };

  pushAsset('levelJson', entry.assets.levelJson);
  pushAsset('colorImage', entry.assets.colorImage);
  for (const [index, asset] of (entry.assets.bgImages ?? []).entries()) {
    pushAsset(`bgImage:${index}`, asset);
  }
  for (const [index, asset] of (entry.assets.dogSprites ?? []).entries()) {
    pushAsset(`dogSprite:${index}`, asset);
  }
  for (const [slug, asset] of Object.entries(entry.assets.styleVariants ?? {})) {
    pushAsset(`styleVariant:${slug}`, asset);
  }
  return assets;
}

function isBundledAssetPath(path: string, bundled: boolean): boolean {
  return bundled && !path.startsWith('/assets/');
}

function allAssetsBundled(assets: readonly PackageAssetDescriptor[]): boolean {
  return assets.every((asset) => asset.bundled);
}

function assetPathFromManifestOrCatalog(
  catalogAsset: RuntimeCatalogPackageAsset,
  manifestAssetByHash: ReadonlyMap<string, PackageAssetDescriptor>,
): string | null {
  // Prefer the active manifest path when the same content hash is present:
  // the manifest is the runtime loadability source and may point at CDN
  // `/assets/...` while catalog metadata still records the source
  // `levels/<id>/...` path. Fall back to the catalog path for required
  // assets that do not appear in the manifest, such as legacy bw.png.
  const manifestAsset = manifestAssetByHash.get(catalogAsset.hash);
  if (manifestAsset !== undefined) return manifestAsset.path;
  if (typeof catalogAsset.path === 'string' && catalogAsset.path.trim().length > 0) return catalogAsset.path;
  return null;
}

function catalogRequiredAssets(
  catalogLevel: RuntimeCatalogManifestLevel,
  manifestEntry: ManifestLevelEntry,
): { assets: readonly PackageAssetDescriptor[]; allResolved: boolean } {
  const manifestAssetByHash = new Map(manifestAssets(manifestEntry).map((asset) => [asset.hash, asset]));
  const requiredAssets: PackageAssetDescriptor[] = [];
  let allResolved = true;
  for (const asset of catalogLevel.package?.requiredAssets ?? []) {
    const path = assetPathFromManifestOrCatalog(asset, manifestAssetByHash);
    if (path === null) {
      allResolved = false;
      continue;
    }
    requiredAssets.push({
      role: asset.role ?? 'required',
      hash: asset.hash,
      size: asset.size,
      path,
      bundled: isBundledAssetPath(path, manifestEntry.bundled || catalogLevel.bundledInApp === true),
    });
  }
  return { assets: requiredAssets, allResolved };
}

function catalogAssetHashesDifferFromManifest(
  catalogAssets: readonly PackageAssetDescriptor[],
  manifestAssetsList: readonly PackageAssetDescriptor[],
): boolean {
  const manifestHashByRole = new Map(manifestAssetsList.map((asset) => [asset.role, asset.hash]));
  for (const asset of catalogAssets) {
    const manifestHash = manifestHashByRole.get(asset.role);
    if (manifestHash !== undefined && manifestHash !== asset.hash) return true;
  }
  return false;
}

function replaceStaleCatalogAssetsWithManifest(
  catalogAssets: readonly PackageAssetDescriptor[],
  manifestAssetsList: readonly PackageAssetDescriptor[],
): readonly PackageAssetDescriptor[] {
  const manifestByRole = new Map(manifestAssetsList.map((asset) => [asset.role, asset]));
  return catalogAssets.map((asset) => {
    const manifestAsset = manifestByRole.get(asset.role);
    return manifestAsset !== undefined && manifestAsset.hash !== asset.hash ? manifestAsset : asset;
  });
}

function uniqueDownloadedBytes(assets: readonly PackageAssetDescriptor[]): number {
  const seen = new Set<string>();
  let total = 0;
  for (const asset of assets) {
    if (asset.bundled || seen.has(asset.hash)) continue;
    seen.add(asset.hash);
    total += asset.size;
  }
  return total;
}

function descriptorFromManifestEntry(
  manifestEntry: ManifestLevelEntry,
  catalogRevision: string,
): LevelPackageDescriptor {
  const requiredAssets = manifestAssets(manifestEntry);
  return {
    levelId: manifestEntry.id,
    packageId: `${manifestEntry.id}:${manifestEntry.assets.levelJson.hash}`,
    bundled: allAssetsBundled(requiredAssets),
    listable: true,
    catalogRevision,
    complete: true,
    requiredAssets,
    requiredDownloadedBytes: uniqueDownloadedBytes(requiredAssets),
    rollbackRetained: false,
  };
}

function descriptorFromCatalogEntry(
  manifestEntry: ManifestLevelEntry,
  catalogEntry: RuntimeCatalogManifestLevel,
  catalogRevision: string,
): LevelPackageDescriptor | null {
  if (typeof catalogEntry.packageId !== 'string' || catalogEntry.packageId.trim().length === 0) return null;
  const manifestAssetsList = manifestAssets(manifestEntry);
  const requiredAssetResult = catalogRequiredAssets(catalogEntry, manifestEntry);
  const useManifestAssets = requiredAssetResult.allResolved
    && catalogAssetHashesDifferFromManifest(requiredAssetResult.assets, manifestAssetsList);
  const requiredAssets = useManifestAssets
    ? replaceStaleCatalogAssetsWithManifest(requiredAssetResult.assets, manifestAssetsList)
    : requiredAssetResult.assets;
  const complete = catalogEntry.package?.complete === true
    && (useManifestAssets || requiredAssetResult.allResolved)
    && requiredAssets.length > 0;
  return {
    levelId: catalogEntry.id,
    packageId: catalogEntry.packageId,
    bundled: allAssetsBundled(requiredAssets),
    listable: catalogEntry.listable !== false && catalogEntry.tombstonedAt == null && catalogEntry.allCohortAvailable !== false,
    catalogRevision,
    complete,
    requiredAssets,
    requiredDownloadedBytes: uniqueDownloadedBytes(requiredAssets),
    rollbackRetained: (catalogEntry.retention?.rollbackEligibleSequenceVersions.length ?? 0) > 0,
  };
}

export function buildPackageCatalogSnapshot(
  manifest: ManifestV1,
  catalogManifest: RuntimeCatalogManifest | null | undefined,
): PackageCatalogSnapshot {
  const manifestEntries = manifest.levels.filter((entry) => isPlayableLevelAspect(entry.width, entry.height));
  const manifestById = new Map(manifestEntries.map((entry) => [entry.id, entry]));
  const packagesByLevelId = new Map<string, LevelPackageDescriptor>();

  if (catalogManifest !== null && catalogManifest !== undefined) {
    for (const catalogEntry of catalogManifest.levels) {
      const manifestEntry = manifestById.get(catalogEntry.id) ?? manifestEntryFromCatalogLevel(catalogEntry);
      if (manifestEntry === null || manifestEntry === undefined) continue;
      const descriptor = descriptorFromCatalogEntry(manifestEntry, catalogEntry, catalogManifest.catalogRevision);
      if (descriptor !== null) packagesByLevelId.set(descriptor.levelId, descriptor);
    }
    return {
      catalogRevision: catalogManifest.catalogRevision,
      packagesByLevelId,
    };
  }

  const catalogRevision = `manifest-${manifest.manifestRevision}`;
  for (const entry of manifestEntries) {
    const descriptor = descriptorFromManifestEntry(entry, catalogRevision);
    packagesByLevelId.set(descriptor.levelId, descriptor);
  }
  return { catalogRevision, packagesByLevelId };
}

export function retentionInputsForCatalog(
  catalog: PackageCatalogSnapshot,
): { catalogLevels: readonly LevelPackageReference[]; packages: readonly PackageMetadata[] } {
  const catalogLevels: LevelPackageReference[] = [];
  const packages: PackageMetadata[] = [];
  for (const descriptor of catalog.packagesByLevelId.values()) {
    catalogLevels.push({ id: descriptor.levelId, packageId: descriptor.packageId });
    packages.push({
      id: descriptor.packageId,
      complete: descriptor.complete,
      requiredAssets: descriptor.bundled
        ? []
        : descriptor.requiredAssets.map((asset) => ({ hash: asset.hash, size: asset.size })),
    });
  }
  return { catalogLevels, packages };
}

export function planRollingPackageRetention(
  sequenceLevelIds: readonly string[],
  progressionIndex: number,
  catalog: PackageCatalogSnapshot,
  budgetBytes: number = DEFAULT_LEVEL_PACKAGE_CACHE_BUDGET_BYTES,
  lookaheadCount: number = PACKAGE_CACHE_LOOKAHEAD_COUNT,
): PackageRetentionPlan {
  const { catalogLevels, packages } = retentionInputsForCatalog(catalog);
  return planPackageRetention({
    sequenceLevelIds,
    progressionIndex,
    catalogLevels,
    packages,
    budgetBytes,
    lookaheadCount,
  });
}

export async function packageIsLocallyAvailable(
  descriptor: LevelPackageDescriptor,
  cache: AssetCache,
): Promise<boolean> {
  if (!descriptor.listable || !descriptor.complete) return false;
  if (descriptor.bundled) return true;
  for (const asset of descriptor.requiredAssets) {
    if (asset.bundled) continue;
    if (!(await cache.has(asset.hash))) return false;
  }
  return true;
}

export async function locallyAvailableLevelIds(
  packagesByLevelId: ReadonlyMap<string, LevelPackageDescriptor>,
  cache: AssetCache,
): Promise<ReadonlySet<string>> {
  const ids = new Set<string>();
  for (const descriptor of packagesByLevelId.values()) {
    if (await packageIsLocallyAvailable(descriptor, cache)) ids.add(descriptor.levelId);
  }
  return ids;
}

export function selectFallbackLevel(input: FallbackSelectionInput): FallbackSelection | null {
  const activeIds = new Set(input.activeLevelIds);
  const orderedLevelIds = [
    ...input.activeLevelIds,
    ...[...input.lastKnownLiveListedLevelIds].filter((levelId) => !activeIds.has(levelId)),
  ];
  const recent = new Set(input.recentlyServedLevelIds ?? []);
  const candidates = orderedLevelIds
    .filter((levelId) => levelId !== input.intendedLevelId)
    .filter((levelId) => input.availableLevelIds.has(levelId))
    .filter((levelId) => input.packagesByLevelId.get(levelId)?.listable === true);

  if (candidates.length === 0) return null;
  const nonRecent = candidates.find((levelId) => !recent.has(levelId));
  return {
    servedLevelId: nonRecent ?? candidates[0]!,
    reason: 'exact-package-unavailable',
  };
}

function packageAssetsByPackageId(catalog: PackageCatalogSnapshot): ReadonlyMap<string, LevelPackageDescriptor> {
  const result = new Map<string, LevelPackageDescriptor>();
  const duplicatePackageIds = new Set<string>();
  for (const descriptor of catalog.packagesByLevelId.values()) {
    if (duplicatePackageIds.has(descriptor.packageId)) continue;
    if (result.has(descriptor.packageId)) {
      duplicatePackageIds.add(descriptor.packageId);
      result.delete(descriptor.packageId);
      continue;
    }
    result.set(descriptor.packageId, descriptor);
  }
  return result;
}

function hashesForPackageIds(
  packageIds: readonly string[],
  packagesById: ReadonlyMap<string, LevelPackageDescriptor>,
): Set<string> {
  const hashes = new Set<string>();
  for (const packageId of packageIds) {
    const descriptor = packagesById.get(packageId);
    if (descriptor === undefined || descriptor.bundled) continue;
    for (const asset of descriptor.requiredAssets) {
      if (!asset.bundled) hashes.add(asset.hash);
    }
  }
  return hashes;
}

function nextProgressionPackageId(
  sequenceLevelIds: readonly string[],
  progressionIndex: number,
  catalog: PackageCatalogSnapshot,
): string | null {
  if (sequenceLevelIds.length === 0) return null;
  const nextIndex = ((progressionIndex + 1) % sequenceLevelIds.length + sequenceLevelIds.length) % sequenceLevelIds.length;
  const nextLevelId = sequenceLevelIds[nextIndex];
  if (nextLevelId === undefined) return null;
  return catalog.packagesByLevelId.get(nextLevelId)?.packageId ?? null;
}

function prioritizedPrefetchPackageIds(
  prefetchPackageIds: readonly string[],
  sequenceLevelIds: readonly string[],
  progressionIndex: number,
  catalog: PackageCatalogSnapshot,
): readonly string[] {
  const nextPackageId = nextProgressionPackageId(sequenceLevelIds, progressionIndex, catalog);
  if (nextPackageId === null || !prefetchPackageIds.includes(nextPackageId)) return prefetchPackageIds;
  return [nextPackageId, ...prefetchPackageIds.filter((packageId) => packageId !== nextPackageId)];
}

async function prefetchPackage(
  descriptor: LevelPackageDescriptor,
  cache: AssetCache,
  fetchAsset: (asset: PackageAssetDescriptor) => Promise<Blob>,
): Promise<boolean> {
  if (descriptor.bundled) return true;
  if (!descriptor.listable || !descriptor.complete) return false;
  const pendingAssets = descriptor.requiredAssets.filter((asset) => !asset.bundled);
  for (const asset of pendingAssets) {
    await cache.getOrFetch(asset.hash, mimeForPackageAsset(asset), async () => fetchAsset(asset));
  }
  return await packageIsLocallyAvailable(descriptor, cache);
}

function isRecoverablePrefetchError(error: unknown): boolean {
  const name = error instanceof DOMException ? error.name : null;
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'AbortError' || name === 'NetworkError') return true;
  if (error instanceof TypeError) return true;
  if (message.startsWith('package asset fetch failed:')) return true;
  if (message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('Load failed')) return true;
  if (message.toLowerCase().includes('offline')) return true;
  return false;
}

export async function syncRollingPackageCache(input: PackageCacheSyncInput): Promise<PackageCacheSyncResult> {
  const budgetBytes = input.budgetBytes ?? DEFAULT_LEVEL_PACKAGE_CACHE_BUDGET_BYTES;
  const lookaheadCount = input.lookaheadCount ?? PACKAGE_CACHE_LOOKAHEAD_COUNT;
  const retentionPlan = planRollingPackageRetention(
    input.sequenceLevelIds,
    input.progressionIndex,
    input.catalog,
    budgetBytes,
    lookaheadCount,
  );
  const packagesById = packageAssetsByPackageId(input.catalog);
  const retainedPackageIds = new Set(retentionPlan.retainedPackageIds);
  for (const descriptor of packagesById.values()) {
    if (descriptor.rollbackRetained) retainedPackageIds.add(descriptor.packageId);
  }
  const retainedHashes = hashesForPackageIds([...retainedPackageIds], packagesById);
  const evictedHashes: string[] = [];
  for (const entry of await input.cache.listEntries()) {
    if (retainedHashes.has(entry.hash)) continue;
    await input.cache.delete(entry.hash);
    evictedHashes.push(entry.hash);
  }

  const prefetchedPackageIds: string[] = [];
  const prefetchPackageIds = prioritizedPrefetchPackageIds(
    retentionPlan.prefetchPackageIds,
    input.sequenceLevelIds,
    input.progressionIndex,
    input.catalog,
  );
  for (const packageId of prefetchPackageIds) {
    const descriptor = packagesById.get(packageId);
    if (descriptor === undefined) continue;
    try {
      if (await prefetchPackage(descriptor, input.cache, input.fetchAsset)) {
        prefetchedPackageIds.push(packageId);
      }
    } catch (error) {
      if (!isRecoverablePrefetchError(error)) throw error;
      continue;
    }
  }

  return { retentionPlan, prefetchedPackageIds, evictedHashes };
}

export function mimeForPackageAsset(asset: PackageAssetDescriptor): string {
  if (asset.path.endsWith('.webp')) return 'image/webp';
  if (asset.path.endsWith('.png')) return 'image/png';
  if (asset.path.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}
