import type { ManifestLevelEntry, ManifestV1 } from '../v1core/assets';
import type { RemoteConfigValueKey, RemoteConfigValues } from '../config/remoteConfigSchema';
import { isPlayableLevelAspect } from '../data/playableAspect';
import {
  validateRawSequenceForActivation,
  validateSequenceMetadataForActivation,
  type AvailableCatalogSnapshot,
  type RemoteLevelSequencePayload,
  type SequenceDiagnostic,
  type SupportedBuild,
} from './sequenceValidation';

export const RUNTIME_SEQUENCE_STORAGE_KEY = 'ftd_active_level_sequence_v1';
export const DEFAULT_REMOTE_SEQUENCE_PAYLOAD_BUDGET_BYTES = 64 * 1024;

export type RuntimeSequenceSource = 'remote' | 'cached' | 'default';
export type RuntimeRemoteConfigValueSource = 'static' | 'default' | 'remote' | 'local';

export interface StoredRuntimeSequence {
  readonly schemaVersion: 1;
  readonly sequenceVersion: string;
  readonly catalogRevision: string;
  readonly levelIds: readonly string[];
  readonly activatedAtMs: number;
}

export interface RuntimeSequenceResolution {
  readonly source: RuntimeSequenceSource;
  readonly levelIds: readonly string[];
  readonly sequenceVersion: string | null;
  readonly catalogRevision: string;
  readonly diagnostics: readonly SequenceDiagnostic[];
  readonly nextStoredSequence: StoredRuntimeSequence | null;
  readonly explicitRemoteDisable?: boolean;
}

export interface RuntimeCatalogPackageAsset {
  readonly role?: string;
  readonly hash: string;
  readonly size: number;
  readonly path?: string;
}

export interface RuntimeCatalogPackageMetadata {
  readonly complete: boolean;
  readonly requiredBytes?: number;
  readonly requiredAssets: readonly RuntimeCatalogPackageAsset[];
  readonly optionalAssets?: readonly RuntimeCatalogPackageAsset[];
}

export interface RuntimeCatalogRetentionMetadata {
  readonly activeSequenceVersions: readonly string[];
  readonly rollbackEligibleSequenceVersions: readonly string[];
}

export interface RuntimeCatalogManifestLevel {
  readonly id: string;
  readonly name?: string;
  readonly width?: number;
  readonly height?: number;
  readonly packageId?: string;
  readonly bundledInApp?: boolean;
  readonly cohortBuckets?: readonly ('all' | readonly [number, number])[];
  readonly listable?: boolean;
  readonly allCohortAvailable?: boolean;
  readonly tombstonedAt?: string | null;
  readonly package?: RuntimeCatalogPackageMetadata;
  readonly retention?: RuntimeCatalogRetentionMetadata;
}

export interface RuntimeCatalogManifest {
  readonly catalogRevision: string;
  readonly levels: readonly RuntimeCatalogManifestLevel[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCohortBucketSpec(value: unknown): value is 'all' | readonly [number, number] {
  if (value === 'all') return true;
  return Array.isArray(value)
    && value.length === 2
    && Number.isSafeInteger(value[0])
    && Number.isSafeInteger(value[1]);
}

function parseCatalogAsset(value: unknown): RuntimeCatalogPackageAsset | null {
  if (!isRecord(value)) return null;
  const hash = value.hash;
  const size = value.size;
  if (typeof hash !== 'string' || hash.trim().length === 0) return null;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) return null;
  return {
    ...(typeof value.role === 'string' && value.role.trim().length > 0 ? { role: value.role } : {}),
    hash,
    size,
    ...(typeof value.path === 'string' && value.path.trim().length > 0 ? { path: value.path } : {}),
  };
}

function parseCatalogPackage(value: unknown): RuntimeCatalogPackageMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const requiredAssetsRaw = value.requiredAssets;
  if (!Array.isArray(requiredAssetsRaw)) return undefined;
  const parsedRequiredAssets = requiredAssetsRaw.map(parseCatalogAsset);
  const requiredAssetsValid = parsedRequiredAssets.every((asset): asset is RuntimeCatalogPackageAsset => asset !== null);
  const requiredAssets = parsedRequiredAssets.filter((asset): asset is RuntimeCatalogPackageAsset => asset !== null);
  const optionalAssetsRaw = value.optionalAssets;
  const optionalAssets = Array.isArray(optionalAssetsRaw)
    ? optionalAssetsRaw
      .map(parseCatalogAsset)
      .filter((asset): asset is RuntimeCatalogPackageAsset => asset !== null)
    : undefined;
  const requiredBytes = value.requiredBytes;
  return {
    complete: value.complete === true && requiredAssetsValid,
    ...(typeof requiredBytes === 'number' && Number.isSafeInteger(requiredBytes) && requiredBytes >= 0 ? { requiredBytes } : {}),
    requiredAssets,
    ...(optionalAssets !== undefined ? { optionalAssets } : {}),
  };
}

