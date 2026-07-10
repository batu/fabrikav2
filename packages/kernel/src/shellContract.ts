import rawShellPresentationContract from '../contracts/shell-presentation.v1.json' with { type: 'json' };

import type { GameScreenName } from './game-config.ts';

export type ShellStateId = 'menu' | 'level' | 'settings' | 'pause' | 'win' | 'fail';

export type ShellAnchorId =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type ShellFitMode = 'contain' | 'cover';
export type ShellVisibility = 'visible' | 'hidden';

export interface ShellInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ShellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShellViewport {
  width: number;
  height: number;
  insets: ShellInsets;
}

export interface ShellNormalizedGeometry {
  offset: { x: number; y: number };
  size: { width: number; height: number };
  fit: ShellFitMode;
}

export interface ShellGeometryCaps {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
}

export interface ShellAnchorDefinition {
  id: ShellAnchorId;
  x: 0 | 0.5 | 1;
  y: 0 | 0.5 | 1;
}

export interface ShellAccessibilityContract {
  role: string;
  nameKey: string;
  stateSemantics: string[];
  traversalGroup: string;
}

export interface ShellVisualPresentation {
  geometry?: ShellNormalizedGeometry;
  order?: number;
  visibility?: ShellVisibility;
  copy?: string;
  colors?: Record<string, string>;
  assetId?: string;
  opacity?: number;
  scale?: number;
}

export interface ShellDefaultPresentation extends ShellVisualPresentation {
  geometry: ShellNormalizedGeometry;
  order: number;
  visibility: ShellVisibility;
}

export interface ShellStateDefinition {
  id: ShellStateId;
  editorPageId: string;
  label: string;
  gameScreenNames: GameScreenName[];
}

export interface ShellBindingDefinition {
  id: string;
  kind: 'static' | 'region' | 'read' | 'action' | 'toggle';
}

export interface ShellStateFamilyDefinition {
  id: string;
  requiredVariants: string[];
  base: ShellVisualPresentation;
  variants: Record<string, ShellVisualPresentation>;
}

export interface ShellAssetSlotDefinition {
  id: string;
  fit: ShellFitMode;
  compatibleRoleIds: string[];
  geometry: ShellGeometryCaps;
  alpha: 'allowed' | 'required' | 'forbidden';
  provenanceRequired: boolean;
  mimeTypes: string[];
}

export interface ShellRoleDefinition {
  id: string;
  anchor: ShellAnchorId;
  stateFamilyId: string;
  assetSlotId: string | null;
  geometryCaps: ShellGeometryCaps;
  minimumTouchTarget: number;
  requiredSafeBounds: boolean;
  editableProperties: string[];
}

export interface ShellInstanceDefinition {
  id: string;
  parentInstanceId: string | null;
  stateId: ShellStateId;
  roleId: string;
  bindingId: string;
  stateFamilyId: string;
  required: boolean;
  actionId?: string;
  accessibility: ShellAccessibilityContract;
  defaultPresentation: ShellDefaultPresentation;
}

export interface ShellRequiredActionDefinition {
  id: string;
  stateId: ShellStateId;
  bindingId: string;
  actionHook: string;
  minimumCount: number;
  instanceIds: string[];
}

export interface ShellPresentationContract {
  contractId: string;
  contractVersion: string;
  schemaDialect: string;
  compatibility: {
    compatibilityId: string;
    minimumReaderVersion: string;
    canonicalization: string;
    hashAlgorithm: string;
  };
  canonicalCanvas: {
    width: number;
    height: number;
    baselineInsets: ShellInsets;
    baselineSafeRect: ShellRect;
    minimumActionSize: number;
  };
  anchors: ShellAnchorDefinition[];
  gameScreenNames: GameScreenName[];
  states: ShellStateDefinition[];
  bindings: ShellBindingDefinition[];
  stateFamilies: ShellStateFamilyDefinition[];
  assetSlots: ShellAssetSlotDefinition[];
  roles: ShellRoleDefinition[];
  instances: ShellInstanceDefinition[];
  requiredActions: ShellRequiredActionDefinition[];
  editableAst: {
    astVersion: number;
    numberBounds: Record<string, Record<string, number | boolean>>;
    enums: Record<string, string[]>;
    colorFormats: string[];
    copy: { maximumCodePoints: number; allowNewlines: boolean };
    assetIds: { pattern: string; mustExistInPublicationCatalog: boolean };
    allowedPresentationFields: string[];
    forbiddenFields: string[];
  };
  neutralIdPolicy: { pattern: string; forbiddenTokens: string[] };
  publication: {
    publicationIdAlgorithm: string;
    publicationIdDomain: string;
    publicationIdFields: string[];
    requiredStates: ShellStateId[];
    canonicalComponentFields: string[];
    portableContentNetworkPolicy: string;
    mixedRevisionPolicy: string;
  };
  projection: {
    pointerPath: string;
    immutableRevisionRoot: string;
    revisionDirectoryName: string;
    projectionIdAlgorithm: string;
    projectionIdDomain: string;
    projectionIdFields: string[];
    requiredArtifacts: string[];
    assetDirectory: string;
    artifactHashAlgorithm: string;
    atomicPointerReplacement: boolean;
  };
  schemas: Record<string, Record<string, unknown>>;
}

export interface ShellPresentationInstance {
  id: string;
  prototypeInstanceId: string;
  parentInstanceId: string | null;
  roleId: string;
  bindingId: string;
  stateFamilyId: string;
  actionId?: string;
  accessibility: ShellAccessibilityContract;
  presentation: ShellDefaultPresentation;
  variants: Record<string, ShellVisualPresentation>;
}

export interface ShellPresentationPage {
  stateId: ShellStateId;
  editorPageId: string;
  instances: ShellPresentationInstance[];
}

export interface ShellPresentationDocument {
  contractId: string;
  contractVersion: string;
  pages: ShellPresentationPage[];
}

export interface ShellAssetProvenance {
  sourceId: string;
  sourceHash: string;
  license: string;
}

export interface ShellAssetCatalogEntry {
  id: string;
  slotId: string;
  path: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  hasAlpha: boolean;
  sha256: string;
  provenance: ShellAssetProvenance;
}

export interface ShellAssetCatalog {
  contractId: string;
  contractVersion: string;
  assets: ShellAssetCatalogEntry[];
}

export interface ShellPublishedRevision {
  contractId: string;
  contractVersion: string;
  publicationId: string;
  projectJsonHash: string;
  portableExportHash: string;
  componentRecordsHash: string;
  assetCatalogHash: string;
  pageCount: 6;
  states: ShellStateId[];
}

export interface ShellProjectionArtifact {
  path: string;
  sha256: string;
  bytes: number;
}

export interface ShellProjectionRevision {
  contractId: string;
  contractVersion: string;
  compatibilityHash: string;
  projectionId: string;
  sourcePublicationId: string;
  revisionPath: string;
  artifacts: ShellProjectionArtifact[];
}

export interface ShellAssetIdentityEntry {
  instanceId: string;
  slotId: string;
  assetId: string;
  path: string;
  sha256: string;
}

export interface ShellAssetIdentityProjection {
  contractId: string;
  contractVersion: string;
  projectionId: string;
  sourcePublicationId: string;
  assets: ShellAssetIdentityEntry[];
}

export interface ShellValidationIssue {
  path: string;
  code: string;
  message: string;
}

export class ShellContractValidationError extends Error {
  readonly issues: readonly ShellValidationIssue[];

  constructor(scope: string, issues: readonly ShellValidationIssue[]) {
    super(`${scope} validation failed:\n${issues.map((issue) => `- ${issue.path}: ${issue.message}`).join('\n')}`);
    this.name = 'ShellContractValidationError';
    this.issues = issues;
  }
}

export interface ProjectShellGeometryOptions {
  anchor: ShellAnchorId;
  geometry: ShellNormalizedGeometry;
  viewport: ShellViewport;
  caps?: ShellGeometryCaps;
  assetSize?: { width: number; height: number };
}

export interface NormalizeShellGeometryOptions {
  anchor: ShellAnchorId;
  bounds: ShellRect;
  viewport: ShellViewport;
  fit: ShellFitMode;
}

export interface ProjectedShellGeometry {
  safeRect: ShellRect;
  bounds: ShellRect;
  contentBounds: ShellRect;
}

type JsonRecord = Record<string, unknown>;
type JsonPrimitive = string | number | boolean | null;
type CanonicalJson = JsonPrimitive | CanonicalJson[] | { [key: string]: CanonicalJson };

const CANONICAL_STATE_IDS = Object.freeze(
  rawShellPresentationContract.states.map((state) => state.id as ShellStateId),
);
const CANONICAL_ANCHORS = Object.freeze(
  Object.fromEntries(
    rawShellPresentationContract.anchors.map((anchor) => [
      anchor.id,
      Object.freeze([anchor.x, anchor.y] as const),
    ]),
  ),
) as Readonly<Record<ShellAnchorId, readonly [number, number]>>;
const CANONICAL_GAME_SCREEN_NAMES = Object.freeze(
  rawShellPresentationContract.gameScreenNames.map((screenName) => screenName as GameScreenName),
);

const HASH_PATTERN = /^sha256-[a-f0-9]{64}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/;
const SEMANTIC_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const SAFE_ASSET_PATH_PATTERN =
  /^assets\/(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp)$/;
const ALLOWED_COLOR_CHANNELS = new Set(['background', 'foreground', 'accent', 'border', 'shadow']);
const VISUAL_FIELDS = new Set([
  'geometry',
  'order',
  'visibility',
  'copy',
  'colors',
  'assetId',
  'opacity',
  'scale',
]);
const FORBIDDEN_PRESENTATION_FIELDS = [
  'css',
  'html',
  'url',
  'href',
  'src',
  'style',
  'attribute',
  'attributes',
  'script',
  'handler',
  'onClick',
  'function',
  'expression',
  'source',
] as const;
const MAX_VALIDATION_ISSUES = 256;
const MAX_COLLECTION_ITEMS = 4_096;
const MAX_CANONICAL_DEPTH = 128;
const MAX_CANONICAL_NODES = 100_000;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function addIssue(
  issues: ShellValidationIssue[],
  path: string,
  code: string,
  message: string,
): void {
  if (issues.length >= MAX_VALIDATION_ISSUES) return;
  if (issues.length === MAX_VALIDATION_ISSUES - 1) {
    issues.push({
      path: '$',
      code: 'too-many-issues',
      message: `Validation stopped after ${MAX_VALIDATION_ISSUES - 1} issues.`,
    });
    return;
  }
  issues.push({ path, code, message });
}

function asRecord(
  value: unknown,
  path: string,
  issues: ShellValidationIssue[],
): JsonRecord | undefined {
  if (!isRecord(value)) {
    addIssue(issues, path, 'invalid-type', 'Expected an object.');
    return undefined;
  }
  return value;
}

function asRecordArray(
  value: unknown,
  path: string,
  issues: ShellValidationIssue[],
): JsonRecord[] {
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'invalid-type', 'Expected an array.');
    return [];
  }
  const result: JsonRecord[] = [];
  if (value.length > MAX_COLLECTION_ITEMS) {
    addIssue(
      issues,
      path,
      'collection-too-large',
      `Collections may contain at most ${MAX_COLLECTION_ITEMS} items.`,
    );
  }
  value.slice(0, MAX_COLLECTION_ITEMS).forEach((item, index) => {
    if (isRecord(item)) result.push(item);
    else addIssue(issues, `${path}[${index}]`, 'invalid-type', 'Expected an object.');
  });
  return result;
}

function asStringArray(
  value: unknown,
  path: string,
  issues: ShellValidationIssue[],
): string[] {
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'invalid-type', 'Expected an array of strings.');
    return [];
  }
  const result: string[] = [];
  if (value.length > MAX_COLLECTION_ITEMS) {
    addIssue(
      issues,
      path,
      'collection-too-large',
      `Collections may contain at most ${MAX_COLLECTION_ITEMS} items.`,
    );
  }
  value.slice(0, MAX_COLLECTION_ITEMS).forEach((item, index) => {
    if (typeof item === 'string') result.push(item);
    else addIssue(issues, `${path}[${index}]`, 'invalid-type', 'Expected a string.');
  });
  return result;
}

function stringField(
  record: JsonRecord,
  key: string,
  path: string,
  issues: ShellValidationIssue[],
): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    addIssue(issues, `${path}.${key}`, 'missing-field', `Expected non-empty string field "${key}".`);
    return '';
  }
  return value;
}

function numberField(
  record: JsonRecord,
  key: string,
  path: string,
  issues: ShellValidationIssue[],
): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    addIssue(issues, `${path}.${key}`, 'invalid-number', `Field "${key}" must be finite.`);
    return Number.NaN;
  }
  return value;
}

