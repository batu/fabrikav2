export type CohortBucketSpec = 'all' | readonly [number, number];

export interface LevelAsset {
  readonly hash: string;
  readonly size: number;
  readonly path: string;
}

export interface LevelAssets {
  readonly levelJson: LevelAsset;
  readonly colorImage: LevelAsset;
  readonly thumbnailImage?: LevelAsset;
  readonly bgImages?: readonly LevelAsset[];
  readonly dogSprites?: readonly LevelAsset[];
  readonly styleVariants?: Readonly<Record<string, LevelAsset>>;
}

export interface ManifestLevelEntry {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly cohort_buckets: readonly CohortBucketSpec[];
  readonly bundled: boolean;
  readonly assets: LevelAssets;
}

export interface ManifestV1 {
  readonly version: 1;
  readonly manifestRevision: number;
  readonly generatedAt: string;
  readonly experimentId: string;
  readonly levels: readonly ManifestLevelEntry[];
}

export interface CachedManifestEnvelope {
  readonly etag: string;
  readonly manifest: ManifestV1;
  readonly cachedAt: string;
}

export interface AssetCacheEntry {
  readonly hash: string;
  readonly size: number;
  readonly lastAccess: number;
  readonly mime: string;
}

export interface AssetCache {
  get(hash: string): Promise<Blob | undefined>;
  getOrFetch(hash: string, mime: string, fetcher: () => Promise<Blob>): Promise<Blob>;
  put(hash: string, blob: Blob, mime: string): Promise<void>;
  has(hash: string): Promise<boolean>;
  listEntries(): Promise<readonly AssetCacheEntry[]>;
  delete(hash: string): Promise<void>;
  getTotalBytes(): Promise<number>;
  clear(): Promise<void>;
  readonly degraded: boolean;
}

export interface AssetCacheOptions {
  readonly dbName?: string;
  readonly maxBytes?: number;
}

export function isBucketInCohort(bucket: number, buckets: readonly CohortBucketSpec[]): boolean {
  for (const spec of buckets) {
    if (spec === 'all') return true;
    const [start, endExclusive] = spec;
    if (bucket >= start && bucket < endExclusive) return true;
  }
  return false;
}

export function createAssetCache(options: AssetCacheOptions = {}): AssetCache {
  const maxBytes = options.maxBytes ?? 100 * 1024 * 1024;
  const blobs = new Map<string, Blob>();
  const entries = new Map<string, AssetCacheEntry>();
  const inflight = new Map<string, Promise<Blob>>();

  async function trimToBudget(incomingBytes: number): Promise<void> {
    let total = await cache.getTotalBytes();
    if (total + incomingBytes <= maxBytes) return;
    const victims = [...entries.values()].sort((a, b) => a.lastAccess - b.lastAccess);
    for (const victim of victims) {
      blobs.delete(victim.hash);
      entries.delete(victim.hash);
      total -= victim.size;
      if (total + incomingBytes <= maxBytes) return;
    }
  }

  const cache: AssetCache = {
    async get(hash): Promise<Blob | undefined> {
      const blob = blobs.get(hash);
      const entry = entries.get(hash);
      if (blob !== undefined && entry !== undefined) {
        entries.set(hash, { ...entry, lastAccess: Date.now() });
      }
      return blob;
    },
    async getOrFetch(hash, mime, fetcher): Promise<Blob> {
      const cached = await cache.get(hash);
      if (cached !== undefined) return cached;
      const pending = inflight.get(hash);
      if (pending !== undefined) return pending;
      const next = (async (): Promise<Blob> => {
        const blob = await fetcher();
        await cache.put(hash, blob, mime);
        return blob;
      })();
      inflight.set(hash, next);
      try {
        return await next;
      } finally {
        inflight.delete(hash);
      }
    },
    async put(hash, blob, mime): Promise<void> {
      if (blob.size > maxBytes) return;
      await trimToBudget(blob.size);
      blobs.set(hash, blob);
      entries.set(hash, { hash, size: blob.size, lastAccess: Date.now(), mime });
    },
    async has(hash): Promise<boolean> {
      return blobs.has(hash);
    },
    async listEntries(): Promise<readonly AssetCacheEntry[]> {
      return [...entries.values()].sort((a, b) => a.hash.localeCompare(b.hash));
    },
    async delete(hash): Promise<void> {
      blobs.delete(hash);
      entries.delete(hash);
    },
    async getTotalBytes(): Promise<number> {
      let total = 0;
      for (const entry of entries.values()) total += entry.size;
      return total;
    },
    async clear(): Promise<void> {
      blobs.clear();
      entries.clear();
      inflight.clear();
    },
    degraded: true,
  };

  return cache;
}