function parseCatalogRetention(value: unknown): RuntimeCatalogRetentionMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const active = Array.isArray(value.activeSequenceVersions)
    ? value.activeSequenceVersions.filter((item): item is string => typeof item === 'string')
    : [];
  const rollback = Array.isArray(value.rollbackEligibleSequenceVersions)
    ? value.rollbackEligibleSequenceVersions.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    activeSequenceVersions: active,
    rollbackEligibleSequenceVersions: rollback,
  };
}

export function parseRuntimeCatalogManifest(value: unknown): RuntimeCatalogManifest | null {
  if (!isRecord(value)) return null;
  if (typeof value.catalogRevision !== 'string' || value.catalogRevision.trim().length === 0) return null;
  if (!Array.isArray(value.levels)) return null;
  const levels: RuntimeCatalogManifestLevel[] = [];
  for (const item of value.levels) {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id.trim().length === 0) continue;
    const name = typeof item.name === 'string' && item.name.trim().length > 0
      ? item.name
      : undefined;
    const width = typeof item.width === 'number' && Number.isSafeInteger(item.width) && item.width > 0
      ? item.width
      : undefined;
    const height = typeof item.height === 'number' && Number.isSafeInteger(item.height) && item.height > 0
      ? item.height
      : undefined;
    const packageId = typeof item.packageId === 'string' && item.packageId.trim().length > 0
      ? item.packageId
      : undefined;
    const bundledInApp = typeof item.bundledInApp === 'boolean' ? item.bundledInApp : undefined;
    const cohortBuckets = Array.isArray(item.cohortBuckets) && item.cohortBuckets.every(isCohortBucketSpec)
      ? item.cohortBuckets
      : undefined;
    const listable = typeof item.listable === 'boolean' ? item.listable : undefined;
    const allCohortAvailable = typeof item.allCohortAvailable === 'boolean' ? item.allCohortAvailable : undefined;
    const tombstonedAt = typeof item.tombstonedAt === 'string' || item.tombstonedAt === null ? item.tombstonedAt : undefined;
    const packageMetadata = parseCatalogPackage(item.package);
    const retention = parseCatalogRetention(item.retention);
    levels.push({
      id: item.id,
      ...(name !== undefined ? { name } : {}),
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      ...(packageId !== undefined ? { packageId } : {}),
      ...(bundledInApp !== undefined ? { bundledInApp } : {}),
      ...(cohortBuckets !== undefined ? { cohortBuckets } : {}),
      ...(listable !== undefined ? { listable } : {}),
      ...(allCohortAvailable !== undefined ? { allCohortAvailable } : {}),
      ...(tombstonedAt !== undefined ? { tombstonedAt } : {}),
      ...(packageMetadata !== undefined ? { package: packageMetadata } : {}),
      ...(retention !== undefined ? { retention } : {}),
    });
  }
  return { catalogRevision: value.catalogRevision, levels };
}

export interface ResolveRuntimeSequenceInput {
  readonly manifest: ManifestV1;
  readonly catalogManifest?: RuntimeCatalogManifest | null;
  readonly remoteValues: Pick<RemoteConfigValues, 'levelSequencePayload' | 'levelSequenceSha256'>;
  readonly remoteValueSources?: Partial<Record<RemoteConfigValueKey, RuntimeRemoteConfigValueSource>>;
  readonly storedSequence: StoredRuntimeSequence | null;
  readonly nowMs?: number;
  readonly maxPayloadBytes?: number;
}