function booleanField(
  record: JsonRecord,
  key: string,
  path: string,
  issues: ShellValidationIssue[],
): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    addIssue(issues, `${path}.${key}`, 'invalid-type', `Field "${key}" must be boolean.`);
    return false;
  }
  return value;
}

function rejectUnsupportedFields(
  record: JsonRecord,
  allowed: ReadonlySet<string>,
  path: string,
  issues: ShellValidationIssue[],
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      addIssue(issues, `${path}.${key}`, 'unsupported-field', `Unsupported field "${key}".`);
    }
  }
}

function validateUniqueIds(
  records: readonly JsonRecord[],
  path: string,
  issues: ShellValidationIssue[],
): Set<string> {
  const ids = new Set<string>();
  records.forEach((record, index) => {
    const id = stringField(record, 'id', `${path}[${index}]`, issues);
    if (id && ids.has(id)) {
      addIssue(issues, `${path}[${index}].id`, 'duplicate-id', `Duplicate ID "${id}".`);
    }
    if (id) ids.add(id);
  });
  return ids;
}

function validateNeutralId(
  id: string,
  path: string,
  pattern: RegExp,
  forbiddenTokens: ReadonlySet<string>,
  issues: ShellValidationIssue[],
): void {
  const tokens = id.split(/[.-]/u);
  if (!pattern.test(id)) {
    addIssue(issues, path, 'invalid-id', `ID "${id}" does not match the contract ID grammar.`);
  }
  const forbidden = tokens.find((token) => forbiddenTokens.has(token));
  if (forbidden) {
    addIssue(
      issues,
      path,
      'non-neutral-id',
      `ID "${id}" contains theme-specific token "${forbidden}".`,
    );
  }
}

function validateExactKeys(
  actual: readonly string[],
  expected: readonly string[],
  path: string,
  code: string,
  label: string,
  issues: ShellValidationIssue[],
): void {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  for (const value of expected) {
    if (!actualSet.has(value)) {
      addIssue(issues, path, code, `Missing required ${label} "${value}".`);
    }
  }
  for (const value of actual) {
    if (!expectedSet.has(value)) {
      addIssue(issues, path, `unknown-${label}`, `Unknown ${label} "${value}".`);
    }
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function rounded(value: number): number {
  return Number(value.toFixed(10));
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative number.`);
  }
}

function assertGeometryCaps(caps: ShellGeometryCaps, label: string): void {
  assertFiniteNonNegative(caps.minWidth, `${label}.minWidth`);
  assertFiniteNonNegative(caps.maxWidth, `${label}.maxWidth`);
  assertFiniteNonNegative(caps.minHeight, `${label}.minHeight`);
  assertFiniteNonNegative(caps.maxHeight, `${label}.maxHeight`);
  if (caps.maxWidth < caps.minWidth || caps.maxHeight < caps.minHeight) {
    throw new RangeError(`${label} minimums must not exceed maximums.`);
  }
}

function safeRectForViewport(viewport: ShellViewport): ShellRect {
  assertFiniteNonNegative(viewport.width, 'viewport.width');
  assertFiniteNonNegative(viewport.height, 'viewport.height');
  assertFiniteNonNegative(viewport.insets.top, 'viewport.insets.top');
  assertFiniteNonNegative(viewport.insets.right, 'viewport.insets.right');
  assertFiniteNonNegative(viewport.insets.bottom, 'viewport.insets.bottom');
  assertFiniteNonNegative(viewport.insets.left, 'viewport.insets.left');

  const width = viewport.width - viewport.insets.left - viewport.insets.right;
  const height = viewport.height - viewport.insets.top - viewport.insets.bottom;
  if (width <= 0 || height <= 0) {
    throw new RangeError('Runtime insets must leave a positive safe rectangle.');
  }
  return {
    x: viewport.insets.left,
    y: viewport.insets.top,
    width,
    height,
  };
}

function fitContent(bounds: ShellRect, fit: ShellFitMode, assetSize?: { width: number; height: number }): ShellRect {
  if (!assetSize) return { ...bounds };
  if (
    !Number.isFinite(assetSize.width) ||
    !Number.isFinite(assetSize.height) ||
    assetSize.width <= 0 ||
    assetSize.height <= 0
  ) {
    throw new RangeError('assetSize must contain positive finite dimensions.');
  }
  const scale =
    fit === 'contain'
      ? Math.min(bounds.width / assetSize.width, bounds.height / assetSize.height)
      : Math.max(bounds.width / assetSize.width, bounds.height / assetSize.height);
  const width = assetSize.width * scale;
  const height = assetSize.height * scale;
  return {
    x: rounded(bounds.x + (bounds.width - width) / 2),
    y: rounded(bounds.y + (bounds.height - height) / 2),
    width: rounded(width),
    height: rounded(height),
  };
}

export function projectShellGeometry(options: ProjectShellGeometryOptions): ProjectedShellGeometry {
  const anchor = CANONICAL_ANCHORS[options.anchor];
  if (!anchor) throw new RangeError(`Unsupported shell anchor "${String(options.anchor)}".`);
  const { geometry } = options;
  for (const [label, value] of [
    ['geometry.offset.x', geometry.offset.x],
    ['geometry.offset.y', geometry.offset.y],
    ['geometry.size.width', geometry.size.width],
    ['geometry.size.height', geometry.size.height],
  ] as const) {
    if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
  }
  if (geometry.offset.x < -1 || geometry.offset.x > 1 || geometry.offset.y < -1 || geometry.offset.y > 1) {
    throw new RangeError('Normalized geometry offsets must be between -1 and 1.');
  }
  if (
    geometry.size.width <= 0 ||
    geometry.size.width > 1 ||
    geometry.size.height <= 0 ||
    geometry.size.height > 1
  ) {
    throw new RangeError('Normalized geometry size must be greater than 0 and at most 1.');
  }
  if (geometry.fit !== 'contain' && geometry.fit !== 'cover') {
    throw new RangeError(`Unsupported fit mode "${String(geometry.fit)}".`);
  }

  const safeRect = safeRectForViewport(options.viewport);
  let width = geometry.size.width * safeRect.width;
  let height = geometry.size.height * safeRect.height;
  if (options.caps) {
    assertGeometryCaps(options.caps, 'caps');
    width = clamp(width, options.caps.minWidth, options.caps.maxWidth);
    height = clamp(height, options.caps.minHeight, options.caps.maxHeight);
  }

  const x =
    safeRect.x +
    anchor[0] * safeRect.width +
    geometry.offset.x * safeRect.width -
    anchor[0] * width;
  const y =
    safeRect.y +
    anchor[1] * safeRect.height +
    geometry.offset.y * safeRect.height -
    anchor[1] * height;
  const bounds = {
    x: rounded(x),
    y: rounded(y),
    width: rounded(width),
    height: rounded(height),
  };
  return {
    safeRect: {
      x: rounded(safeRect.x),
      y: rounded(safeRect.y),
      width: rounded(safeRect.width),
      height: rounded(safeRect.height),
    },
    bounds,
    contentBounds: fitContent(bounds, geometry.fit, options.assetSize),
  };
}

export function normalizeShellGeometry(options: NormalizeShellGeometryOptions): ShellNormalizedGeometry {
  const anchor = CANONICAL_ANCHORS[options.anchor];
  if (!anchor) throw new RangeError(`Unsupported shell anchor "${String(options.anchor)}".`);
  const safeRect = safeRectForViewport(options.viewport);
  for (const [label, value] of [
    ['bounds.x', options.bounds.x],
    ['bounds.y', options.bounds.y],
    ['bounds.width', options.bounds.width],
    ['bounds.height', options.bounds.height],
  ] as const) {
    if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
  }
  if (options.bounds.width <= 0 || options.bounds.height <= 0) {
    throw new RangeError('Authored bounds must have positive width and height.');
  }
  if (options.fit !== 'contain' && options.fit !== 'cover') {
    throw new RangeError(`Unsupported fit mode "${String(options.fit)}".`);
  }
  const elementAnchorX = options.bounds.x + anchor[0] * options.bounds.width;
  const elementAnchorY = options.bounds.y + anchor[1] * options.bounds.height;
  const safeAnchorX = safeRect.x + anchor[0] * safeRect.width;
  const safeAnchorY = safeRect.y + anchor[1] * safeRect.height;
  const geometry: ShellNormalizedGeometry = {
    offset: {
      x: rounded((elementAnchorX - safeAnchorX) / safeRect.width),
      y: rounded((elementAnchorY - safeAnchorY) / safeRect.height),
    },
    size: {
      width: rounded(options.bounds.width / safeRect.width),
      height: rounded(options.bounds.height / safeRect.height),
    },
    fit: options.fit,
  };
  projectShellGeometry({ anchor: options.anchor, geometry, viewport: options.viewport });
  return geometry;
}

function isRectInside(inner: ShellRect, outer: ShellRect): boolean {
  const epsilon = 1e-8;
  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    inner.x + inner.width <= outer.x + outer.width + epsilon &&
    inner.y + inner.height <= outer.y + outer.height + epsilon
  );
}

interface CanonicalBudget {
  nodes: number;
}

function canonicalValue(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
  depth: number,
  budget: CanonicalBudget,
): CanonicalJson {
  if (depth > MAX_CANONICAL_DEPTH) {
    throw new TypeError(`${path} exceeds the maximum JSON nesting depth of ${MAX_CANONICAL_DEPTH}.`);
  }
  budget.nodes += 1;
  if (budget.nodes > MAX_CANONICAL_NODES) {
    throw new TypeError(`JSON input exceeds the maximum node count of ${MAX_CANONICAL_NODES}.`);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain only finite numbers.`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') {
    throw new TypeError(`${path} contains a non-JSON value.`);
  }
  if (seen.has(value)) throw new TypeError(`${path} contains a cycle.`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) =>
        canonicalValue(item, `${path}[${index}]`, seen, depth + 1, budget),
      );
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must contain only plain JSON objects.`);
    }
    const result = Object.create(null) as { [key: string]: CanonicalJson };
    for (const key of Object.keys(value).sort()) {
      result[key] = canonicalValue(
        (value as JsonRecord)[key],
        `${path}.${key}`,
        seen,
        depth + 1,
        budget,
      );
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value, '$', new WeakSet<object>(), 0, { nodes: 0 }));
}

export async function hashCanonicalJson(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('SHA-256 hashing requires the standard Web Crypto API.');
  }
  const bytes = new TextEncoder().encode(canonicalizeJson(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256-${hex}`;
}

export async function computeShellPublicationId(
  revision: Omit<ShellPublishedRevision, 'publicationId'>,
): Promise<string> {
  const fields = Object.create(null) as JsonRecord;
  const source = revision as unknown as JsonRecord;
  for (const field of shellPresentationContract.publication.publicationIdFields) {
    fields[field] = source[field];
  }
  return hashCanonicalJson({
    domain: shellPresentationContract.publication.publicationIdDomain,
    ...fields,
  });
}

export async function computeShellProjectionId(
  revision: Omit<ShellProjectionRevision, 'projectionId' | 'revisionPath'>,
): Promise<string> {
  const fields = Object.create(null) as JsonRecord;
  const source = revision as unknown as JsonRecord;
  for (const field of shellPresentationContract.projection.projectionIdFields) {
    fields[field] = source[field];
  }
  return hashCanonicalJson({
    domain: shellPresentationContract.projection.projectionIdDomain,
    ...fields,
  });
}

function validateGeometryCaps(
  value: unknown,
  path: string,
  issues: ShellValidationIssue[],
): ShellGeometryCaps | undefined {
  const record = asRecord(value, path, issues);
  if (!record) return undefined;
  rejectUnsupportedFields(
    record,
    new Set(['minWidth', 'maxWidth', 'minHeight', 'maxHeight']),
    path,
    issues,
  );
  const caps = {
    minWidth: numberField(record, 'minWidth', path, issues),
    maxWidth: numberField(record, 'maxWidth', path, issues),
    minHeight: numberField(record, 'minHeight', path, issues),
    maxHeight: numberField(record, 'maxHeight', path, issues),
  };
  if (
    caps.minWidth < 0 ||
    caps.minHeight < 0 ||
    caps.maxWidth < caps.minWidth ||
    caps.maxHeight < caps.minHeight
  ) {
    addIssue(issues, path, 'invalid-geometry', 'Geometry caps must be ordered, finite, and non-negative.');
  }
  return caps;
}