export interface ManifestClient {
  initialize(cdnManifestUrl: string | null, bundledFallback: ManifestV1): Promise<void>;
  getManifest(): ManifestV1;
  hasNewerRevisionThanLastSeen(): boolean;
  markCurrentRevisionSeen(): void;
}

function validManifest(value: unknown): value is ManifestV1 {
  if (value === null || typeof value !== 'object') return false;
  const manifest = value as Partial<ManifestV1>;
  return manifest.version === 1 && Array.isArray(manifest.levels);
}

export function createManifestClient(): ManifestClient {
  let manifest: ManifestV1 | null = null;

  return {
    async initialize(cdnManifestUrl, bundledFallback): Promise<void> {
      if (manifest !== null) return;
      if (cdnManifestUrl === null) {
        manifest = bundledFallback;
        return;
      }
      try {
        const response = await fetch(cdnManifestUrl, { cache: 'no-cache' });
        const parsed = response.ok ? (await response.json()) as unknown : null;
        manifest = validManifest(parsed) ? parsed : bundledFallback;
      } catch {
        manifest = bundledFallback;
      }
    },
    getManifest(): ManifestV1 {
      if (manifest === null) throw new Error('ManifestClient.getManifest() called before initialize()');
      return manifest;
    },
    hasNewerRevisionThanLastSeen(): boolean {
      return false;
    },
    markCurrentRevisionSeen(): void {
      // No-op in the v2 port; FTD only uses the live manifest for level serving.
    },
  };
}

export const ANON_ID_KEY = 'ftd_anon_id';
export const COHORT_KEY_PREFIX = 'ftd_cohort_';

export interface CohortResolver {
  initialize(experimentId: string): Promise<number>;
  bucket(experimentId: string): number;
  _reset(): void;
}

export function createCohortResolver(options: { numBuckets?: number } = {}): CohortResolver {
  const numBuckets = options.numBuckets ?? 100;
  const memo = new Map<string, number>();

  async function digestBucket(input: string): Promise<number> {
    if (crypto.subtle !== undefined) {
      const bytes = new TextEncoder().encode(input);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return new DataView(digest).getUint32(0) % numBuckets;
    }
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % numBuckets;
  }

  function storage(): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  return {
    async initialize(experimentId): Promise<number> {
      const key = COHORT_KEY_PREFIX + experimentId;
      const store = storage();
      const raw = store?.getItem(key) ?? null;
      if (raw !== null) {
        try {
          const parsed = JSON.parse(raw) as { bucket?: unknown };
          if (typeof parsed.bucket === 'number') {
            memo.set(experimentId, parsed.bucket);
            return parsed.bucket;
          }
        } catch {
          // Recompute below.
        }
      }
      let anonId = store?.getItem(ANON_ID_KEY) ?? null;
      if (anonId === null || anonId.length === 0) {
        anonId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
        store?.setItem(ANON_ID_KEY, anonId);
      }
      const bucket = await digestBucket(`${anonId}:${experimentId}`);
      memo.set(experimentId, bucket);
      store?.setItem(key, JSON.stringify({ experimentId, bucket, assignedAt: new Date().toISOString() }));
      return bucket;
    },
    bucket(experimentId): number {
      const value = memo.get(experimentId);
      if (value === undefined) throw new Error(`CohortResolver.bucket('${experimentId}') called before initialize().`);
      return value;
    },
    _reset(): void {
      memo.clear();
    },
  };
}
