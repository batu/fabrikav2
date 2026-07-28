export const DEFAULT_LEVEL_PACKAGE_CACHE_BUDGET_BYTES = 300 * 1024 * 1024;

export type SequenceDiagnosticCode =
  | 'payloadMissing'
  | 'rawPayloadRequired'
  | 'payloadBudgetInvalid'
  | 'payloadTooLarge'
  | 'integrityMissing'
  | 'integrityMalformed'
  | 'integrityHashFailed'
  | 'integrityMismatch'
  | 'payloadMalformed'
  | 'schemaVersionUnsupported'
  | 'sequenceVersionInvalid'
  | 'catalogRevisionInvalid'
  | 'pointerOnlyUnsupported'
  | 'levelIdsInvalid'
  | 'sequenceEmpty'
  | 'sequenceDuplicateLevel'
  | 'catalogSnapshotsMissing'
  | 'catalogSnapshotUnavailable'
  | 'catalogSnapshotDuplicate'
  | 'catalogEmpty'
  | 'catalogLevelMissing'
  | 'catalogLevelCohortRestricted'
  | 'catalogLevelDuplicate'
  | 'catalogPackageDuplicate'
  | 'supportedBuildsMissing'
  | 'supportedBuildsEmpty'
  | 'supportedBuildPlatformMissing'
  | 'supportedBuildStarterMismatch'
  | 'supportedBuildStartersEmpty'
  | 'supportedBuildStarterDuplicate'
  | 'starterPrefixTooShort'
  | 'starterPrefixMismatch'
  | 'starterNotBundled'
  | 'progressionIndexInvalid'
  | 'historyDuplicateVersion'
  | 'historyActiveVersionMissing'
  | 'rollbackTargetMissing'
  | 'rollbackTargetIneligible'
  | 'packageMissing'
  | 'packageIncomplete'
  | 'packageDuplicate'
  | 'packageBudgetInvalid'
  | 'lookaheadCountInvalid'
  | 'packageAssetInvalid'
  | 'packageAssetSizeMismatch'
  | 'packageBudgetExceeded';