function validateNormalizedGeometry(
  value: unknown,
  path: string,
  issues: ShellValidationIssue[],
): ShellNormalizedGeometry | undefined {
  const geometry = asRecord(value, path, issues);
  if (!geometry) return undefined;
  rejectUnsupportedFields(geometry, new Set(['offset', 'size', 'fit']), path, issues);
  const offset = asRecord(geometry.offset, `${path}.offset`, issues);
  const size = asRecord(geometry.size, `${path}.size`, issues);
  if (!offset || !size) return undefined;
  rejectUnsupportedFields(offset, new Set(['x', 'y']), `${path}.offset`, issues);
  rejectUnsupportedFields(size, new Set(['width', 'height']), `${path}.size`, issues);
  const result: ShellNormalizedGeometry = {
    offset: {
      x: numberField(offset, 'x', `${path}.offset`, issues),
      y: numberField(offset, 'y', `${path}.offset`, issues),
    },
    size: {
      width: numberField(size, 'width', `${path}.size`, issues),
      height: numberField(size, 'height', `${path}.size`, issues),
    },
    fit:
      geometry.fit === 'contain' || geometry.fit === 'cover'
        ? geometry.fit
        : (String(geometry.fit) as ShellFitMode),
  };
  if (
    result.offset.x < -1 ||
    result.offset.x > 1 ||
    result.offset.y < -1 ||
    result.offset.y > 1 ||
    result.size.width <= 0 ||
    result.size.width > 1 ||
    result.size.height <= 0 ||
    result.size.height > 1 ||
    (result.fit !== 'contain' && result.fit !== 'cover')
  ) {
    addIssue(
      issues,
      path,
      'invalid-geometry',
      'Geometry requires finite offsets in [-1, 1], sizes in (0, 1], and contain/cover fit.',
    );
  }
  return result;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function isPlainUnicodeCopy(value: string, maximumCodePoints: number): boolean {
  const htmlFragment = /<\/?[a-z][^>]*>/iu;
  const unsafeScheme = /(?:javascript|data|blob)\s*:/iu;
  const hasForbiddenControl = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)!;
    return (codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13) || codePoint === 127;
  });
  return (
    Array.from(value).length <= maximumCodePoints &&
    !hasForbiddenControl &&
    !htmlFragment.test(value) &&
    !unsafeScheme.test(value) &&
    !hasUnpairedSurrogate(value)
  );
}

interface VisualValidationOptions {
  requireBase: boolean;
  allowedProperties?: ReadonlySet<string>;
  knownAssetIds?: ReadonlySet<string>;
  maximumCopyCodePoints?: number;
}

function validateVisualPresentation(
  value: unknown,
  path: string,
  issues: ShellValidationIssue[],
  options: VisualValidationOptions,
): ShellVisualPresentation | undefined {
  const visual = asRecord(value, path, issues);
  if (!visual) return undefined;
  rejectUnsupportedFields(visual, VISUAL_FIELDS, path, issues);

  if (options.requireBase) {
    for (const field of ['geometry', 'order', 'visibility']) {
      if (!(field in visual)) {
        addIssue(issues, `${path}.${field}`, 'missing-field', `Missing required presentation field "${field}".`);
      }
    }
  }

  if (options.allowedProperties) {
    for (const field of Object.keys(visual)) {
      if (!options.allowedProperties.has(field) && field !== 'opacity' && field !== 'scale') {
        addIssue(
          issues,
          `${path}.${field}`,
          'unsupported-field',
          `Role does not allow editable property "${field}".`,
        );
      }
    }
  }

  if ('geometry' in visual) validateNormalizedGeometry(visual.geometry, `${path}.geometry`, issues);
  if ('order' in visual) {
    const order = visual.order;
    if (typeof order !== 'number' || !Number.isInteger(order) || order < 0 || order > 255) {
      addIssue(issues, `${path}.order`, 'invalid-number', 'Order must be an integer between 0 and 255.');
    }
  }
  if ('visibility' in visual && visual.visibility !== 'visible' && visual.visibility !== 'hidden') {
    addIssue(
      issues,
      `${path}.visibility`,
      'invalid-enum',
      'Visibility must be "visible" or "hidden".',
    );
  }
  if ('copy' in visual) {
    if (
      typeof visual.copy !== 'string' ||
      !isPlainUnicodeCopy(visual.copy, options.maximumCopyCodePoints ?? 512)
    ) {
      addIssue(
        issues,
        `${path}.copy`,
        'unsafe-copy',
        'Copy must be plain Unicode copy without markup, active schemes, controls, or invalid Unicode.',
      );
    }
  }
  if ('colors' in visual) {
    const colors = asRecord(visual.colors, `${path}.colors`, issues);
    if (colors) {
      for (const [channel, color] of Object.entries(colors)) {
        if (!ALLOWED_COLOR_CHANNELS.has(channel)) {
          addIssue(issues, `${path}.colors.${channel}`, 'unsupported-field', `Unsupported color channel "${channel}".`);
        }
        if (typeof color !== 'string' || !COLOR_PATTERN.test(color)) {
          addIssue(
            issues,
            `${path}.colors.${channel}`,
            'invalid-color',
            'Colors must use #RRGGBB or #RRGGBBAA.',
          );
        }
      }
    }
  }
  if ('assetId' in visual) {
    const assetId = visual.assetId;
    if (typeof assetId !== 'string' || !SEMANTIC_ID_PATTERN.test(assetId)) {
      addIssue(
        issues,
        `${path}.assetId`,
        'unsafe-asset',
        'Asset references must be semantic local raster asset IDs.',
      );
    } else if (!options.knownAssetIds?.has(assetId)) {
      addIssue(issues, `${path}.assetId`, 'unknown-asset', `Unknown local raster asset ID "${assetId}".`);
    }
  }
  for (const field of ['opacity', 'scale'] as const) {
    if (field in visual) {
      const value = visual[field];
      const minimum = field === 'opacity' ? 0 : 0.5;
      const maximum = field === 'opacity' ? 1 : 2;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
        addIssue(
          issues,
          `${path}.${field}`,
          'invalid-number',
          `${field} must be a finite number between ${minimum} and ${maximum}.`,
        );
      }
    }
  }
  return visual as ShellVisualPresentation;
}

function validateAccessibility(
  value: unknown,
  path: string,
  issues: ShellValidationIssue[],
): ShellAccessibilityContract | undefined {
  const accessibility = asRecord(value, path, issues);
  if (!accessibility) {
    addIssue(issues, path, 'missing-accessibility', 'Every semantic instance requires accessibility metadata.');
    return undefined;
  }
  rejectUnsupportedFields(
    accessibility,
    new Set(['role', 'nameKey', 'stateSemantics', 'traversalGroup']),
    path,
    issues,
  );
  const result = {
    role: stringField(accessibility, 'role', path, issues),
    nameKey: stringField(accessibility, 'nameKey', path, issues),
    stateSemantics: asStringArray(accessibility.stateSemantics, `${path}.stateSemantics`, issues),
    traversalGroup: stringField(accessibility, 'traversalGroup', path, issues),
  };
  const allowedSemantics = new Set(['checked', 'current', 'disabled', 'pressed', 'selected']);
  if (new Set(result.stateSemantics).size !== result.stateSemantics.length) {
    addIssue(
      issues,
      `${path}.stateSemantics`,
      'duplicate-id',
      'Accessibility state semantics must be unique.',
    );
  }
  for (const semantic of result.stateSemantics) {
    if (!allowedSemantics.has(semantic)) {
      addIssue(
        issues,
        `${path}.stateSemantics`,
        'invalid-accessibility',
        `Unknown accessibility state semantic "${semantic}".`,
      );
    }
  }
  return result;
}

function parseRegExp(
  pattern: unknown,
  path: string,
  fallback: RegExp,
  issues: ShellValidationIssue[],
): RegExp {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    addIssue(issues, path, 'invalid-pattern', 'Expected a non-empty regular expression pattern.');
    return fallback;
  }
  try {
    return new RegExp(pattern, 'u');
  } catch {
    addIssue(issues, path, 'invalid-pattern', 'Regular expression pattern is invalid.');
    return fallback;
  }
}

function validateEditableAst(value: unknown, issues: ShellValidationIssue[]): void {
  const path = '$.editableAst';
  const ast = asRecord(value, path, issues);
  if (!ast) return;
  rejectUnsupportedFields(
    ast,
    new Set([
      'astVersion',
      'numberBounds',
      'enums',
      'colorFormats',
      'copy',
      'assetIds',
      'allowedPresentationFields',
      'forbiddenFields',
    ]),
    path,
    issues,
  );
  if (numberField(ast, 'astVersion', path, issues) !== 1) {
    addIssue(issues, `${path}.astVersion`, 'invalid-version', 'V1 requires editable AST version 1.');
  }

  const numberBounds = asRecord(ast.numberBounds, `${path}.numberBounds`, issues);
  const expectedBounds: Record<string, JsonRecord> = {
    offset: { minimum: -1, maximum: 1 },
    normalizedSize: { minimumExclusive: 0, maximum: 1 },
    order: { minimum: 0, maximum: 255, integer: true },
    opacity: { minimum: 0, maximum: 1 },
    scale: { minimum: 0.5, maximum: 2 },
  };
  if (numberBounds) {
    validateExactKeys(
      Object.keys(numberBounds),
      Object.keys(expectedBounds),
      `${path}.numberBounds`,
      'missing-bound',
      'bound',
      issues,
    );
    for (const [key, expected] of Object.entries(expectedBounds)) {
      const actual = asRecord(numberBounds[key], `${path}.numberBounds.${key}`, issues);
      if (actual && !sameSemanticValue(actual, expected)) {
        addIssue(
          issues,
          `${path}.numberBounds.${key}`,
          'invalid-bound',
          `Editable number bound "${key}" does not match V1.`,
        );
      }
    }
  }

  const enums = asRecord(ast.enums, `${path}.enums`, issues);
  if (enums) {
    rejectUnsupportedFields(enums, new Set(['visibility', 'fit']), `${path}.enums`, issues);
    if (
      !sameSemanticValue(
        asStringArray(enums.visibility, `${path}.enums.visibility`, issues),
        ['visible', 'hidden'],
      )
    ) {
      addIssue(issues, `${path}.enums.visibility`, 'invalid-enum', 'Visibility enum does not match V1.');
    }
    if (
      !sameSemanticValue(
        asStringArray(enums.fit, `${path}.enums.fit`, issues),
        ['contain', 'cover'],
      )
    ) {
      addIssue(issues, `${path}.enums.fit`, 'invalid-enum', 'Fit enum does not match V1.');
    }
  }

  if (!sameSemanticValue(asStringArray(ast.colorFormats, `${path}.colorFormats`, issues), ['#RRGGBB', '#RRGGBBAA'])) {
    addIssue(issues, `${path}.colorFormats`, 'invalid-color', 'Color formats do not match V1.');
  }
  const copy = asRecord(ast.copy, `${path}.copy`, issues);
  if (copy) {
    rejectUnsupportedFields(copy, new Set(['maximumCodePoints', 'allowNewlines']), `${path}.copy`, issues);
    const maximumCodePoints = numberField(copy, 'maximumCodePoints', `${path}.copy`, issues);
    if (!Number.isInteger(maximumCodePoints) || maximumCodePoints < 1) {
      addIssue(issues, `${path}.copy.maximumCodePoints`, 'invalid-number', 'Copy limit must be a positive integer.');
    }
    if (booleanField(copy, 'allowNewlines', `${path}.copy`, issues) !== true) {
      addIssue(issues, `${path}.copy.allowNewlines`, 'invalid-enum', 'V1 plain copy allows newlines.');
    }
  }
  const assetIds = asRecord(ast.assetIds, `${path}.assetIds`, issues);
  if (assetIds) {
    rejectUnsupportedFields(assetIds, new Set(['pattern', 'mustExistInPublicationCatalog']), `${path}.assetIds`, issues);
    if (stringField(assetIds, 'pattern', `${path}.assetIds`, issues) !== SEMANTIC_ID_PATTERN.source) {
      addIssue(issues, `${path}.assetIds.pattern`, 'invalid-pattern', 'Asset ID pattern does not match V1.');
    }
    if (booleanField(assetIds, 'mustExistInPublicationCatalog', `${path}.assetIds`, issues) !== true) {
      addIssue(issues, `${path}.assetIds.mustExistInPublicationCatalog`, 'unsafe-asset', 'Asset IDs must resolve through the publication catalog.');
    }
  }
  validateExactKeys(
    asStringArray(ast.allowedPresentationFields, `${path}.allowedPresentationFields`, issues),
    [...VISUAL_FIELDS],
    `${path}.allowedPresentationFields`,
    'missing-field',
    'presentation-field',
    issues,
  );
  validateExactKeys(
    asStringArray(ast.forbiddenFields, `${path}.forbiddenFields`, issues),
    [...FORBIDDEN_PRESENTATION_FIELDS],
    `${path}.forbiddenFields`,
    'missing-field',
    'forbidden-field',
    issues,
  );
}