function playableManifestLevels(manifest: ManifestV1): readonly ManifestLevelEntry[] {
  return manifest.levels.filter((level) => isPlayableLevelAspect(level.width, level.height));
}

export function runtimeCatalogRevisionForManifest(manifest: ManifestV1): string {
  const manifestRecord = manifest as ManifestV1 & { catalogRevision?: unknown };
  if (typeof manifestRecord.catalogRevision === 'string' && manifestRecord.catalogRevision.trim().length > 0) {
    return manifestRecord.catalogRevision;
  }
  return `manifest-${manifest.manifestRevision}`;
}

function catalogSnapshotFromManifest(
  manifest: ManifestV1,
  catalogManifest: RuntimeCatalogManifest | null | undefined,
): AvailableCatalogSnapshot {
  if (catalogManifest !== null && catalogManifest !== undefined) {
    const bundledManifestIds = new Set(
      playableManifestLevels(manifest)
        .filter((level) => level.bundled)
        .map((level) => level.id),
    );
    const levels = catalogManifest.levels
      .filter((level) => typeof level.packageId === 'string' && Array.isArray(level.cohortBuckets))
      .map((level) => ({
        id: level.id,
        packageId: level.packageId as string,
        bundled: bundledManifestIds.has(level.id) || level.bundledInApp === true,
        cohortBuckets: level.cohortBuckets ?? [],
      }));

    return {
      revision: catalogManifest.catalogRevision,
      levels,
    };
  }

  const levels = playableManifestLevels(manifest).map((level) => ({
    id: level.id,
    packageId: `${level.id}:${level.assets.levelJson.hash}`,
    bundled: level.bundled,
    cohortBuckets: level.cohort_buckets,
  }));

  return {
    revision: runtimeCatalogRevisionForManifest(manifest),
    levels,
  };
}

function supportedBuildsFromManifest(manifest: ManifestV1): readonly SupportedBuild[] {
  const starterIds = playableManifestLevels(manifest)
    .filter((level) => level.bundled)
    .map((level) => level.id);

  return [
    {
      platform: 'android',
      buildId: `manifest-${manifest.manifestRevision}-android`,
      supported: true,
      sequenceSupported: true,
      bundledStarterIds: starterIds,
    },
    {
      platform: 'ios',
      buildId: `manifest-${manifest.manifestRevision}-ios`,
      supported: true,
      sequenceSupported: true,
      bundledStarterIds: starterIds,
    },
  ];
}

function defaultLevelIds(manifest: ManifestV1): readonly string[] {
  return playableManifestLevels(manifest).map((level) => level.id);
}

function payloadFromStoredSequence(storedSequence: StoredRuntimeSequence): RemoteLevelSequencePayload {
  return {
    schemaVersion: 1,
    sequenceVersion: storedSequence.sequenceVersion,
    catalogRevision: storedSequence.catalogRevision,
    levelIds: storedSequence.levelIds,
  };
}

function storedSequenceFromPayload(payload: RemoteLevelSequencePayload, activatedAtMs: number): StoredRuntimeSequence {
  return {
    schemaVersion: 1,
    sequenceVersion: payload.sequenceVersion,
    catalogRevision: payload.catalogRevision,
    levelIds: [...payload.levelIds],
    activatedAtMs,
  };
}

function validateStoredSequence(
  storedSequence: StoredRuntimeSequence,
  catalogSnapshot: AvailableCatalogSnapshot,
  supportedBuilds: readonly SupportedBuild[],
): readonly SequenceDiagnostic[] {
  const result = validateSequenceMetadataForActivation(payloadFromStoredSequence(storedSequence), {
    catalogSnapshots: [catalogSnapshot],
    supportedBuilds,
    requiredPlatforms: ['android', 'ios'],
  });
  return result.diagnostics;
}