export type SequenceDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface SequenceDiagnostic {
  readonly code: SequenceDiagnosticCode;
  readonly severity: SequenceDiagnosticSeverity;
  readonly blocking: boolean;
  readonly message: string;
  readonly levelId?: string;
  readonly packageId?: string;
  readonly version?: string;
  readonly platform?: SupportedBuildPlatform;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface RemoteLevelSequencePayload {
  readonly schemaVersion: 1;
  readonly sequenceVersion: string;
  readonly catalogRevision: string;
  readonly levelIds: readonly string[];
}

export interface SequencePayloadValidationOptions {
  readonly maxBytes: number;
  readonly expectedSha256Hex?: string;
  readonly sha256Hex?: (rawPayload: string) => Promise<string>;
}

export type SequencePayloadValidationResult =
  | {
      readonly ok: true;
      readonly payload: RemoteLevelSequencePayload;
      readonly diagnostics: readonly SequenceDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly SequenceDiagnostic[];
    };

export type CohortBucketSpec = 'all' | readonly [number, number];

export interface AvailableCatalogLevel {
  readonly id: string;
  readonly packageId: string;
  readonly bundled: boolean;
  readonly cohortBuckets: readonly CohortBucketSpec[];
}

export interface AvailableCatalogSnapshot {
  readonly revision: string;
  readonly levels: readonly AvailableCatalogLevel[];
}

export type SupportedBuildPlatform = 'android' | 'ios';

export interface SupportedBuild {
  readonly platform: SupportedBuildPlatform;
  readonly buildId: string;
  readonly supported: boolean;
  readonly sequenceSupported: boolean;
  readonly bundledStarterIds: readonly string[];
}

export interface SequenceActivationValidationContext {
  readonly catalogSnapshots: readonly AvailableCatalogSnapshot[] | null;
  readonly supportedBuilds: readonly SupportedBuild[] | null;
  readonly requiredPlatforms?: readonly SupportedBuildPlatform[];
}

export interface SequenceActivationValidationResult {
  readonly activatable: boolean;
  readonly diagnostics: readonly SequenceDiagnostic[];
}

export interface RawSequenceActivationValidationResult extends SequenceActivationValidationResult {
  readonly payload?: RemoteLevelSequencePayload;
}

export interface SequenceContentResolution {
  readonly ok: true;
  readonly sequenceIndex: number;
  readonly levelId: string;
  readonly displayLevelNumber: number;
}

export interface SequenceContentResolutionFailure {
  readonly ok: false;
  readonly diagnostics: readonly SequenceDiagnostic[];
}

export interface SequenceDiff {
  readonly addedIds: readonly string[];
  readonly removedIds: readonly string[];
  readonly movedIds: readonly string[];
  readonly destructive: boolean;
}

export interface SequenceHistoryEntry {
  readonly sequenceVersion: string;
  readonly catalogRevision: string;
  readonly levelIds: readonly string[];
  readonly rollbackEligible: boolean;
}

export interface SequenceHistory {
  readonly activeVersion: string;
  readonly entries: readonly SequenceHistoryEntry[];
}

export interface RollbackValidationResult {
  readonly canRollback: boolean;
  readonly targetVersion?: string;
  readonly diagnostics: readonly SequenceDiagnostic[];
}

export interface RollbackRetentionPlan {
  readonly ok: boolean;
  readonly retainedLevelIds: readonly string[];
  readonly retainedPackageIds: readonly string[];
  readonly diagnostics: readonly SequenceDiagnostic[];
}

export interface PackageAssetMetadata {
  readonly hash: string;
  readonly size: number;
}

export interface PackageMetadata {
  readonly id: string;
  readonly complete: boolean;
  readonly requiredAssets: readonly PackageAssetMetadata[];
  readonly optionalAssets?: readonly PackageAssetMetadata[];
}

export interface LevelPackageReference {
  readonly id: string;
  readonly packageId: string;
}

export interface PackageRetentionInput {
  readonly sequenceLevelIds: readonly string[];
  readonly progressionIndex: number;
  readonly catalogLevels: readonly LevelPackageReference[];
  readonly packages: readonly PackageMetadata[];
  readonly budgetBytes?: number;
  readonly lookaheadCount?: number;
}

export interface PackageRetentionPlan {
  readonly hasPlayableCurrentPackage: boolean;
  readonly retainedPackageIds: readonly string[];
  readonly prefetchPackageIds: readonly string[];
  readonly totalBytes: number;
  readonly diagnostics: readonly SequenceDiagnostic[];
}

function diagnostic(
  code: SequenceDiagnosticCode,
  message: string,
  details: Omit<SequenceDiagnostic, 'code' | 'message' | 'severity' | 'blocking'> = {},
  severity: SequenceDiagnosticSeverity = 'error',
): SequenceDiagnostic {
  return {
    code,
    severity,
    blocking: severity === 'error',
    message,
    ...details,
  };
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

async function defaultSha256Hex(rawPayload: string): Promise<string> {
  const bytes = new TextEncoder().encode(rawPayload);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeCatalogRevision(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return null;
}

function parsePayloadObject(value: unknown, diagnostics: SequenceDiagnostic[]): RemoteLevelSequencePayload | null {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic('payloadMalformed', 'Sequence payload must be a JSON object.'));
    return null;
  }

  if (!Array.isArray(value.levelIds)) {
    if ('sequenceUrl' in value || 'sequence_url' in value || 'url' in value || 'reference' in value) {
      diagnostics.push(diagnostic('pointerOnlyUnsupported', 'Pointer-only sequence payloads are not supported in V1.'));
      return null;
    }
    diagnostics.push(diagnostic('levelIdsInvalid', 'Sequence payload must include an embedded levelIds array.'));
    return null;
  }

  if (value.schemaVersion !== 1) {
    diagnostics.push(diagnostic('schemaVersionUnsupported', 'Sequence payload schemaVersion must be 1.'));
  }

  const sequenceVersion = typeof value.sequenceVersion === 'string' ? value.sequenceVersion.trim() : '';
  if (sequenceVersion.length === 0) {
    diagnostics.push(diagnostic('sequenceVersionInvalid', 'Sequence payload sequenceVersion must be a non-empty string.'));
  }

  const catalogRevision = normalizeCatalogRevision(value.catalogRevision);
  if (catalogRevision === null) {
    diagnostics.push(diagnostic('catalogRevisionInvalid', 'Sequence payload catalogRevision must be present.'));
  }

  const rawLevelIds: readonly unknown[] = value.levelIds;
  const levelIds: string[] = [];
  for (const levelId of rawLevelIds) {
    if (typeof levelId !== 'string' || levelId.trim().length === 0) {
      diagnostics.push(diagnostic('levelIdsInvalid', 'Every sequence level ID must be a non-empty string.'));
      continue;
    }
    levelIds.push(levelId);
  }

  if (diagnostics.length > 0) return null;

  return {
    schemaVersion: 1,
    sequenceVersion,
    catalogRevision: catalogRevision ?? '',
    levelIds,
  };
}

export async function validateSequencePayload(
  rawPayload: unknown,
  options: SequencePayloadValidationOptions,
): Promise<SequencePayloadValidationResult> {
  const diagnostics: SequenceDiagnostic[] = [];

  if (rawPayload === null || rawPayload === undefined) {
    diagnostics.push(diagnostic('payloadMissing', 'Remote Config sequence payload is missing.'));
    return { ok: false, diagnostics };
  }

  if (typeof rawPayload !== 'string') {
    diagnostics.push(diagnostic('rawPayloadRequired', 'Activation-grade sequence validation requires the raw JSON string.'));
    return { ok: false, diagnostics };
  }

  if (!isPositiveSafeInteger(options.maxBytes)) {
    diagnostics.push(diagnostic('payloadBudgetInvalid', 'Payload byte budget must be a positive safe integer.', { details: { maxBytes: options.maxBytes } }));
  } else {
    const actualBytes = utf8ByteLength(rawPayload);
    if (actualBytes > options.maxBytes) {
      diagnostics.push(diagnostic('payloadTooLarge', 'Remote Config sequence payload exceeds the configured byte budget.', { details: { actualBytes, maxBytes: options.maxBytes } }));
    }
  }

  if (options.expectedSha256Hex === undefined || options.expectedSha256Hex.trim().length === 0) {
    diagnostics.push(diagnostic('integrityMissing', 'Activation-grade sequence validation requires an expected SHA-256 digest.'));
  } else if (!isSha256Hex(options.expectedSha256Hex)) {
    diagnostics.push(diagnostic('integrityMalformed', 'Expected sequence payload digest must be a 64-character SHA-256 hex string.'));
  } else {
    try {
      const sha256Hex = options.sha256Hex ?? defaultSha256Hex;
      const actual = await sha256Hex(rawPayload);
      if (actual.toLowerCase() !== options.expectedSha256Hex.toLowerCase()) {
        diagnostics.push(diagnostic('integrityMismatch', 'Sequence payload digest does not match the expected SHA-256.'));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push(diagnostic('integrityHashFailed', `Sequence payload digest could not be computed: ${message}`));
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPayload);
  } catch {
    diagnostics.push(diagnostic('payloadMalformed', 'Remote Config sequence payload must be valid JSON.'));
    return { ok: false, diagnostics };
  }

  const payload = parsePayloadObject(parsed, diagnostics);
  if (payload === null || diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  return { ok: true, payload, diagnostics };
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return Array.from(duplicates).sort();
}

function sortedUnique(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const a = sortedUnique(left);
  const b = sortedUnique(right);
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function findCatalogSnapshot(
  catalogSnapshots: readonly AvailableCatalogSnapshot[] | null,
  revision: string,
  diagnostics: SequenceDiagnostic[],
): AvailableCatalogSnapshot | null {
  if (catalogSnapshots === null) {
    diagnostics.push(diagnostic('catalogSnapshotsMissing', 'Catalog snapshots are required for sequence activation.'));
    return null;
  }

  for (const duplicate of duplicateValues(catalogSnapshots.map((catalogSnapshot) => catalogSnapshot.revision))) {
    diagnostics.push(diagnostic('catalogSnapshotDuplicate', `Catalog snapshot revision ${duplicate} is duplicated.`, { details: { catalogRevision: duplicate } }));
  }

  const snapshot = catalogSnapshots.find((catalogSnapshot) => catalogSnapshot.revision === revision) ?? null;
  if (snapshot === null) {
    diagnostics.push(diagnostic('catalogSnapshotUnavailable', `Catalog snapshot ${revision} is not available.`));
    return null;
  }

  return snapshot;
}

function isUniversallyAvailable(level: AvailableCatalogLevel): boolean {
  return level.cohortBuckets.length === 1 && level.cohortBuckets[0] === 'all';
}

function catalogLevelMap(
  snapshot: AvailableCatalogSnapshot | null,
  diagnostics?: SequenceDiagnostic[],
): Map<string, AvailableCatalogLevel> {
  const levels = new Map<string, AvailableCatalogLevel>();
  if (snapshot === null) return levels;
  for (const duplicate of duplicateValues(snapshot.levels.map((level) => level.id))) {
    diagnostics?.push(diagnostic('catalogLevelDuplicate', `Catalog snapshot contains duplicate level ${duplicate}.`, { levelId: duplicate }));
  }
  for (const level of snapshot.levels) {
    if (!levels.has(level.id)) levels.set(level.id, level);
  }
  return levels;
}

function validateSequenceInCatalog(
  payload: RemoteLevelSequencePayload,
  snapshot: AvailableCatalogSnapshot | null,
  diagnostics: SequenceDiagnostic[],
): Map<string, AvailableCatalogLevel> {
  if (payload.levelIds.length === 0) {
    diagnostics.push(diagnostic('sequenceEmpty', 'Sequence must contain at least one level.'));
  }

  for (const duplicate of duplicateValues(payload.levelIds)) {
    diagnostics.push(diagnostic('sequenceDuplicateLevel', `Sequence contains duplicate level ${duplicate}.`, { levelId: duplicate }));
  }

  const levels = catalogLevelMap(snapshot, diagnostics);
  if (snapshot !== null && snapshot.levels.length === 0 && payload.levelIds.length > 0) {
    diagnostics.push(diagnostic('catalogEmpty', 'Catalog snapshot has no level entries for a non-empty sequence.'));
  }

  const listedPackageIds: string[] = [];
  for (const levelId of payload.levelIds) {
    const level = levels.get(levelId);
    if (level === undefined) {
      diagnostics.push(diagnostic('catalogLevelMissing', `Listed level ${levelId} is missing from the catalog snapshot.`, { levelId }));
      continue;
    }
    listedPackageIds.push(level.packageId);
    if (!isUniversallyAvailable(level)) {
      diagnostics.push(diagnostic('catalogLevelCohortRestricted', `Listed level ${levelId} is not globally available.`, { levelId }));
    }
  }

  for (const duplicate of duplicateValues(listedPackageIds)) {
    diagnostics.push(diagnostic('catalogPackageDuplicate', `Catalog package ${duplicate} is used by multiple listed levels.`, { packageId: duplicate }));
  }

  return levels;
}

function participatingBuilds(
  supportedBuilds: readonly SupportedBuild[] | null,
  requiredPlatforms: readonly SupportedBuildPlatform[],
  diagnostics: SequenceDiagnostic[],
): SupportedBuild[] {
  if (supportedBuilds === null) {
    diagnostics.push(diagnostic('supportedBuildsMissing', 'Supported-build registry is required for starter validation.'));
    return [];
  }

  const builds = supportedBuilds.filter((supportedBuild) => (
    supportedBuild.supported
    && supportedBuild.sequenceSupported
    && requiredPlatforms.includes(supportedBuild.platform)
  ));

  if (builds.length === 0) {
    diagnostics.push(diagnostic('supportedBuildsEmpty', 'No supported sequence-capable builds participate in validation.'));
    return [];
  }

  for (const platform of requiredPlatforms) {
    if (!builds.some((supportedBuild) => supportedBuild.platform === platform)) {
      diagnostics.push(diagnostic('supportedBuildPlatformMissing', `Supported-build registry is missing platform ${platform}.`, { platform }));
    }
  }

  return builds;
}

function validateStarterSet(
  payload: RemoteLevelSequencePayload,
  levels: Map<string, AvailableCatalogLevel>,
  supportedBuilds: readonly SupportedBuild[] | null,
  requiredPlatforms: readonly SupportedBuildPlatform[],
  diagnostics: SequenceDiagnostic[],
): void {
  const builds = participatingBuilds(supportedBuilds, requiredPlatforms, diagnostics);
  if (builds.length === 0) return;

  for (const build of builds) {
    for (const duplicate of duplicateValues(build.bundledStarterIds)) {
      diagnostics.push(diagnostic('supportedBuildStarterDuplicate', `Supported build ${build.buildId} contains duplicate starter ${duplicate}.`, { platform: build.platform, levelId: duplicate, details: { buildId: build.buildId } }));
    }
  }

  const starterIds = sortedUnique(builds[0]?.bundledStarterIds ?? []);
  if (starterIds.length === 0) {
    diagnostics.push(diagnostic('supportedBuildStartersEmpty', 'Supported sequence-capable builds must provide at least one bundled starter.', { details: { requiredPlatforms } }));
    return;
  }

  for (const build of builds.slice(1)) {
    if (!sameStringSet(starterIds, build.bundledStarterIds)) {
      diagnostics.push(diagnostic('supportedBuildStarterMismatch', `Supported build ${build.buildId} has an incompatible bundled starter set.`, { platform: build.platform, details: { buildId: build.buildId, expectedStarterIds: starterIds, actualStarterIds: sortedUnique(build.bundledStarterIds) } }));
    }
  }

  const starterCount = starterIds.length;
  if (payload.levelIds.length < starterCount) {
    diagnostics.push(diagnostic('starterPrefixTooShort', 'Sequence is shorter than the required bundled starter prefix.'));
    return;
  }

  const prefix = payload.levelIds.slice(0, starterCount);
  if (!sameStringSet(prefix, starterIds)) {
    diagnostics.push(diagnostic('starterPrefixMismatch', 'The first sequence positions must exactly match the bundled starter set.', { details: { expectedStarterIds: starterIds, actualPrefixIds: prefix } }));
  }

  for (const starterId of starterIds) {
    const level = levels.get(starterId);
    if (level !== undefined && !level.bundled) {
      diagnostics.push(diagnostic('starterNotBundled', `Starter level ${starterId} is not marked bundled in the catalog.`, { levelId: starterId }));
    }
  }
}

export function validateSequenceMetadataForActivation(
  payload: RemoteLevelSequencePayload,
  context: SequenceActivationValidationContext,
): SequenceActivationValidationResult {
  const diagnostics: SequenceDiagnostic[] = [];
  const requiredPlatforms = context.requiredPlatforms ?? ['android', 'ios'];
  const snapshot = findCatalogSnapshot(context.catalogSnapshots, payload.catalogRevision, diagnostics);
  const levels = validateSequenceInCatalog(payload, snapshot, diagnostics);
  validateStarterSet(payload, levels, context.supportedBuilds, requiredPlatforms, diagnostics);

  return {
    activatable: diagnostics.length === 0,
    diagnostics,
  };
}

export async function validateRawSequenceForActivation(
  rawPayload: unknown,
  payloadOptions: SequencePayloadValidationOptions,
  context: SequenceActivationValidationContext,
): Promise<RawSequenceActivationValidationResult> {
  const payloadResult = await validateSequencePayload(rawPayload, payloadOptions);
  if (!payloadResult.ok) {
    return { activatable: false, diagnostics: payloadResult.diagnostics };
  }

  const activationResult = validateSequenceMetadataForActivation(payloadResult.payload, context);
  return {
    activatable: activationResult.activatable,
    payload: payloadResult.payload,
    diagnostics: activationResult.diagnostics,
  };
}

export function resolveSequenceContent(
  sequenceLevelIds: readonly string[],
  progressionIndex: number,
): SequenceContentResolution | SequenceContentResolutionFailure {
  if (sequenceLevelIds.length === 0) {
    return { ok: false, diagnostics: [diagnostic('sequenceEmpty', 'Sequence must contain at least one level.')] };
  }
  if (!Number.isSafeInteger(progressionIndex) || progressionIndex < 0) {
    return { ok: false, diagnostics: [diagnostic('progressionIndexInvalid', 'Progression index must be a safe non-negative integer.')] };
  }

  const sequenceIndex = progressionIndex % sequenceLevelIds.length;
  return {
    ok: true,
    sequenceIndex,
    levelId: sequenceLevelIds[sequenceIndex] ?? sequenceLevelIds[0] ?? '',
    displayLevelNumber: progressionIndex + 1,
  };
}

export function diffLevelSequences(
  previousLevelIds: readonly string[],
  nextLevelIds: readonly string[],
): SequenceDiff {
  const previousSet = new Set(previousLevelIds);
  const nextSet = new Set(nextLevelIds);
  const addedIds = nextLevelIds.filter((levelId) => !previousSet.has(levelId));
  const removedIds = previousLevelIds.filter((levelId) => !nextSet.has(levelId));
  const movedIds = previousLevelIds.filter((levelId, previousIndex) => {
    if (!nextSet.has(levelId)) return false;
    return nextLevelIds.indexOf(levelId) !== previousIndex;
  });

  const appendOnly = previousLevelIds.every((levelId, index) => nextLevelIds[index] === levelId);

  return {
    addedIds,
    removedIds,
    movedIds,
    destructive: removedIds.length > 0 || !appendOnly || movedIds.length > 0,
  };
}

function validateHistory(history: SequenceHistory, diagnostics: SequenceDiagnostic[]): Map<string, SequenceHistoryEntry> {
  const entries = new Map<string, SequenceHistoryEntry>();
  for (const duplicate of duplicateValues(history.entries.map((entry) => entry.sequenceVersion))) {
    diagnostics.push(diagnostic('historyDuplicateVersion', `History contains duplicate sequence version ${duplicate}.`, { version: duplicate }));
  }

  for (const entry of history.entries) {
    if (!entries.has(entry.sequenceVersion)) entries.set(entry.sequenceVersion, entry);
  }

  if (!entries.has(history.activeVersion)) {
    diagnostics.push(diagnostic('historyActiveVersionMissing', `Active sequence version ${history.activeVersion} is not present in immutable history.`, { version: history.activeVersion }));
  }

  return entries;
}

function payloadFromHistoryEntry(entry: SequenceHistoryEntry): RemoteLevelSequencePayload {
  return {
    schemaVersion: 1,
    sequenceVersion: entry.sequenceVersion,
    catalogRevision: entry.catalogRevision,
    levelIds: entry.levelIds,
  };
}

export function validateRollbackTarget(
  history: SequenceHistory,
  targetVersion: string,
  context: SequenceActivationValidationContext,
): RollbackValidationResult {
  const diagnostics: SequenceDiagnostic[] = [];
  const entries = validateHistory(history, diagnostics);
  const target = entries.get(targetVersion);

  if (target === undefined) {
    diagnostics.push(diagnostic('rollbackTargetMissing', `Rollback target ${targetVersion} does not exist in immutable history.`, { version: targetVersion }));
    return { canRollback: false, diagnostics };
  }

  if (!target.rollbackEligible) {
    diagnostics.push(diagnostic('rollbackTargetIneligible', `Rollback target ${targetVersion} is not rollback-eligible.`, { version: targetVersion }));
  }

  const activation = validateSequenceMetadataForActivation(payloadFromHistoryEntry(target), context);
  diagnostics.push(...activation.diagnostics);

  return {
    canRollback: diagnostics.length === 0,
    targetVersion: diagnostics.length === 0 ? targetVersion : undefined,
    diagnostics,
  };
}

export function planRollbackCatalogRetention(
  history: SequenceHistory,
  catalogSnapshots: readonly AvailableCatalogSnapshot[] | null,
): RollbackRetentionPlan {
  const diagnostics: SequenceDiagnostic[] = [];
  const entries = validateHistory(history, diagnostics);
  const retainedLevelIds = new Set<string>();
  const retainedPackageIds = new Set<string>();

  for (const entry of entries.values()) {
    if (entry.sequenceVersion !== history.activeVersion && !entry.rollbackEligible) continue;
    const snapshot = findCatalogSnapshot(catalogSnapshots, entry.catalogRevision, diagnostics);
    const levels = catalogLevelMap(snapshot, diagnostics);
    for (const levelId of entry.levelIds) {
      retainedLevelIds.add(levelId);
      const level = levels.get(levelId);
      if (level === undefined) {
        diagnostics.push(diagnostic('catalogLevelMissing', `Retained level ${levelId} is missing from catalog snapshot ${entry.catalogRevision}.`, { levelId }));
        continue;
      }
      retainedPackageIds.add(level.packageId);
    }
  }

  return {
    ok: diagnostics.length === 0,
    retainedLevelIds: Array.from(retainedLevelIds).sort(),
    retainedPackageIds: Array.from(retainedPackageIds).sort(),
    diagnostics,
  };
}

function isValidAssetHash(hash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(hash);
}

interface PackageMapResult {
  readonly packages: ReadonlyMap<string, PackageMetadata>;
  readonly invalidPackageIds: ReadonlySet<string>;
}

function packageMap(packages: readonly PackageMetadata[], diagnostics: SequenceDiagnostic[]): PackageMapResult {
  const result = new Map<string, PackageMetadata>();
  const invalidPackageIds = new Set<string>();
  const assetSizes = new Map<string, number>();

  for (const duplicate of duplicateValues(packages.map((pkg) => pkg.id))) {
    diagnostics.push(diagnostic('packageDuplicate', `Package metadata contains duplicate package ${duplicate}.`, { packageId: duplicate }));
    invalidPackageIds.add(duplicate);
  }

  for (const pkg of packages) {
    if (!result.has(pkg.id)) result.set(pkg.id, pkg);
    for (const asset of pkg.requiredAssets) {
      if (!isValidAssetHash(asset.hash) || !isPositiveSafeInteger(asset.size)) {
        diagnostics.push(diagnostic('packageAssetInvalid', `Package ${pkg.id} contains invalid required asset metadata.`, { packageId: pkg.id, details: { hash: asset.hash, size: asset.size } }));
        invalidPackageIds.add(pkg.id);
        continue;
      }
      const existingSize = assetSizes.get(asset.hash);
      if (existingSize !== undefined && existingSize !== asset.size) {
        diagnostics.push(diagnostic('packageAssetSizeMismatch', `Required asset ${asset.hash} has conflicting sizes.`, { packageId: pkg.id, details: { hash: asset.hash, firstSize: existingSize, conflictingSize: asset.size } }));
        invalidPackageIds.add(pkg.id);
      }
      assetSizes.set(asset.hash, asset.size);
    }
  }

  return { packages: result, invalidPackageIds };
}

function levelPackageMap(levels: readonly LevelPackageReference[], diagnostics: SequenceDiagnostic[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const duplicate of duplicateValues(levels.map((level) => level.id))) {
    diagnostics.push(diagnostic('catalogLevelDuplicate', `Level/package references contain duplicate level ${duplicate}.`, { levelId: duplicate }));
  }
  for (const level of levels) {
    if (!result.has(level.id)) result.set(level.id, level.packageId);
  }
  return result;
}

function additionalRequiredBytes(
  pkg: PackageMetadata,
  retainedAssetHashes: ReadonlySet<string>,
): number {
  let total = 0;
  const packageHashes = new Set<string>();
  for (const asset of pkg.requiredAssets) {
    if (retainedAssetHashes.has(asset.hash) || packageHashes.has(asset.hash)) continue;
    packageHashes.add(asset.hash);
    total += asset.size;
  }
  return total;
}

function addRequiredAssetHashes(pkg: PackageMetadata, retainedAssetHashes: Set<string>): void {
  for (const asset of pkg.requiredAssets) retainedAssetHashes.add(asset.hash);
}

function retentionTargets(sequenceLevelIds: readonly string[], progressionIndex: number, lookaheadCount: number): string[] {
  const targets: string[] = [];
  for (let offset = 0; offset <= lookaheadCount; offset += 1) {
    const resolved = resolveSequenceContent(sequenceLevelIds, progressionIndex + offset);
    if (!resolved.ok) return targets;
    targets.push(resolved.levelId);
  }
  return targets;
}

export function planPackageRetention(input: PackageRetentionInput): PackageRetentionPlan {
  const diagnostics: SequenceDiagnostic[] = [];
  const budgetBytes = input.budgetBytes ?? DEFAULT_LEVEL_PACKAGE_CACHE_BUDGET_BYTES;
  const lookaheadCount = input.lookaheadCount ?? 10;
  const resolvedCurrent = resolveSequenceContent(input.sequenceLevelIds, input.progressionIndex);
  if (!resolvedCurrent.ok) {
    return {
      hasPlayableCurrentPackage: false,
      retainedPackageIds: [],
      prefetchPackageIds: [],
      totalBytes: 0,
      diagnostics: resolvedCurrent.diagnostics,
    };
  }

  if (!isPositiveSafeInteger(budgetBytes)) {
    diagnostics.push(diagnostic('packageBudgetInvalid', 'Package retention budget must be a positive safe integer.', { details: { budgetBytes } }));
  }
  if (!isNonNegativeSafeInteger(lookaheadCount)) {
    diagnostics.push(diagnostic('lookaheadCountInvalid', 'Package retention lookahead must be a non-negative safe integer.', { details: { lookaheadCount } }));
  }
  if (diagnostics.length > 0) {
    return {
      hasPlayableCurrentPackage: false,
      retainedPackageIds: [],
      prefetchPackageIds: [],
      totalBytes: 0,
      diagnostics,
    };
  }

  const packageInput = packageMap(input.packages, diagnostics);
  const packages = packageInput.packages;
  const invalidPackageIds = packageInput.invalidPackageIds;
  const levelPackages = levelPackageMap(input.catalogLevels, diagnostics);
  const retainedPackageIds: string[] = [];
  const prefetchPackageIds: string[] = [];
  const retainedPackageSet = new Set<string>();
  const retainedAssetHashes = new Set<string>();
  let totalBytes = 0;
  let currentPackageRetained = false;

  const targets = retentionTargets(input.sequenceLevelIds, input.progressionIndex, lookaheadCount);
  let budgetExhausted = false;
  for (const [index, levelId] of targets.entries()) {
    if (budgetExhausted) break;
    const packageId = levelPackages.get(levelId);
    if (packageId === undefined) {
      diagnostics.push(diagnostic('packageMissing', `Level ${levelId} has no package mapping.`, { levelId }));
      continue;
    }

    if (retainedPackageSet.has(packageId)) continue;

    const pkg = packages.get(packageId);
    if (pkg === undefined) {
      diagnostics.push(diagnostic('packageMissing', `Package ${packageId} is missing.`, { levelId, packageId }));
      continue;
    }

    if (!pkg.complete) {
      diagnostics.push(diagnostic('packageIncomplete', `Package ${packageId} is incomplete.`, { levelId, packageId }));
      continue;
    }

    if (invalidPackageIds.has(packageId)) {
      continue;
    }

    const nextBytes = additionalRequiredBytes(pkg, retainedAssetHashes);
    if (totalBytes + nextBytes > budgetBytes) {
      diagnostics.push(diagnostic('packageBudgetExceeded', `Package ${packageId} does not fit within the package cache budget.`, { levelId, packageId, details: { budgetBytes, currentBytes: totalBytes, packageBytes: nextBytes } }));
      budgetExhausted = true;
      continue;
    }

    totalBytes += nextBytes;
    retainedPackageSet.add(packageId);
    retainedPackageIds.push(packageId);
    addRequiredAssetHashes(pkg, retainedAssetHashes);
    if (index === 0) {
      currentPackageRetained = true;
    } else {
      prefetchPackageIds.push(packageId);
    }
  }

  const currentPackageDiagnostics = diagnostics.some((item) => (
    item.code === 'catalogLevelDuplicate'
    || item.code === 'packageDuplicate'
    || item.code === 'packageAssetInvalid'
    || item.code === 'packageAssetSizeMismatch'
    || (item.packageId !== undefined && retainedPackageIds[0] !== undefined && item.packageId === retainedPackageIds[0])
  ));

  return {
    hasPlayableCurrentPackage: currentPackageRetained && !currentPackageDiagnostics,
    retainedPackageIds,
    prefetchPackageIds,
    totalBytes,
    diagnostics,
  };
}