export function parseShellPresentationContract(value: unknown): ShellPresentationContract {
  const issues: ShellValidationIssue[] = [];
  const root = asRecord(value, '$', issues);
  if (!root) throw new ShellContractValidationError('Shell presentation contract', issues);
  rejectUnsupportedFields(
    root,
    new Set([
      'contractId',
      'contractVersion',
      'schemaDialect',
      'compatibility',
      'canonicalCanvas',
      'anchors',
      'gameScreenNames',
      'states',
      'bindings',
      'stateFamilies',
      'assetSlots',
      'roles',
      'instances',
      'requiredActions',
      'editableAst',
      'neutralIdPolicy',
      'publication',
      'projection',
      'schemas',
    ]),
    '$',
    issues,
  );

  const contractId = stringField(root, 'contractId', '$', issues);
  const contractVersion = stringField(root, 'contractVersion', '$', issues);
  const schemaDialect = stringField(root, 'schemaDialect', '$', issues);
  if (!/^shell-presentation-v[1-9][0-9]*$/u.test(contractId)) {
    addIssue(issues, '$.contractId', 'invalid-id', 'Contract ID must use shell-presentation-vN.');
  }
  if (!/^\d+\.\d+\.\d+$/u.test(contractVersion)) {
    addIssue(issues, '$.contractVersion', 'invalid-version', 'Contract version must be semantic x.y.z.');
  }
  if (schemaDialect !== 'https://json-schema.org/draft/2020-12/schema') {
    addIssue(issues, '$.schemaDialect', 'invalid-schema', 'V1 schemas must use JSON Schema draft 2020-12.');
  }

  const neutralPolicy = asRecord(root.neutralIdPolicy, '$.neutralIdPolicy', issues) ?? {};
  rejectUnsupportedFields(
    neutralPolicy,
    new Set(['pattern', 'forbiddenTokens']),
    '$.neutralIdPolicy',
    issues,
  );
  const neutralPattern = parseRegExp(
    neutralPolicy.pattern,
    '$.neutralIdPolicy.pattern',
    SEMANTIC_ID_PATTERN,
    issues,
  );
  const forbiddenTokens = new Set(
    asStringArray(neutralPolicy.forbiddenTokens, '$.neutralIdPolicy.forbiddenTokens', issues),
  );

  const compatibility = asRecord(root.compatibility, '$.compatibility', issues);
  if (compatibility) {
    rejectUnsupportedFields(
      compatibility,
      new Set(['compatibilityId', 'minimumReaderVersion', 'canonicalization', 'hashAlgorithm']),
      '$.compatibility',
      issues,
    );
    const compatibilityId = stringField(compatibility, 'compatibilityId', '$.compatibility', issues);
    const minimumReaderVersion = stringField(
      compatibility,
      'minimumReaderVersion',
      '$.compatibility',
      issues,
    );
    if (compatibilityId !== contractId) {
      addIssue(
        issues,
        '$.compatibility.compatibilityId',
        'compatibility-mismatch',
        'Compatibility ID must equal the contract ID.',
      );
    }
    if (compatibility.hashAlgorithm !== 'sha256') {
      addIssue(issues, '$.compatibility.hashAlgorithm', 'unsupported-hash', 'Only sha256 is supported.');
    }
    if (compatibility.canonicalization !== 'json-lexicographic-v1') {
      addIssue(
        issues,
        '$.compatibility.canonicalization',
        'unsupported-canonicalization',
        'Only json-lexicographic-v1 is supported.',
      );
    }
    if (!/^\d+\.\d+\.\d+$/u.test(minimumReaderVersion)) {
      addIssue(
        issues,
        '$.compatibility.minimumReaderVersion',
        'invalid-version',
        'Minimum reader version must be semantic x.y.z.',
      );
    }
  }

  const canvas = asRecord(root.canonicalCanvas, '$.canonicalCanvas', issues);
  if (canvas) {
    rejectUnsupportedFields(
      canvas,
      new Set(['width', 'height', 'baselineInsets', 'baselineSafeRect', 'minimumActionSize']),
      '$.canonicalCanvas',
      issues,
    );
    const width = numberField(canvas, 'width', '$.canonicalCanvas', issues);
    const height = numberField(canvas, 'height', '$.canonicalCanvas', issues);
    const minimumActionSize = numberField(canvas, 'minimumActionSize', '$.canonicalCanvas', issues);
    const insets = asRecord(canvas.baselineInsets, '$.canonicalCanvas.baselineInsets', issues);
    const rect = asRecord(canvas.baselineSafeRect, '$.canonicalCanvas.baselineSafeRect', issues);
    if (insets) {
      rejectUnsupportedFields(
        insets,
        new Set(['top', 'right', 'bottom', 'left']),
        '$.canonicalCanvas.baselineInsets',
        issues,
      );
    }
    if (rect) {
      rejectUnsupportedFields(
        rect,
        new Set(['x', 'y', 'width', 'height']),
        '$.canonicalCanvas.baselineSafeRect',
        issues,
      );
    }
    if (width !== 390 || height !== 844 || minimumActionSize !== 48) {
      addIssue(
        issues,
        '$.canonicalCanvas',
        'invalid-canvas',
        'V1 requires a 390x844 canvas and a 48 px minimum action size.',
      );
    }
    if (insets && rect) {
      const top = numberField(insets, 'top', '$.canonicalCanvas.baselineInsets', issues);
      const right = numberField(insets, 'right', '$.canonicalCanvas.baselineInsets', issues);
      const bottom = numberField(insets, 'bottom', '$.canonicalCanvas.baselineInsets', issues);
      const left = numberField(insets, 'left', '$.canonicalCanvas.baselineInsets', issues);
      const expectedRect = { x: left, y: top, width: width - left - right, height: height - top - bottom };
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        if (numberField(rect, key, '$.canonicalCanvas.baselineSafeRect', issues) !== expectedRect[key]) {
          addIssue(
            issues,
            `$.canonicalCanvas.baselineSafeRect.${key}`,
            'invalid-canvas',
            'Baseline safe rectangle must be derived from the canonical canvas and insets.',
          );
        }
      }
    }
  }

  const anchors = asRecordArray(root.anchors, '$.anchors', issues);
  const anchorIds = validateUniqueIds(anchors, '$.anchors', issues);
  validateExactKeys([...anchorIds], Object.keys(CANONICAL_ANCHORS), '$.anchors', 'missing-anchor', 'anchor', issues);
  anchors.forEach((anchor, index) => {
    rejectUnsupportedFields(anchor, new Set(['id', 'x', 'y']), `$.anchors[${index}]`, issues);
    const id = anchor.id as ShellAnchorId;
    const expected = CANONICAL_ANCHORS[id];
    if (expected) {
      const x = numberField(anchor, 'x', `$.anchors[${index}]`, issues);
      const y = numberField(anchor, 'y', `$.anchors[${index}]`, issues);
      if (x !== expected[0] || y !== expected[1]) {
        addIssue(
          issues,
          `$.anchors[${index}]`,
          'invalid-anchor',
          `Anchor "${id}" must use coordinates ${expected[0]}, ${expected[1]}.`,
        );
      }
    }
  });

  const screenNameList = asStringArray(root.gameScreenNames, '$.gameScreenNames', issues);
  validateExactKeys(
    screenNameList,
    CANONICAL_GAME_SCREEN_NAMES,
    '$.gameScreenNames',
    'missing-screen',
    'screen',
    issues,
  );
  if (new Set(screenNameList).size !== screenNameList.length) {
    addIssue(issues, '$.gameScreenNames', 'duplicate-id', 'GameScreenName values must be unique.');
  }
  const screenNames = new Set(screenNameList);
  const states = asRecordArray(root.states, '$.states', issues);
  const stateIds = validateUniqueIds(states, '$.states', issues);
  validateExactKeys([...stateIds], CANONICAL_STATE_IDS, '$.states', 'missing-state', 'state', issues);
  const pageIds = new Set<string>();
  states.forEach((state, index) => {
    const path = `$.states[${index}]`;
    rejectUnsupportedFields(
      state,
      new Set(['id', 'editorPageId', 'label', 'gameScreenNames']),
      path,
      issues,
    );
    const pageId = stringField(state, 'editorPageId', path, issues);
    if (pageIds.has(pageId)) addIssue(issues, `${path}.editorPageId`, 'duplicate-id', `Duplicate page ID "${pageId}".`);
    pageIds.add(pageId);
    stringField(state, 'label', path, issues);
    for (const screenName of asStringArray(state.gameScreenNames, `${path}.gameScreenNames`, issues)) {
      if (!screenNames.has(screenName)) {
        addIssue(issues, `${path}.gameScreenNames`, 'unknown-screen', `Unknown GameScreenName "${screenName}".`);
      }
    }
  });

  const bindings = asRecordArray(root.bindings, '$.bindings', issues);
  const bindingIds = validateUniqueIds(bindings, '$.bindings', issues);
  const bindingKinds = new Set(['static', 'region', 'read', 'action', 'toggle']);
  const bindingKindsById = new Map<string, string>();
  bindings.forEach((binding, index) => {
    rejectUnsupportedFields(binding, new Set(['id', 'kind']), `$.bindings[${index}]`, issues);
    bindingKindsById.set(String(binding.id), String(binding.kind));
    if (!bindingKinds.has(String(binding.kind))) {
      addIssue(issues, `$.bindings[${index}].kind`, 'invalid-enum', `Unknown binding kind "${String(binding.kind)}".`);
    }
  });

  const families = asRecordArray(root.stateFamilies, '$.stateFamilies', issues);
  const familyIds = validateUniqueIds(families, '$.stateFamilies', issues);
  families.forEach((family, index) => {
    const path = `$.stateFamilies[${index}]`;
    rejectUnsupportedFields(
      family,
      new Set(['id', 'requiredVariants', 'base', 'variants']),
      path,
      issues,
    );
    const requiredVariants = asStringArray(family.requiredVariants, `${path}.requiredVariants`, issues);
    if (new Set(requiredVariants).size !== requiredVariants.length) {
      addIssue(issues, `${path}.requiredVariants`, 'duplicate-id', 'Required variants must be unique.');
    }
    const variants = asRecord(family.variants, `${path}.variants`, issues);
    validateVisualPresentation(family.base, `${path}.base`, issues, { requireBase: false });
    if (variants) {
      validateExactKeys(
        Object.keys(variants),
        requiredVariants,
        `${path}.variants`,
        'missing-variant',
        'variant',
        issues,
      );
      for (const [variant, visual] of Object.entries(variants)) {
        validateVisualPresentation(visual, `${path}.variants.${variant}`, issues, { requireBase: false });
      }
    }
    if (requiredVariants.length === 0) {
      addIssue(issues, `${path}.requiredVariants`, 'missing-variant', 'A state family needs named variants.');
    }
  });

  const slots = asRecordArray(root.assetSlots, '$.assetSlots', issues);
  const slotIds = validateUniqueIds(slots, '$.assetSlots', issues);
  slots.forEach((slot, index) => {
    const path = `$.assetSlots[${index}]`;
    rejectUnsupportedFields(
      slot,
      new Set(['id', 'fit', 'compatibleRoleIds', 'geometry', 'alpha', 'provenanceRequired', 'mimeTypes']),
      path,
      issues,
    );
    if (slot.fit !== 'contain' && slot.fit !== 'cover') {
      addIssue(issues, `${path}.fit`, 'invalid-enum', 'Asset slot fit must be contain or cover.');
    }
    validateGeometryCaps(slot.geometry, `${path}.geometry`, issues);
    if (slot.alpha !== 'allowed' && slot.alpha !== 'required' && slot.alpha !== 'forbidden') {
      addIssue(issues, `${path}.alpha`, 'invalid-enum', 'Invalid alpha policy.');
    }
    booleanField(slot, 'provenanceRequired', path, issues);
    const mimeTypes = asStringArray(slot.mimeTypes, `${path}.mimeTypes`, issues);
    if (mimeTypes.length === 0 || mimeTypes.some((mimeType) => !['image/png', 'image/jpeg', 'image/webp'].includes(mimeType))) {
      addIssue(issues, `${path}.mimeTypes`, 'unsafe-asset', 'Asset slots accept local PNG, JPEG, or WebP raster data only.');
    }
  });

  const roles = asRecordArray(root.roles, '$.roles', issues);
  const roleIds = validateUniqueIds(roles, '$.roles', issues);
  const rolesById = new Map(roles.map((role) => [String(role.id), role]));
  roles.forEach((role, index) => {
    const path = `$.roles[${index}]`;
    rejectUnsupportedFields(
      role,
      new Set([
        'id',
        'anchor',
        'stateFamilyId',
        'assetSlotId',
        'geometryCaps',
        'minimumTouchTarget',
        'requiredSafeBounds',
        'editableProperties',
      ]),
      path,
      issues,
    );
    const id = stringField(role, 'id', path, issues);
    validateNeutralId(id, `${path}.id`, neutralPattern, forbiddenTokens, issues);
    if (!anchorIds.has(String(role.anchor))) {
      addIssue(issues, `${path}.anchor`, 'unknown-anchor', `Unknown anchor "${String(role.anchor)}".`);
    }
    if (!familyIds.has(String(role.stateFamilyId))) {
      addIssue(issues, `${path}.stateFamilyId`, 'unknown-family', `Unknown state family "${String(role.stateFamilyId)}".`);
    }
    if (role.assetSlotId !== null && !slotIds.has(String(role.assetSlotId))) {
      addIssue(issues, `${path}.assetSlotId`, 'unknown-slot', `Unknown asset slot "${String(role.assetSlotId)}".`);
    }
    validateGeometryCaps(role.geometryCaps, `${path}.geometryCaps`, issues);
    const touchTarget = numberField(role, 'minimumTouchTarget', path, issues);
    if (touchTarget !== 0 && touchTarget < 48) {
      addIssue(issues, `${path}.minimumTouchTarget`, 'invalid-geometry', 'Interactive roles require at least 48 px.');
    }
    booleanField(role, 'requiredSafeBounds', path, issues);
    const properties = asStringArray(role.editableProperties, `${path}.editableProperties`, issues);
    if (new Set(properties).size !== properties.length) {
      addIssue(issues, `${path}.editableProperties`, 'duplicate-id', 'Editable properties must be unique.');
    }
    for (const property of properties) {
      if (!VISUAL_FIELDS.has(property)) {
        addIssue(issues, `${path}.editableProperties`, 'unsupported-field', `Unknown editable property "${property}".`);
      }
    }
  });

  slots.forEach((slot, index) => {
    for (const roleId of asStringArray(slot.compatibleRoleIds, `$.assetSlots[${index}].compatibleRoleIds`, issues)) {
      if (!roleIds.has(roleId)) {
        addIssue(
          issues,
          `$.assetSlots[${index}].compatibleRoleIds`,
          'unknown-role',
          `Unknown compatible role "${roleId}".`,
        );
      }
    }
  });

  const instances = asRecordArray(root.instances, '$.instances', issues);
  validateUniqueIds(instances, '$.instances', issues);
  const instancesById = new Map(instances.map((instance) => [String(instance.id), instance]));
  const actionInstanceIds = new Set<string>();
  instances.forEach((instance, index) => {
    const path = `$.instances[${index}]`;
    rejectUnsupportedFields(
      instance,
      new Set([
        'id',
        'parentInstanceId',
        'stateId',
        'roleId',
        'bindingId',
        'stateFamilyId',
        'required',
        'actionId',
        'accessibility',
        'defaultPresentation',
      ]),
      path,
      issues,
    );
    const stateId = String(instance.stateId);
    const roleId = String(instance.roleId);
    const role = rolesById.get(roleId);
    const parentId = instance.parentInstanceId;
    if (parentId !== null && typeof parentId !== 'string') {
      addIssue(
        issues,
        `${path}.parentInstanceId`,
        'invalid-type',
        'Parent instance identity must be a string or null.',
      );
    } else if (typeof parentId === 'string') {
      const parent = instancesById.get(parentId);
      if (!parent) {
        addIssue(
          issues,
          `${path}.parentInstanceId`,
          'unknown-instance',
          `Unknown parent instance "${parentId}".`,
        );
      } else if (parent.stateId !== instance.stateId) {
        addIssue(
          issues,
          `${path}.parentInstanceId`,
          'state-mismatch',
          'Parent and child instances must belong to the same shell state.',
        );
      }
    }
    if (!stateIds.has(stateId)) addIssue(issues, `${path}.stateId`, 'unknown-state', `Unknown state "${stateId}".`);
    if (!role) addIssue(issues, `${path}.roleId`, 'unknown-role', `Unknown role "${roleId}".`);
    if (!bindingIds.has(String(instance.bindingId))) {
      addIssue(issues, `${path}.bindingId`, 'unknown-binding', `Unknown binding "${String(instance.bindingId)}".`);
    }
    if (!familyIds.has(String(instance.stateFamilyId))) {
      addIssue(issues, `${path}.stateFamilyId`, 'unknown-family', `Unknown state family "${String(instance.stateFamilyId)}".`);
    }
    if (role && role.stateFamilyId !== instance.stateFamilyId) {
      addIssue(issues, `${path}.stateFamilyId`, 'family-mismatch', 'Instance and role state families must match.');
    }
    if (typeof instance.required !== 'boolean') {
      addIssue(issues, `${path}.required`, 'invalid-type', 'Required must be boolean.');
    }
    validateAccessibility(instance.accessibility, `${path}.accessibility`, issues);
    const visual = validateVisualPresentation(instance.defaultPresentation, `${path}.defaultPresentation`, issues, {
      requireBase: true,
      allowedProperties: role ? new Set(asStringArray(role.editableProperties, `${path}.role.editableProperties`, issues)) : undefined,
    });
    const geometry = visual?.geometry;
    if (role && geometry) {
      const caps = validateGeometryCaps(role.geometryCaps, `${path}.role.geometryCaps`, issues);
      try {
        const projected = projectShellGeometry({
          anchor: role.anchor as ShellAnchorId,
          geometry,
          viewport: { width: 390, height: 844, insets: { top: 59, right: 0, bottom: 34, left: 0 } },
          caps,
        });
        if (role.requiredSafeBounds === true && !isRectInside(projected.bounds, projected.safeRect)) {
          addIssue(issues, `${path}.defaultPresentation.geometry`, 'unsafe-overflow', 'Default geometry exceeds safe bounds.');
        }
      } catch (error) {
        addIssue(
          issues,
          `${path}.defaultPresentation.geometry`,
          'invalid-geometry',
          error instanceof Error ? error.message : 'Invalid geometry.',
        );
      }
    }
    if (instance.actionId !== undefined) {
      if (typeof instance.actionId !== 'string' || !SEMANTIC_ID_PATTERN.test(instance.actionId)) {
        addIssue(issues, `${path}.actionId`, 'invalid-id', 'Action identity must use the semantic ID grammar.');
      } else {
        actionInstanceIds.add(String(instance.id));
      }
      if (!['action', 'toggle'].includes(bindingKindsById.get(String(instance.bindingId)) ?? '')) {
        addIssue(
          issues,
          `${path}.bindingId`,
          'invalid-binding-kind',
          'Action-bearing instances require an action or toggle binding.',
        );
      }
    }
  });

  for (const instance of instances) {
    const seen = new Set<string>();
    let cursor: JsonRecord | undefined = instance;
    while (cursor && typeof cursor.parentInstanceId === 'string') {
      const cursorId = String(cursor.id);
      if (seen.has(cursorId)) {
        addIssue(
          issues,
          '$.instances',
          'hierarchy-cycle',
          `Instance hierarchy contains a cycle at "${cursorId}".`,
        );
        break;
      }
      seen.add(cursorId);
      cursor = instancesById.get(cursor.parentInstanceId);
    }
  }

  for (const stateId of CANONICAL_STATE_IDS) {
    if (!instances.some((instance) => instance.stateId === stateId)) {
      addIssue(issues, '$.instances', 'missing-state', `State "${stateId}" has no semantic instances.`);
    }
  }

  const actions = asRecordArray(root.requiredActions, '$.requiredActions', issues);
  validateUniqueIds(actions, '$.requiredActions', issues);
  const coveredActionInstances = new Set<string>();
  actions.forEach((action, index) => {
    const path = `$.requiredActions[${index}]`;
    rejectUnsupportedFields(
      action,
      new Set(['id', 'stateId', 'bindingId', 'actionHook', 'minimumCount', 'instanceIds']),
      path,
      issues,
    );
    const id = String(action.id);
    const stateId = String(action.stateId);
    const bindingId = String(action.bindingId);
    if (!stateIds.has(stateId)) addIssue(issues, `${path}.stateId`, 'unknown-state', `Unknown state "${stateId}".`);
    if (!bindingIds.has(bindingId)) {
      addIssue(issues, `${path}.bindingId`, 'unknown-binding', `Unknown binding "${bindingId}".`);
    } else if (!['action', 'toggle'].includes(bindingKindsById.get(bindingId) ?? '')) {
      addIssue(
        issues,
        `${path}.bindingId`,
        'invalid-binding-kind',
        'Required actions must use an action or toggle binding.',
      );
    }
    const minimumCount = numberField(action, 'minimumCount', path, issues);
    if (!Number.isInteger(minimumCount) || minimumCount < 1) {
      addIssue(issues, `${path}.minimumCount`, 'invalid-cardinality', 'Required action count must be a positive integer.');
    }
    const ids = asStringArray(action.instanceIds, `${path}.instanceIds`, issues);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      addIssue(issues, `${path}.instanceIds`, 'duplicate-id', 'Required action instance IDs must be unique.');
    }
    if (uniqueIds.size < minimumCount) {
      addIssue(issues, `${path}.instanceIds`, 'invalid-cardinality', `Required action "${id}" lacks enough instances.`);
    }
    const hook = stringField(action, 'actionHook', path, issues);
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(hook)) {
      addIssue(issues, `${path}.actionHook`, 'invalid-id', 'Action hooks must be lower-kebab identifiers.');
    }
    for (const instanceId of ids) {
      const instance = instancesById.get(instanceId);
      if (!instance) {
        addIssue(issues, `${path}.instanceIds`, 'unknown-instance', `Unknown action instance "${instanceId}".`);
        continue;
      }
      coveredActionInstances.add(instanceId);
      if (instance.actionId !== id || instance.stateId !== stateId || instance.bindingId !== bindingId) {
        addIssue(
          issues,
          `${path}.instanceIds`,
          'action-mismatch',
          `Instance "${instanceId}" does not match action, state, and binding metadata.`,
        );
      }
      const role = rolesById.get(String(instance.roleId));
      const geometry = isRecord(instance.defaultPresentation)
        ? (instance.defaultPresentation.geometry as ShellNormalizedGeometry)
        : undefined;
      if (role && geometry) {
        try {
          const projected = projectShellGeometry({
            anchor: role.anchor as ShellAnchorId,
            geometry,
            viewport: { width: 390, height: 844, insets: { top: 59, right: 0, bottom: 34, left: 0 } },
            caps: role.geometryCaps as ShellGeometryCaps,
          });
          if (
            !isRectInside(projected.bounds, projected.safeRect) ||
            projected.bounds.width < Math.max(48, Number(role.minimumTouchTarget)) ||
            projected.bounds.height < Math.max(48, Number(role.minimumTouchTarget))
          ) {
            addIssue(
              issues,
              `${path}.instanceIds`,
              'unsafe-overflow',
              `Required action "${id}" must remain inside safe bounds and at least 48 px.`,
            );
          }
        } catch (error) {
          addIssue(
            issues,
            `${path}.instanceIds`,
            'invalid-geometry',
            error instanceof Error ? error.message : 'Invalid required action geometry.',
          );
        }
      }
    }
  });
  for (const actionInstanceId of actionInstanceIds) {
    if (!coveredActionInstances.has(actionInstanceId)) {
      addIssue(
        issues,
        '$.requiredActions',
        'missing-action',
        `Action instance "${actionInstanceId}" is not covered by requiredActions.`,
      );
    }
  }

  validateEditableAst(root.editableAst, issues);

  const publication = asRecord(root.publication, '$.publication', issues);
  if (publication) {
    rejectUnsupportedFields(
      publication,
      new Set([
        'publicationIdAlgorithm',
        'publicationIdDomain',
        'publicationIdFields',
        'requiredStates',
        'canonicalComponentFields',
        'portableContentNetworkPolicy',
        'mixedRevisionPolicy',
      ]),
      '$.publication',
      issues,
    );
    if (publication.publicationIdAlgorithm !== 'sha256') {
      addIssue(issues, '$.publication.publicationIdAlgorithm', 'unsupported-hash', 'Publication IDs must use sha256.');
    }
    if (publication.publicationIdDomain !== 'shell-publication-v1') {
      addIssue(issues, '$.publication.publicationIdDomain', 'invalid-id', 'Publication IDs require the V1 domain separator.');
    }
    validateExactKeys(
      asStringArray(publication.publicationIdFields, '$.publication.publicationIdFields', issues),
      [
        'contractId',
        'contractVersion',
        'projectJsonHash',
        'portableExportHash',
        'componentRecordsHash',
        'assetCatalogHash',
        'pageCount',
        'states',
      ],
      '$.publication.publicationIdFields',
      'missing-field',
      'content-id-field',
      issues,
    );
    const requiredStates = asStringArray(publication.requiredStates, '$.publication.requiredStates', issues);
    validateExactKeys(requiredStates, CANONICAL_STATE_IDS, '$.publication.requiredStates', 'missing-state', 'state', issues);
    if (publication.portableContentNetworkPolicy !== 'disabled') {
      addIssue(
        issues,
        '$.publication.portableContentNetworkPolicy',
        'unsafe-network',
        'Portable publication content must be network-disabled.',
      );
    }
    if (publication.mixedRevisionPolicy !== 'reject') {
      addIssue(issues, '$.publication.mixedRevisionPolicy', 'unsafe-revision', 'Mixed revisions must be rejected.');
    }
    const componentFields = asStringArray(
      publication.canonicalComponentFields,
      '$.publication.canonicalComponentFields',
      issues,
    );
    if (componentFields.length === 0 || new Set(componentFields).size !== componentFields.length) {
      addIssue(
        issues,
        '$.publication.canonicalComponentFields',
        'invalid-cardinality',
        'Canonical component fields must be a non-empty unique list.',
      );
    }
  }

  const projection = asRecord(root.projection, '$.projection', issues);
  if (projection) {
    rejectUnsupportedFields(
      projection,
      new Set([
        'pointerPath',
        'immutableRevisionRoot',
        'revisionDirectoryName',
        'projectionIdAlgorithm',
        'projectionIdDomain',
        'projectionIdFields',
        'requiredArtifacts',
        'assetDirectory',
        'artifactHashAlgorithm',
        'atomicPointerReplacement',
      ]),
      '$.projection',
      issues,
    );
    if (projection.pointerPath !== 'design/revision.json') {
      addIssue(issues, '$.projection.pointerPath', 'invalid-projection', 'Projection pointer must be design/revision.json.');
    }
    if (projection.immutableRevisionRoot !== 'design/revisions') {
      addIssue(
        issues,
        '$.projection.immutableRevisionRoot',
        'invalid-projection',
        'Immutable revisions must live under design/revisions.',
      );
    }
    if (projection.revisionDirectoryName !== '<projection-id>') {
      addIssue(issues, '$.projection.revisionDirectoryName', 'invalid-projection', 'Revision directories must use the projection ID.');
    }
    if (projection.projectionIdAlgorithm !== 'sha256' || projection.artifactHashAlgorithm !== 'sha256') {
      addIssue(issues, '$.projection', 'unsupported-hash', 'Projection and artifact hashes must use sha256.');
    }
    if (projection.projectionIdDomain !== 'shell-projection-v1') {
      addIssue(issues, '$.projection.projectionIdDomain', 'invalid-id', 'Projection IDs require the V1 domain separator.');
    }
    validateExactKeys(
      asStringArray(projection.projectionIdFields, '$.projection.projectionIdFields', issues),
      ['contractId', 'contractVersion', 'compatibilityHash', 'sourcePublicationId', 'artifacts'],
      '$.projection.projectionIdFields',
      'missing-field',
      'content-id-field',
      issues,
    );
    if (projection.assetDirectory !== 'assets') {
      addIssue(issues, '$.projection.assetDirectory', 'invalid-projection', 'Projected assets must live under assets/.');
    }
    const requiredArtifacts = asStringArray(projection.requiredArtifacts, '$.projection.requiredArtifacts', issues);
    validateExactKeys(
      requiredArtifacts,
      ['tokens.css', 'copy.ts', 'assets.ts', 'presentation.ts', 'asset-identity.json'],
      '$.projection.requiredArtifacts',
      'missing-artifact',
      'artifact',
      issues,
    );
    if (projection.atomicPointerReplacement !== true) {
      addIssue(issues, '$.projection.atomicPointerReplacement', 'invalid-projection', 'Pointer replacement must be atomic.');
    }
  }

  const schemas = asRecord(root.schemas, '$.schemas', issues);
  if (schemas) {
    validateExactKeys(
      Object.keys(schemas),
      ['presentation', 'assetCatalog', 'publication', 'projectionRevision', 'assetIdentity'],
      '$.schemas',
      'missing-schema',
      'schema',
      issues,
    );
    for (const [schemaName, schemaValue] of Object.entries(schemas)) {
      const schema = asRecord(schemaValue, `$.schemas.${schemaName}`, issues);
      if (!schema) continue;
      if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
        addIssue(
          issues,
          `$.schemas.${schemaName}.$schema`,
          'invalid-schema',
          'Embedded schemas must use JSON Schema draft 2020-12.',
        );
      }
      if (typeof schema.$id !== 'string' || schema.$id.length === 0) {
        addIssue(issues, `$.schemas.${schemaName}.$id`, 'invalid-schema', 'Embedded schemas need a stable ID.');
      }
      if (schema.type !== 'object' || schema.additionalProperties !== false) {
        addIssue(
          issues,
          `$.schemas.${schemaName}`,
          'invalid-schema',
          'Embedded schemas must define closed object roots.',
        );
      }
    }
  }

  if (issues.length > 0) throw new ShellContractValidationError('Shell presentation contract', issues);
  return value as ShellPresentationContract;
}