function hasRemoteSequencePayload(remoteValues: Pick<RemoteConfigValues, 'levelSequencePayload' | 'levelSequenceSha256'>): boolean {
  return remoteValues.levelSequencePayload.trim().length > 0 || remoteValues.levelSequenceSha256.trim().length > 0;
}

function isExplicitRemoteDisable(input: ResolveRuntimeSequenceInput): boolean {
  return input.remoteValueSources?.levelSequencePayload === 'remote'
    && input.remoteValues.levelSequencePayload.trim().length === 0;
}

export async function resolveRuntimeSequence(input: ResolveRuntimeSequenceInput): Promise<RuntimeSequenceResolution> {
  const catalogSnapshot = catalogSnapshotFromManifest(input.manifest, input.catalogManifest);
  const supportedBuilds = supportedBuildsFromManifest(input.manifest);
  const maxBytes = input.maxPayloadBytes ?? DEFAULT_REMOTE_SEQUENCE_PAYLOAD_BUDGET_BYTES;
  const nowMs = input.nowMs ?? Date.now();
  const diagnostics: SequenceDiagnostic[] = [];

  if (isExplicitRemoteDisable(input)) {
    return {
      source: 'default',
      levelIds: defaultLevelIds(input.manifest),
      sequenceVersion: null,
      catalogRevision: catalogSnapshot.revision,
      diagnostics,
      nextStoredSequence: null,
      explicitRemoteDisable: true,
    };
  }

  if (hasRemoteSequencePayload(input.remoteValues)) {
    const remoteResult = await validateRawSequenceForActivation(
      input.remoteValues.levelSequencePayload,
      {
        maxBytes,
        expectedSha256Hex: input.remoteValues.levelSequenceSha256,
      },
      {
        catalogSnapshots: [catalogSnapshot],
        supportedBuilds,
        requiredPlatforms: ['android', 'ios'],
      },
    );
    diagnostics.push(...remoteResult.diagnostics);
    if (remoteResult.activatable && remoteResult.payload !== undefined) {
      return {
        source: 'remote',
        levelIds: remoteResult.payload.levelIds,
        sequenceVersion: remoteResult.payload.sequenceVersion,
        catalogRevision: remoteResult.payload.catalogRevision,
        diagnostics,
        nextStoredSequence: storedSequenceFromPayload(remoteResult.payload, nowMs),
      };
    }
  }

  if (input.storedSequence !== null) {
    const cachedDiagnostics = validateStoredSequence(input.storedSequence, catalogSnapshot, supportedBuilds);
    diagnostics.push(...cachedDiagnostics);
    if (cachedDiagnostics.length === 0) {
      return {
        source: 'cached',
        levelIds: input.storedSequence.levelIds,
        sequenceVersion: input.storedSequence.sequenceVersion,
        catalogRevision: input.storedSequence.catalogRevision,
        diagnostics,
        nextStoredSequence: input.storedSequence,
      };
    }
  }

  return {
    source: 'default',
    levelIds: defaultLevelIds(input.manifest),
    sequenceVersion: null,
    catalogRevision: catalogSnapshot.revision,
    diagnostics,
    nextStoredSequence: null,
  };
}

export function parseStoredRuntimeSequence(rawValue: string | null): StoredRuntimeSequence | null {
  if (rawValue === null) return null;
  const parsed = JSON.parse(rawValue) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (record.schemaVersion !== 1) return null;
  if (typeof record.sequenceVersion !== 'string' || record.sequenceVersion.trim().length === 0) return null;
  if (typeof record.catalogRevision !== 'string' || record.catalogRevision.trim().length === 0) return null;
  const levelIds = record.levelIds;
  if (!Array.isArray(levelIds) || !levelIds.every((levelId) => typeof levelId === 'string')) return null;
  if (typeof record.activatedAtMs !== 'number' || !Number.isFinite(record.activatedAtMs)) return null;
  return {
    schemaVersion: 1,
    sequenceVersion: record.sequenceVersion,
    catalogRevision: record.catalogRevision,
    levelIds: [...levelIds],
    activatedAtMs: record.activatedAtMs,
  };
}

export function serializeStoredRuntimeSequence(storedSequence: StoredRuntimeSequence): string {
  return JSON.stringify(storedSequence);
}