function mimeMatchesPath(mimeType: string, path: string): boolean {
  if (mimeType === 'image/png') return path.endsWith('.png');
  if (mimeType === 'image/jpeg') return path.endsWith('.jpg') || path.endsWith('.jpeg');
  if (mimeType === 'image/webp') return path.endsWith('.webp');
  return false;
}

export function parseShellAssetCatalog(value: unknown): ShellAssetCatalog {
  const issues: ShellValidationIssue[] = [];
  const root = asRecord(value, '$', issues);
  if (!root) throw new ShellContractValidationError('Shell asset catalog', issues);
  rejectUnsupportedFields(root, new Set(['contractId', 'contractVersion', 'assets']), '$', issues);
  if (root.contractId !== shellPresentationContract.contractId) {
    addIssue(issues, '$.contractId', 'compatibility-mismatch', 'Asset catalog contract ID is incompatible.');
  }
  if (root.contractVersion !== shellPresentationContract.contractVersion) {
    addIssue(issues, '$.contractVersion', 'compatibility-mismatch', 'Asset catalog contract version is incompatible.');
  }

  const slotsById = new Map(shellPresentationContract.assetSlots.map((slot) => [slot.id, slot]));
  const assets = asRecordArray(root.assets, '$.assets', issues);
  const assetIds = validateUniqueIds(assets, '$.assets', issues);
  const listedIds = assets.map((asset) => String(asset.id));
  if (canonicalizeJson(listedIds) !== canonicalizeJson([...assetIds].sort())) {
    addIssue(issues, '$.assets', 'non-canonical-order', 'Asset catalog entries must be sorted by ID.');
  }

  assets.forEach((asset, index) => {
    const path = `$.assets[${index}]`;
    rejectUnsupportedFields(
      asset,
      new Set([
        'id',
        'slotId',
        'path',
        'mimeType',
        'width',
        'height',
        'hasAlpha',
        'sha256',
        'provenance',
      ]),
      path,
      issues,
    );
    const id = stringField(asset, 'id', path, issues);
    if (!SEMANTIC_ID_PATTERN.test(id)) {
      addIssue(issues, `${path}.id`, 'invalid-id', 'Asset ID must be a semantic dot/kebab identifier.');
    }
    const slotId = stringField(asset, 'slotId', path, issues);
    const slot = slotsById.get(slotId);
    if (!slot) addIssue(issues, `${path}.slotId`, 'unknown-slot', `Unknown asset slot "${slotId}".`);
    const assetPath = stringField(asset, 'path', path, issues);
    if (!SAFE_ASSET_PATH_PATTERN.test(assetPath)) {
      addIssue(
        issues,
        `${path}.path`,
        'unsafe-asset',
        'Asset path must be a normalized local raster path under assets/.',
      );
    }
    const mimeType = stringField(asset, 'mimeType', path, issues);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType) || !mimeMatchesPath(mimeType, assetPath)) {
      addIssue(
        issues,
        `${path}.mimeType`,
        'unsafe-asset',
        'Asset MIME and extension must agree on PNG, JPEG, or WebP raster data.',
      );
    }
    const width = numberField(asset, 'width', path, issues);
    const height = numberField(asset, 'height', path, issues);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      addIssue(issues, path, 'invalid-geometry', 'Asset dimensions must be positive integers.');
    }
    if (
      slot &&
      (width < slot.geometry.minWidth ||
        width > slot.geometry.maxWidth ||
        height < slot.geometry.minHeight ||
        height > slot.geometry.maxHeight)
    ) {
      addIssue(issues, path, 'invalid-geometry', `Asset dimensions are incompatible with slot "${slotId}".`);
    }
    const hasAlpha = booleanField(asset, 'hasAlpha', path, issues);
    if (slot?.alpha === 'required' && !hasAlpha) {
      addIssue(issues, `${path}.hasAlpha`, 'invalid-alpha', `Slot "${slotId}" requires alpha.`);
    }
    if (slot?.alpha === 'forbidden' && hasAlpha) {
      addIssue(issues, `${path}.hasAlpha`, 'invalid-alpha', `Slot "${slotId}" forbids alpha.`);
    }
    const sha256 = stringField(asset, 'sha256', path, issues);
    if (!HASH_PATTERN.test(sha256)) {
      addIssue(issues, `${path}.sha256`, 'invalid-hash', 'Asset hash must be sha256- followed by 64 lowercase hex characters.');
    }
    const provenance = asRecord(asset.provenance, `${path}.provenance`, issues);
    if (provenance) {
      rejectUnsupportedFields(
        provenance,
        new Set(['sourceId', 'sourceHash', 'license']),
        `${path}.provenance`,
        issues,
      );
      stringField(provenance, 'sourceId', `${path}.provenance`, issues);
      const sourceHash = stringField(provenance, 'sourceHash', `${path}.provenance`, issues);
      if (!HASH_PATTERN.test(sourceHash)) {
        addIssue(issues, `${path}.provenance.sourceHash`, 'invalid-hash', 'Provenance source hash must be SHA-256.');
      }
      stringField(provenance, 'license', `${path}.provenance`, issues);
    }
  });

  if (issues.length > 0) throw new ShellContractValidationError('Shell asset catalog', issues);
  return value as ShellAssetCatalog;
}

export async function parseShellPublishedRevision(value: unknown): Promise<ShellPublishedRevision> {
  const issues: ShellValidationIssue[] = [];
  const root = asRecord(value, '$', issues);
  if (!root) throw new ShellContractValidationError('Shell published revision', issues);
  rejectUnsupportedFields(
    root,
    new Set([
      'contractId',
      'contractVersion',
      'publicationId',
      'projectJsonHash',
      'portableExportHash',
      'componentRecordsHash',
      'assetCatalogHash',
      'pageCount',
      'states',
    ]),
    '$',
    issues,
  );
  if (root.contractId !== shellPresentationContract.contractId) {
    addIssue(issues, '$.contractId', 'compatibility-mismatch', 'Publication contract ID is incompatible.');
  }
  if (root.contractVersion !== shellPresentationContract.contractVersion) {
    addIssue(issues, '$.contractVersion', 'compatibility-mismatch', 'Publication contract version is incompatible.');
  }
  for (const field of [
    'publicationId',
    'projectJsonHash',
    'portableExportHash',
    'componentRecordsHash',
    'assetCatalogHash',
  ]) {
    const hash = stringField(root, field, '$', issues);
    if (!HASH_PATTERN.test(hash)) addIssue(issues, `$.${field}`, 'invalid-hash', `${field} must be SHA-256.`);
  }
  if (root.pageCount !== CANONICAL_STATE_IDS.length) {
    addIssue(issues, '$.pageCount', 'page-mismatch', `Publication must contain ${CANONICAL_STATE_IDS.length} pages.`);
  }
  const states = asStringArray(root.states, '$.states', issues);
  validateExactKeys(states, CANONICAL_STATE_IDS, '$.states', 'missing-state', 'state', issues);
  if (!sameSemanticValue(states, CANONICAL_STATE_IDS)) {
    addIssue(issues, '$.states', 'non-canonical-order', 'Publication states must use canonical order.');
  }
  if (issues.length === 0) {
    const publication = value as ShellPublishedRevision;
    const expectedPublicationId = await computeShellPublicationId({
      contractId: publication.contractId,
      contractVersion: publication.contractVersion,
      projectJsonHash: publication.projectJsonHash,
      portableExportHash: publication.portableExportHash,
      componentRecordsHash: publication.componentRecordsHash,
      assetCatalogHash: publication.assetCatalogHash,
      pageCount: publication.pageCount,
      states: publication.states,
    });
    if (publication.publicationId !== expectedPublicationId) {
      addIssue(
        issues,
        '$.publicationId',
        'content-id-mismatch',
        'Publication ID does not match its canonical constituent hashes.',
      );
    }
  }
  if (issues.length > 0) throw new ShellContractValidationError('Shell published revision', issues);
  return value as ShellPublishedRevision;
}

function sameSemanticValue(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

interface ParsedPresentationInstance {
  instance: JsonRecord;
  prototype: ShellInstanceDefinition;
  role: ShellRoleDefinition;
  family: ShellStateFamilyDefinition;
  presentation: ShellDefaultPresentation;
  variants: Record<string, ShellVisualPresentation>;
  path: string;
}

function resolveVisualPresentation(
  family: ShellStateFamilyDefinition,
  presentation: ShellDefaultPresentation,
  variant: ShellVisualPresentation = {},
): ShellDefaultPresentation {
  const colors = {
    ...(family.base.colors ?? {}),
    ...(presentation.colors ?? {}),
    ...(variant.colors ?? {}),
  };
  const resolved = {
    ...family.base,
    ...presentation,
    ...variant,
  } as ShellDefaultPresentation;
  if (Object.keys(colors).length > 0) resolved.colors = colors;
  return resolved;
}

function validateAssetCompatibility(
  visual: ShellVisualPresentation,
  path: string,
  role: ShellRoleDefinition,
  catalogById: ReadonlyMap<string, ShellAssetCatalogEntry>,
  slotsById: ReadonlyMap<string, ShellAssetSlotDefinition>,
  issues: ShellValidationIssue[],
): void {
  if (!visual.assetId) return;
  const asset = catalogById.get(visual.assetId);
  if (asset && role.assetSlotId !== asset.slotId) {
    addIssue(
      issues,
      `${path}.assetId`,
      'incompatible-asset',
      `Asset "${asset.id}" targets slot "${asset.slotId}", not role slot "${String(role.assetSlotId)}".`,
    );
  }
  const slot = role.assetSlotId ? slotsById.get(role.assetSlotId) : undefined;
  if (!slot) {
    addIssue(issues, `${path}.assetId`, 'incompatible-asset', 'This role has no replaceable asset slot.');
  }
}

export interface ParseShellPresentationOptions {
  assetCatalog?: ShellAssetCatalog;
  viewportProfiles?: ShellViewport[];
}

export function parseShellPresentation(
  value: unknown,
  options: ParseShellPresentationOptions = {},
): ShellPresentationDocument {
  const issues: ShellValidationIssue[] = [];
  const root = asRecord(value, '$', issues);
  if (!root) throw new ShellContractValidationError('Shell presentation', issues);
  rejectUnsupportedFields(root, new Set(['contractId', 'contractVersion', 'pages']), '$', issues);
  if (root.contractId !== shellPresentationContract.contractId) {
    addIssue(issues, '$.contractId', 'compatibility-mismatch', 'Presentation contract ID is incompatible.');
  }
  if (root.contractVersion !== shellPresentationContract.contractVersion) {
    addIssue(issues, '$.contractVersion', 'compatibility-mismatch', 'Presentation contract version is incompatible.');
  }

  let catalog: ShellAssetCatalog | undefined;
  if (options.assetCatalog) {
    try {
      catalog = parseShellAssetCatalog(options.assetCatalog);
    } catch (error) {
      if (error instanceof ShellContractValidationError) {
        for (const issue of error.issues) {
          addIssue(issues, issue.path, issue.code, issue.message);
        }
      }
      else throw error;
    }
  }
  const catalogById = new Map((catalog?.assets ?? []).map((asset) => [asset.id, asset]));
  const knownAssetIds = new Set(catalogById.keys());
  const statesById = new Map(shellPresentationContract.states.map((state) => [state.id, state]));
  const prototypesById = new Map(shellPresentationContract.instances.map((instance) => [instance.id, instance]));
  const rolesById = new Map(shellPresentationContract.roles.map((role) => [role.id, role]));
  const familiesById = new Map(shellPresentationContract.stateFamilies.map((family) => [family.id, family]));
  const slotsById = new Map(shellPresentationContract.assetSlots.map((slot) => [slot.id, slot]));
  const pages = asRecordArray(root.pages, '$.pages', issues);
  const pageStateIds = pages.map((page) => String(page.stateId));
  validateExactKeys(pageStateIds, CANONICAL_STATE_IDS, '$.pages', 'missing-state', 'state', issues);
  if (!sameSemanticValue(pageStateIds, CANONICAL_STATE_IDS)) {
    addIssue(issues, '$.pages', 'non-canonical-order', 'Presentation pages must use canonical state order.');
  }

  const allInstances: ParsedPresentationInstance[] = [];
  const seenInstanceIds = new Set<string>();

  pages.forEach((page, pageIndex) => {
    const pagePath = `$.pages[${pageIndex}]`;
    rejectUnsupportedFields(page, new Set(['stateId', 'editorPageId', 'instances']), pagePath, issues);
    const stateId = String(page.stateId) as ShellStateId;
    const state = statesById.get(stateId);
    if (!state) addIssue(issues, `${pagePath}.stateId`, 'unknown-state', `Unknown state "${stateId}".`);
    if (state && page.editorPageId !== state.editorPageId) {
      addIssue(
        issues,
        `${pagePath}.editorPageId`,
        'page-mismatch',
        `State "${stateId}" must use editor page "${state.editorPageId}".`,
      );
    }
    const pageInstances = asRecordArray(page.instances, `${pagePath}.instances`, issues);
    const usedOrders = new Set<number>();
    pageInstances.forEach((instance, instanceIndex) => {
      const path = `${pagePath}.instances[${instanceIndex}]`;
      rejectUnsupportedFields(
        instance,
        new Set([
          'id',
          'prototypeInstanceId',
          'parentInstanceId',
          'roleId',
          'bindingId',
          'stateFamilyId',
          'actionId',
          'accessibility',
          'presentation',
          'variants',
        ]),
        path,
        issues,
      );
      const id = stringField(instance, 'id', path, issues);
      if (!SEMANTIC_ID_PATTERN.test(id)) {
        addIssue(issues, `${path}.id`, 'invalid-id', 'Instance identity must use the stable dot/kebab grammar.');
      }
      if (seenInstanceIds.has(id)) addIssue(issues, `${path}.id`, 'duplicate-id', `Duplicate instance ID "${id}".`);
      seenInstanceIds.add(id);

      const prototypeId = stringField(instance, 'prototypeInstanceId', path, issues);
      const prototype = prototypesById.get(prototypeId);
      if (!prototype) {
        addIssue(issues, `${path}.prototypeInstanceId`, 'unknown-instance', `Unknown prototype instance "${prototypeId}".`);
        return;
      }
      const role = rolesById.get(prototype.roleId);
      if (!role) {
        addIssue(issues, `${path}.roleId`, 'unknown-role', `Unknown prototype role "${prototype.roleId}".`);
        return;
      }
      if (prototype.stateId !== stateId) {
        addIssue(issues, `${path}.prototypeInstanceId`, 'state-mismatch', 'Prototype belongs to a different page state.');
      }
      for (const [field, expected] of [
        ['parentInstanceId', prototype.parentInstanceId],
        ['roleId', prototype.roleId],
        ['bindingId', prototype.bindingId],
        ['stateFamilyId', prototype.stateFamilyId],
      ] as const) {
        if (instance[field] !== expected) {
          addIssue(
            issues,
            `${path}.${field}`,
            'semantic-drift',
            `Non-editable ${field} must remain "${expected}".`,
          );
        }
      }
      if ((instance.actionId ?? undefined) !== prototype.actionId) {
        addIssue(issues, `${path}.actionId`, 'semantic-drift', 'Non-editable action identity does not match its prototype.');
      }
      const accessibility = validateAccessibility(
        instance.accessibility,
        `${path}.accessibility`,
        issues,
      );
      if (accessibility && !sameSemanticValue(accessibility, prototype.accessibility)) {
        addIssue(
          issues,
          `${path}.accessibility`,
          'semantic-drift',
          'Non-editable accessibility metadata does not match its prototype.',
        );
      }
      const allowedProperties = new Set(role.editableProperties);
      const presentation = validateVisualPresentation(instance.presentation, `${path}.presentation`, issues, {
        requireBase: true,
        allowedProperties,
        knownAssetIds,
        maximumCopyCodePoints: shellPresentationContract.editableAst.copy.maximumCodePoints,
      });
      const family = familiesById.get(prototype.stateFamilyId);
      const variants = asRecord(instance.variants, `${path}.variants`, issues);
      const parsedVariants: Record<string, ShellVisualPresentation> = {};
      if (family && variants) {
        validateExactKeys(
          Object.keys(variants),
          family.requiredVariants,
          `${path}.variants`,
          'missing-variant',
          'variant',
          issues,
        );
        for (const [variant, visual] of Object.entries(variants)) {
          const parsedVariant = validateVisualPresentation(
            visual,
            `${path}.variants.${variant}`,
            issues,
            {
            requireBase: false,
            allowedProperties,
            knownAssetIds,
            maximumCopyCodePoints: shellPresentationContract.editableAst.copy.maximumCodePoints,
            },
          );
          if (parsedVariant) {
            parsedVariants[variant] = parsedVariant;
            validateAssetCompatibility(
              parsedVariant,
              `${path}.variants.${variant}`,
              role,
              catalogById,
              slotsById,
              issues,
            );
          }
        }
      }
      if (presentation) {
        validateAssetCompatibility(
          presentation,
          `${path}.presentation`,
          role,
          catalogById,
          slotsById,
          issues,
        );
      }
      const order = presentation?.order;
      if (typeof order === 'number') {
        if (usedOrders.has(order)) {
          addIssue(issues, `${path}.presentation.order`, 'duplicate-order', `Duplicate order ${order} in state "${stateId}".`);
        }
        usedOrders.add(order);
      }
      if (presentation && family && variants) {
        allInstances.push({
          instance,
          prototype,
          role,
          family,
          presentation: presentation as ShellDefaultPresentation,
          variants: parsedVariants,
          path,
        });
      }
    });
  });

  for (const prototype of shellPresentationContract.instances.filter((instance) => instance.required)) {
    if (!seenInstanceIds.has(prototype.id)) {
      addIssue(issues, '$.pages', 'missing-instance', `Missing required semantic instance "${prototype.id}".`);
    }
  }

  const baselineViewport: ShellViewport = {
    width: 390,
    height: 844,
    insets: { top: 59, right: 0, bottom: 34, left: 0 },
  };
  const representativeViewport: ShellViewport = {
    width: 430,
    height: 932,
    insets: { top: 62, right: 8, bottom: 30, left: 12 },
  };
  const rawProfiles: unknown = options.viewportProfiles;
  const suppliedProfiles = Array.isArray(rawProfiles)
    ? (rawProfiles as ShellViewport[])
    : undefined;
  if (rawProfiles !== undefined && !suppliedProfiles) {
    addIssue(
      issues,
      '$options.viewportProfiles',
      'invalid-type',
      'Runtime viewport profiles must be an array.',
    );
  }
  if (suppliedProfiles?.length === 0) {
    addIssue(
      issues,
      '$options.viewportProfiles',
      'invalid-cardinality',
      'At least one runtime viewport profile is required when profiles are supplied.',
    );
  }
  const viewportProfiles = suppliedProfiles && suppliedProfiles.length > 0
    ? [baselineViewport, ...suppliedProfiles]
    : [baselineViewport, representativeViewport];
  for (const item of allInstances) {
    const visualStates: Array<[string, ShellDefaultPresentation]> = [
      ['presentation', resolveVisualPresentation(item.family, item.presentation)],
      ...item.family.requiredVariants.map(
        (variantId): [string, ShellDefaultPresentation] => [
          `variants.${variantId}`,
          resolveVisualPresentation(item.family, item.presentation, item.variants[variantId]),
        ],
      ),
    ];
    for (const [label, visual] of visualStates) {
      if (
        item.instance.id === item.prototype.id &&
        item.prototype.required &&
        (visual.visibility !== 'visible' || (visual.opacity ?? 1) === 0)
      ) {
        addIssue(
          issues,
          `${item.path}.${label}.visibility`,
          'missing-required-instance',
          `Required semantic instance "${item.prototype.id}" cannot be hidden.`,
        );
      }
      for (const viewport of viewportProfiles) {
        try {
          const projected = projectShellGeometry({
            anchor: item.role.anchor,
            geometry: visual.geometry,
            viewport,
            caps: item.role.geometryCaps,
          });
          if (item.role.requiredSafeBounds && !isRectInside(projected.bounds, projected.safeRect)) {
            addIssue(
              issues,
              `${item.path}.${label}.geometry`,
              'unsafe-overflow',
              `Instance "${String(item.instance.id)}" is outside safe bounds.`,
            );
          }
        } catch (error) {
          addIssue(
            issues,
            `${item.path}.${label}.geometry`,
            'invalid-geometry',
            error instanceof Error ? error.message : 'Invalid geometry.',
          );
        }
      }
    }
  }

  for (const action of shellPresentationContract.requiredActions) {
    const matches = allInstances.filter(
      (item) =>
        item.prototype.actionId === action.id &&
        item.prototype.stateId === action.stateId &&
        item.prototype.bindingId === action.bindingId,
    );
    const validateActionState = (
      label: string,
      effective: Array<{ item: ParsedPresentationInstance; visual: ShellDefaultPresentation }>,
    ): void => {
      const visible = effective.filter(
        ({ visual }) => visual.visibility === 'visible' && (visual.opacity ?? 1) > 0,
      );
      if (visible.length < action.minimumCount) {
        addIssue(
          issues,
          '$.pages',
          'missing-required-action',
          `Required action "${action.id}" needs at least ${action.minimumCount} visible instance(s) in ${label}.`,
        );
      }
      for (const { item, visual } of visible) {
        for (const viewport of viewportProfiles) {
          try {
            const projected = projectShellGeometry({
              anchor: item.role.anchor,
              geometry: visual.geometry,
              viewport,
              caps: item.role.geometryCaps,
            });
            const minimum = Math.max(
              shellPresentationContract.canonicalCanvas.minimumActionSize,
              item.role.minimumTouchTarget,
            );
            if (
              !isRectInside(projected.bounds, projected.safeRect) ||
              projected.bounds.width < minimum ||
              projected.bounds.height < minimum
            ) {
              addIssue(
                issues,
                `${item.path}.${label}.geometry`,
                'unsafe-overflow',
                `Required action "${action.id}" must stay inside safe bounds and at least ${minimum} px.`,
              );
            }
          } catch (error) {
            addIssue(
              issues,
              `${item.path}.${label}.geometry`,
              'invalid-geometry',
              error instanceof Error ? error.message : 'Invalid required action geometry.',
            );
          }
        }
      }
    };

    validateActionState(
      'presentation',
      matches.map((item) => ({
        item,
        visual: resolveVisualPresentation(item.family, item.presentation),
      })),
    );
    const variantIds = new Set(matches.flatMap((item) => item.family.requiredVariants));
    for (const variantId of variantIds) {
      validateActionState(
        `variants.${variantId}`,
        matches.map((item) => ({
          item,
          visual: resolveVisualPresentation(
            item.family,
            item.presentation,
            item.variants[variantId],
          ),
        })),
      );
    }
  }

  if (issues.length > 0) throw new ShellContractValidationError('Shell presentation', issues);
  return value as ShellPresentationDocument;
}

export function createDefaultShellPresentation(): ShellPresentationDocument {
  const familiesById = new Map(shellPresentationContract.stateFamilies.map((family) => [family.id, family]));
  return {
    contractId: shellPresentationContract.contractId,
    contractVersion: shellPresentationContract.contractVersion,
    pages: shellPresentationContract.states.map((state) => ({
      stateId: state.id,
      editorPageId: state.editorPageId,
      instances: shellPresentationContract.instances
        .filter((instance) => instance.stateId === state.id)
        .map((instance) => {
          const family = familiesById.get(instance.stateFamilyId);
          if (!family) throw new Error(`Missing state family "${instance.stateFamilyId}".`);
          const semantic: ShellPresentationInstance = {
            id: instance.id,
            prototypeInstanceId: instance.id,
            parentInstanceId: instance.parentInstanceId,
            roleId: instance.roleId,
            bindingId: instance.bindingId,
            stateFamilyId: instance.stateFamilyId,
            accessibility: structuredClone(instance.accessibility),
            presentation: structuredClone(instance.defaultPresentation),
            variants: structuredClone(family.variants),
          };
          if (instance.actionId) semantic.actionId = instance.actionId;
          return semantic;
        }),
    })),
  };
}

function validateProjectionArtifactPath(path: string): boolean {
  return (
    shellPresentationContract.projection.requiredArtifacts.includes(path) ||
    SAFE_ASSET_PATH_PATTERN.test(path)
  );
}

export async function parseProjectionRevision(value: unknown): Promise<ShellProjectionRevision> {
  const issues: ShellValidationIssue[] = [];
  const root = asRecord(value, '$', issues);
  if (!root) throw new ShellContractValidationError('Shell projection revision', issues);
  rejectUnsupportedFields(
    root,
    new Set([
      'contractId',
      'contractVersion',
      'compatibilityHash',
      'projectionId',
      'sourcePublicationId',
      'revisionPath',
      'artifacts',
    ]),
    '$',
    issues,
  );
  if (root.contractId !== shellPresentationContract.contractId) {
    addIssue(issues, '$.contractId', 'compatibility-mismatch', 'Projection contract ID is incompatible.');
  }
  if (root.contractVersion !== shellPresentationContract.contractVersion) {
    addIssue(issues, '$.contractVersion', 'compatibility-mismatch', 'Projection contract version is incompatible.');
  }
  for (const field of ['compatibilityHash', 'projectionId', 'sourcePublicationId']) {
    const hash = stringField(root, field, '$', issues);
    if (!HASH_PATTERN.test(hash)) {
      addIssue(issues, `$.${field}`, 'invalid-hash', `${field} must be a SHA-256 content ID.`);
    }
  }
  const expectedPath = `${shellPresentationContract.projection.immutableRevisionRoot}/${String(root.projectionId)}`;
  if (root.revisionPath !== expectedPath) {
    addIssue(
      issues,
      '$.revisionPath',
      'invalid-projection',
      `Revision path must be "${expectedPath}".`,
    );
  }

  const artifacts = asRecordArray(root.artifacts, '$.artifacts', issues);
  const paths = new Set<string>();
  const listedPaths: string[] = [];
  artifacts.forEach((artifact, index) => {
    const path = `$.artifacts[${index}]`;
    rejectUnsupportedFields(artifact, new Set(['path', 'sha256', 'bytes']), path, issues);
    const artifactPath = stringField(artifact, 'path', path, issues);
    listedPaths.push(artifactPath);
    if (paths.has(artifactPath)) {
      addIssue(issues, `${path}.path`, 'duplicate-id', `Duplicate artifact path "${artifactPath}".`);
    }
    paths.add(artifactPath);
    if (!validateProjectionArtifactPath(artifactPath)) {
      addIssue(
        issues,
        `${path}.path`,
        'unsafe-artifact',
        `Unsafe or unsupported artifact path "${artifactPath}".`,
      );
    }
    const hash = stringField(artifact, 'sha256', path, issues);
    if (!HASH_PATTERN.test(hash)) addIssue(issues, `${path}.sha256`, 'invalid-hash', 'Artifact hash must be SHA-256.');
    const bytes = numberField(artifact, 'bytes', path, issues);
    if (!Number.isInteger(bytes) || bytes < 0) {
      addIssue(issues, `${path}.bytes`, 'invalid-number', 'Artifact byte count must be a non-negative integer.');
    }
  });
  if (!sameSemanticValue(listedPaths, [...listedPaths].sort())) {
    addIssue(issues, '$.artifacts', 'non-canonical-order', 'Projection artifacts must be sorted by path.');
  }
  for (const required of shellPresentationContract.projection.requiredArtifacts) {
    if (!paths.has(required)) {
      addIssue(issues, '$.artifacts', 'missing-artifact', `Missing required projection artifact "${required}".`);
    }
  }

  if (issues.length === 0) {
    const projection = value as ShellProjectionRevision;
    const compatibilityHash = await hashShellPresentationContract();
    if (projection.compatibilityHash !== compatibilityHash) {
      addIssue(
        issues,
        '$.compatibilityHash',
        'compatibility-mismatch',
        'Projection compatibility hash does not match the canonical shell contract.',
      );
    }
    const expectedProjectionId = await computeShellProjectionId({
      contractId: projection.contractId,
      contractVersion: projection.contractVersion,
      compatibilityHash: projection.compatibilityHash,
      sourcePublicationId: projection.sourcePublicationId,
      artifacts: projection.artifacts,
    });
    if (projection.projectionId !== expectedProjectionId) {
      addIssue(
        issues,
        '$.projectionId',
        'content-id-mismatch',
        'Projection ID does not match its canonical source and artifact hashes.',
      );
    }
  }

  if (issues.length > 0) throw new ShellContractValidationError('Shell projection revision', issues);
  return value as ShellProjectionRevision;
}

export function parseAssetIdentityProjection(value: unknown): ShellAssetIdentityProjection {
  const issues: ShellValidationIssue[] = [];
  const root = asRecord(value, '$', issues);
  if (!root) throw new ShellContractValidationError('Shell asset identity projection', issues);
  rejectUnsupportedFields(
    root,
    new Set(['contractId', 'contractVersion', 'projectionId', 'sourcePublicationId', 'assets']),
    '$',
    issues,
  );
  if (root.contractId !== shellPresentationContract.contractId) {
    addIssue(issues, '$.contractId', 'compatibility-mismatch', 'Asset identity contract ID is incompatible.');
  }
  if (root.contractVersion !== shellPresentationContract.contractVersion) {
    addIssue(issues, '$.contractVersion', 'compatibility-mismatch', 'Asset identity contract version is incompatible.');
  }
  for (const field of ['projectionId', 'sourcePublicationId']) {
    const hash = stringField(root, field, '$', issues);
    if (!HASH_PATTERN.test(hash)) addIssue(issues, `$.${field}`, 'invalid-hash', `${field} must be SHA-256.`);
  }
  const assets = asRecordArray(root.assets, '$.assets', issues);
  const instanceIds = new Set<string>();
  const listedIds: string[] = [];
  const slotIds = new Set(shellPresentationContract.assetSlots.map((slot) => slot.id));
  assets.forEach((asset, index) => {
    const path = `$.assets[${index}]`;
    rejectUnsupportedFields(asset, new Set(['instanceId', 'slotId', 'assetId', 'path', 'sha256']), path, issues);
    const instanceId = stringField(asset, 'instanceId', path, issues);
    if (!SEMANTIC_ID_PATTERN.test(instanceId)) {
      addIssue(issues, `${path}.instanceId`, 'invalid-id', 'Invalid semantic instance ID.');
    }
    listedIds.push(instanceId);
    if (instanceIds.has(instanceId)) addIssue(issues, `${path}.instanceId`, 'duplicate-id', `Duplicate instance "${instanceId}".`);
    instanceIds.add(instanceId);
    const slotId = stringField(asset, 'slotId', path, issues);
    if (!slotIds.has(slotId)) addIssue(issues, `${path}.slotId`, 'unknown-slot', `Unknown asset slot "${slotId}".`);
    const assetId = stringField(asset, 'assetId', path, issues);
    if (!SEMANTIC_ID_PATTERN.test(assetId)) {
      addIssue(issues, `${path}.assetId`, 'invalid-id', 'Invalid semantic asset ID.');
    }
    const assetPath = stringField(asset, 'path', path, issues);
    if (!SAFE_ASSET_PATH_PATTERN.test(assetPath)) {
      addIssue(issues, `${path}.path`, 'unsafe-asset', 'Asset identity path must be a local raster path.');
    }
    const hash = stringField(asset, 'sha256', path, issues);
    if (!HASH_PATTERN.test(hash)) addIssue(issues, `${path}.sha256`, 'invalid-hash', 'Asset identity hash must be SHA-256.');
  });
  if (!sameSemanticValue(listedIds, [...listedIds].sort())) {
    addIssue(issues, '$.assets', 'non-canonical-order', 'Asset identity entries must be sorted by instance ID.');
  }
  if (issues.length > 0) throw new ShellContractValidationError('Shell asset identity projection', issues);
  return value as ShellAssetIdentityProjection;
}

export interface ShellPublicationCompatibility {
  contractId: string;
  contractVersion: string;
  compatibilityHash: string;
}

export async function isShellPublicationCompatible(
  publication: ShellPublicationCompatibility,
): Promise<boolean> {
  if (
    publication.contractId !== shellPresentationContract.contractId ||
    publication.contractVersion !== shellPresentationContract.contractVersion ||
    !HASH_PATTERN.test(publication.compatibilityHash)
  ) {
    return false;
  }
  return publication.compatibilityHash === (await hashShellPresentationContract());
}

export async function assertShellPublicationCompatible(
  publication: ShellPublicationCompatibility,
): Promise<void> {
  if (!(await isShellPublicationCompatible(publication))) {
    throw new ShellContractValidationError('Shell publication compatibility', [
      {
        path: '$',
        code: 'compatibility-mismatch',
        message: `Expected ${shellPresentationContract.contractId}@${shellPresentationContract.contractVersion}.`,
      },
    ]);
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const shellPresentationContract = deepFreeze(
  parseShellPresentationContract(rawShellPresentationContract),
);

export const SHELL_CONTRACT_ID = shellPresentationContract.contractId;
export const SHELL_CONTRACT_VERSION = shellPresentationContract.contractVersion;
export const SHELL_STATE_IDS = Object.freeze(
  shellPresentationContract.states.map((state) => state.id),
);
export const ANCHOR_IDS = Object.freeze(
  shellPresentationContract.anchors.map((anchor) => anchor.id),
);

export async function hashShellPresentationContract(
  contract: ShellPresentationContract = shellPresentationContract,
): Promise<string> {
  parseShellPresentationContract(contract);
  return hashCanonicalJson(contract);
}

export async function createShellPublicationCompatibility(): Promise<ShellPublicationCompatibility> {
  return {
    contractId: SHELL_CONTRACT_ID,
    contractVersion: SHELL_CONTRACT_VERSION,
    compatibilityHash: await hashShellPresentationContract(),
  };
}
