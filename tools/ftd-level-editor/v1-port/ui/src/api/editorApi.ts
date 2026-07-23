import type {
  AnimationJob,
  Background,
  ConfigResponse,
  Hitbox,
  LevelSection,
  Orientation,
  SessionResponse,
  SpriteCandidate,
} from '../types';

export class ApiError extends Error {
  status: number;
  url: string;
  method: string;
  detail: unknown;
  constructor(message: string, status: number, url: string, method: string, detail: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
    this.method = method;
    this.detail = detail;
  }
}

export type InpaintMode = 'crop' | 'crop_reference' | 'magenta';

/** Fired on every API failure. App.tsx subscribes and renders a toast so
 * failures surface in the UI instead of only in the devtools console.
 * Uncaught promise rejections still happen — this event just guarantees
 * the user sees *something* even when the caller forgot to .catch(). */
// `as const` narrows the type from `string` to the literal `'ftd:api-error'`.
// Required for the WindowEventMap declaration in ApiErrorToast.tsx to
// attach to the right key (a plain `string` key type would widen and
// break the typed addEventListener overload).
export const API_ERROR_EVENT = 'ftd:api-error' as const;

function dispatchApiError(err: ApiError): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ApiError>(API_ERROR_EVENT, { detail: err }));
}

export function apiErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const detail = err.detail;
  if (!detail || typeof detail !== 'object' || !("detail" in detail)) return null;
  const nested = detail.detail;
  if (!nested || typeof nested !== 'object' || !("code" in nested)) return null;
  return typeof nested.code === 'string' ? nested.code : null;
}

/** Options for `request()` beyond the standard RequestInit.
 *
 * `suppressToast` is the escape hatch for call sites that OWN their
 * error surface. Without suppression, such errors show up twice — once
 * inline, once in the global toast — which the user reads as "two
 * different problems." Keep the toast for unhandled errors by default;
 * opt out only where the caller has a richer local surface.
 */
export interface RequestOptions extends RequestInit {
  suppressToast?: boolean;
}

export function newRequestId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof ApiError) {
    if (err.status !== 0) return false;
    const detail = err.detail;
    return detail instanceof DOMException && detail.name === 'AbortError';
  }
  return false;
}

async function request<T>(url: string, options?: RequestOptions): Promise<T> {
  const method = options?.method ?? 'GET';
  const suppressToast = options?.suppressToast === true;
  // Strip our custom option before passing to fetch so the browser
  // doesn't see an unknown init field.
  const fetchInit: RequestInit | undefined = options
    ? { ...options, suppressToast: undefined } as RequestInit
    : undefined;
  let res: Response;
  try {
    res = await fetch(url, fetchInit);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    // Network-level failure (tunnel down, DNS, etc) — fetch rejects before
    // any status. Surface as an ApiError(0) so the toast path is uniform.
    const err = new ApiError(`Network error: ${(e as Error).message}`, 0, url, method, e);
    if (!suppressToast) dispatchApiError(err);
    throw err;
  }
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      detail = { error: res.statusText };
    }
    const err = new ApiError(`API error ${res.status}`, res.status, url, method, detail);
    if (!suppressToast) dispatchApiError(err);
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface SessionListItem {
  id: string;
  name: string;
  /** @deprecated Ambiguous: this field reports the *shipped* count (from
   * level.json.dogs.length) for SessionListItem, but the *intended*
   * count (session.json.n_dogs) for SessionResponse. Prefer
   * `intendedDogCount` / `paintedDogCount` once the backend populates
   * them. Retained for wire-format stability. */
  nDogs: number;
  /** Painted/shipped dogs (level.json.dogs.length). Populated by the
   * backend for public package sessions; undefined on early listings. */
  paintedDogCount?: number;
  /** Requested dog count at session creation (session.json.n_dogs). */
  intendedDogCount?: number;
  hasImage: boolean;
  hasThumbnail: boolean;
  setting: string;    // setting slug (e.g. 'japan', 'uk', 'other') — drives dropdown grouping
  /** @deprecated Operator-facing local preview state. Prefer previewedLocally once callers are migrated. */
  exported: boolean;
  catalogUploaded?: boolean;
  catalogListable?: boolean;
  catalogTombstoned?: boolean;
  bundledInApp?: boolean;
  /** Bg-gen model stored at session create time (empty for legacy). */
  model?: string;
  bgModel?: string;
  inpaintModel?: string;
  /** Composites + bg-only states present on disk: 'gemini', 'openai',
   *  'openai_v2', 'gemini_bg_only', 'openai_bg_only', 'openai_v2_bg_only'. */
  variants?: string[];
  assetVersion?: number;
  /** Soft-deleted — Gallery hides by default. Archiving also revokes export. */
  archived?: boolean;
  /** Slugs of variant cards the user has archived independently. */
  archivedVariants?: string[];
  scene?: string | null;
  entity?: string | null;
  /** Which variant's color file is currently shipped in public/levels/. */
  exportedVariant?: string;
  /** Session creation time from session.json; falls back to folder mtime for legacy sessions. */
  createdAt?: string;
  /** Session orientation. Legacy sessions fall back to dimensions when listed. */
  orientation?: Orientation;
  /** Selected background index from session.json. Gallery bg-only cards prefer this image. */
  selectedBgIndex?: number | null;
  /** User/workflow labels for filtering generated sessions. */
  tags?: string[];
  /** Static mount that owns this session's assets. Active editor sessions use `levels`; public-package-only sessions use `public-levels`. */
  assetBase?: 'levels' | 'public-levels';
}

export function getConfig(): Promise<ConfigResponse> {
  return request<ConfigResponse>('/api/config');
}

export interface GeometryConfigResponse {
  hudFraction: number;
  bannerFraction: number;
  sectionBoundaryBuffer: number;
  landscapeEdgeSafeArea: number;
  viewportSafeFraction: number;
  nSections: number;
  portraitReference: {
    width: number;
    height: number;
    deadzones: { label: string; x: number; y: number; w: number; h: number }[];
  };
}

// Canonical dead-zone / section geometry constants (plan -004 U1/U2). The single
// server-authoritative source the auto-placer, the publish visibility gate, and
// the builder canvas derive dead zones from.
export function getGeometryConfig(): Promise<GeometryConfigResponse> {
  return request<GeometryConfigResponse>('/api/config/geometry');
}

export interface BuildSizeResponse {
  limitBytes: number;
  artifact: {
    path: string;
    kind: string;
    buildType?: 'release' | 'debug' | 'unknown';
    sizeBytes: number;
    modifiedAt: number;
    overLimit: boolean;
    budgetApplies?: boolean;
    storeBudgetOverLimit?: boolean;
  } | null;
  distSizeBytes: number | null;
  androidPublicAssetsSizeBytes: number | null;
  levelAssetsSizeBytes: number | null;
}

export interface BundleProjectionLevel {
  id: string;
  exported: boolean;
  sizeBytes: number;
  cumulativeBytes: number | null;
  bundled: boolean;
}

export interface BundleProjection {
  capBytes: number;
  boundaryIndex: number;
  bundledBytes: number;
  levels: BundleProjectionLevel[];
}

/** C1 dynamic-under-200MB bundle boundary derived from the draft sequence. */
export function getBundleProjection(): Promise<BundleProjection> {
  return request<BundleProjection>(`/api/sequence-workflow/bundle-projection`);
}

/** Write bundled-manifest.json to the projection's bundled prefix (C1 Start). */
export function applyBundleProjection(): Promise<{ applied: boolean; bundledIds: string[]; projection: BundleProjection }> {
  return request(`/api/sequence-workflow/apply-bundle-projection`, { method: 'POST' });
}

export function getBuildSize(): Promise<BuildSizeResponse> {
  return request<BuildSizeResponse>('/api/build-size');
}

/** Re-export so consumers don't need a second import for the type. */
export type { Orientation };

export interface ListSessionsOptions {
  includePublic?: boolean;
}

export function listSessions(options: ListSessionsOptions = {}): Promise<SessionListItem[]> {
  const params = new URLSearchParams();
  if (options.includePublic === true) params.set('include_public', 'true');
  const query = params.toString();
  return request<SessionListItem[]>(`/api/sessions${query ? `?${query}` : ''}`);
}

export interface GenerationStatusResponse {
  backgrounds: {
    active: number;
    sessions: Record<string, {
      kind: 'background';
      startedAt?: number;
      total?: number;
      model?: string;
      succeeded?: number;
      failed?: number;
      queued?: boolean;
      jobId?: string;
    }>;
  };
}

export function getGenerationStatus(): Promise<GenerationStatusResponse> {
  return request<GenerationStatusResponse>('/api/generation-status', { suppressToast: true });
}

export interface BackgroundGenerationJobResponse {
  jobId: string;
  status: string;
  succeeded: number;
  failed: number;
  backgrounds: Background[];
  error: string | null;
}

export function startBackgroundGenerationJob(sessionId: string): Promise<BackgroundGenerationJobResponse> {
  return request<BackgroundGenerationJobResponse>(`/api/sessions/${sessionId}/background-generation/jobs`, {
    method: 'POST',
  });
}

export function getBackgroundGenerationJob(sessionId: string, jobId: string): Promise<BackgroundGenerationJobResponse> {
  return request<BackgroundGenerationJobResponse>(
    `/api/sessions/${sessionId}/background-generation/jobs/${jobId}`,
    { suppressToast: true },
  );
}

/** Normal editor generation creates one portrait session per recipe/scene. */
export type CreateSessionBase = {
  scenePrompt?: string;
  dogPrompt?: string;
  style: string;
  bgModel: string;
  inpaintModel: string;
  nDogs: number;
  /** @deprecated Legacy clients may send the retired single-option field. Only 1 is accepted. */
  nOptions?: 1;
  // Ingredients for the readable session id ({setting}_{scene}_{entity}_{seed}).
  setting: string;
  scene: string;
  entity: string;
  view: string;
  tags?: string[];
  upscaleEnabled?: boolean;
  upscaleModel?: string;
  upscaleTargetLongEdge?: number;
};

export type CreateSessionRequest =
  CreateSessionBase & {
    aspectRatio: string;
    imageSize: string;
  };

export interface RecipePromptRequest {
  setting: string;
  scene: string;
  entity: string;
  view: string;
  style: string;
}

export interface RecipePromptResponse {
  scenePrompt: string;
  dogPrompt: string;
  promptContext: Record<string, unknown>;
}

export interface CreateSessionResponse extends RecipePromptResponse {
  sessionId: string;
}

export function assembleRecipePrompts(body: RecipePromptRequest): Promise<RecipePromptResponse> {
  return request<RecipePromptResponse>('/api/actions/assemble-recipe-prompts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function createSession(body: CreateSessionRequest): Promise<CreateSessionResponse> {
  return request('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function getSession(sessionId: string): Promise<SessionResponse> {
  return request<SessionResponse>(`/api/sessions/${sessionId}`);
}

export function listSpriteCandidates(sessionId: string): Promise<{ candidates: SpriteCandidate[] }> {
  return request<{ candidates: SpriteCandidate[] }>(`/api/sessions/${sessionId}/sprite-candidates`);
}

export interface CreateAnimationJobRequest {
  sourceCandidateId: string;
  prompt: string;
  motionPreset?: string | null;
  customPrompt?: string | null;
  durationSeconds?: number;
  fps?: number;
}

export function createAnimationJob(
  sessionId: string,
  body: CreateAnimationJobRequest,
  options?: Pick<RequestOptions, 'signal' | 'suppressToast'>,
): Promise<AnimationJob> {
  return request<AnimationJob>(`/api/sessions/${sessionId}/animation-jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options?.signal,
    suppressToast: options?.suppressToast,
  });
}

export function listAnimationJobs(sessionId: string): Promise<{ jobs: AnimationJob[] }> {
  return request<{ jobs: AnimationJob[] }>(`/api/sessions/${sessionId}/animation-jobs`);
}

export interface SelectBackgroundResponse {
  bgWidth: number;
  bgHeight: number;
  selectedBgIndex: number | null;
  sections: LevelSection[];
}

export function selectBackground(sessionId: string, bgIndex: number): Promise<SelectBackgroundResponse> {
  return request('/api/sessions/' + sessionId + '/select-bg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bgIndex }),
  });
}

export interface UpscaleBackgroundResponse {
  background: Background;
  bgWidth: number;
  bgHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  scale: number;
  selectedBgIndex: number | null;
  sections: LevelSection[];
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'submitted'
  | 'polling'
  | 'downloading'
  | 'finalizing'
  | 'succeeded'
  | 'failed_retryable'
  | 'failed_terminal'
  | 'orphaned_unknown'
  | 'cancel_requested'
  | 'cancelled';

export interface JobResponse {
  id: string;
  parentJobId: string | null;
  kind: string;
  sessionId: string;
  idempotencyKey: string | null;
  inputHash: string | null;
  status: JobStatus;
  stage: string | null;
  retryable: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  result: Record<string, unknown>;
  workerOwner: string | null;
  heartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface UpscaleBackgroundJobResponse {
  jobId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  rawStatus: JobStatus;
  stage: string | null;
  retryable: boolean;
  errorCode: string | null;
  background: Background | null;
  selectedBgIndex: number | null;
  sections: LevelSection[];
  error: string | null;
}

export function listJobs(
  filters: { sessionId?: string; kind?: string; status?: JobStatus[]; parentJobId?: string; includeChildren?: boolean } = {},
): Promise<{ jobs: JobResponse[] }> {
  const params = new URLSearchParams();
  if (filters.sessionId) params.set('sessionId', filters.sessionId);
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.parentJobId) params.set('parentJobId', filters.parentJobId);
  if (filters.includeChildren === true) params.set('includeChildren', 'true');
  for (const status of filters.status ?? []) params.append('status', status);
  const query = params.toString();
  return request<{ jobs: JobResponse[] }>(`/api/jobs${query ? `?${query}` : ''}`, { suppressToast: true });
}

export function getJob(jobId: string): Promise<JobResponse> {
  return request<JobResponse>(`/api/jobs/${encodeURIComponent(jobId)}`, { suppressToast: true });
}

export function upscaleBackground(
  sessionId: string,
  bgIndex: number,
  model: string,
  targetLongEdge: number = 3840,
  select: boolean = true,
  signal?: AbortSignal,
): Promise<UpscaleBackgroundResponse> {
  return request(`/api/sessions/${sessionId}/upscale-bg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bgIndex, model, targetLongEdge, select }),
    signal,
  });
}

export function startUpscaleBackgroundJob(
  sessionId: string,
  bgIndex: number,
  model: string,
  targetLongEdge: number = 3840,
  select: boolean = true,
): Promise<UpscaleBackgroundJobResponse> {
  return request(`/api/sessions/${sessionId}/upscale-bg/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bgIndex, model, targetLongEdge, select }),
  });
}

export function getUpscaleBackgroundJob(
  sessionId: string,
  jobId: string,
): Promise<UpscaleBackgroundJobResponse> {
  return request(`/api/sessions/${sessionId}/upscale-bg/jobs/${jobId}`, { suppressToast: true });
}

export type AutoPlaceStrategy = 'random' | 'smart';

export interface AutoPlaceHitboxesResponse {
  hitboxes: Array<{ x: number; y: number; r: number }>;
  strategy?: AutoPlaceStrategy;
  placements?: Array<{ candidateId: number; x: number; y: number; r: number; score: number; reason: string; source: string }>;
}

export function autoPlaceHitboxes(
  sessionId: string,
  nDogs: number,
  nonce?: number,
  radius?: number,
  strategy: AutoPlaceStrategy = 'random',
): Promise<AutoPlaceHitboxesResponse> {
  return request('/api/sessions/' + sessionId + '/auto-hitboxes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nDogs, nonce, radius, strategy }),
  });
}

export function saveHitboxes(
  sessionId: string,
  hitboxes: Hitbox[],
  action: string = 'edit',
): Promise<void> {
  return request('/api/sessions/' + sessionId + '/hitboxes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hitboxes, action }),
  });
}

/**
 * Delete a dog by stable id (spec -004 §6.9). Removes its hitbox + dogs[] entry
 * server-side with no sibling re-index, then recomposites. 404 (unknown/legacy
 * id) surfaces through the shared error toast like any other mutation.
 */
export function deleteDogById(sessionId: string, dogId: string): Promise<void> {
  return request('/api/sessions/' + sessionId + '/dogs/by-id/' + encodeURIComponent(dogId), {
    method: 'DELETE',
  });
}

export interface VisibilityIssue {
  type?: 'clipped' | 'near_border' | 'blocked_area';
  area?: string;
  dogId?: string;
  viewport?: string;
  screen?: { x: number; y: number; r: number };
  bounds?: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
  };
  error?: string;
}

export interface VisibilityCheckResponse {
  ok: boolean;
  issues: VisibilityIssue[];
  viewports: Array<{ name: string; width: number; height: number }>;
  nearMargin?: number;
}

export function checkMobileVisibility(sessionId: string): Promise<VisibilityCheckResponse> {
  return request<VisibilityCheckResponse>(`/api/sessions/${sessionId}/visibility-check`, {
    suppressToast: true,
  });
}

export function checkMobileVisibilityBatch(sessionIds: string[]): Promise<{ reports: Record<string, VisibilityCheckResponse> }> {
  return request<{ reports: Record<string, VisibilityCheckResponse> }>('/api/sessions/visibility-checks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionIds }),
    suppressToast: true,
  });
}

export function setActiveVariant(
  sessionId: string,
  dogIndex: number,
  variantIndex: number | null,
): Promise<void> {
  return request(`/api/sessions/${sessionId}/dogs/${dogIndex}/active`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variantIndex }),
  });
}

/**
 * Set a dog's active variant BY STABLE ID (spec -004 §6.9): pick a variant, or
 * pass `null` to exclude the dog from the composite (first-class exclude, not a
 * delete). Resolve-and-act under one lock + recomposite, server-side. Preferred
 * over the by-index route on the DogsCanvas so a concurrent reorder can't flip
 * which dog is changed. 404 on an unknown/legacy id.
 */
export function setActiveVariantById(
  sessionId: string,
  dogId: string,
  variantIndex: number | null,
): Promise<void> {
  return request(`/api/sessions/${sessionId}/dogs/by-id/${encodeURIComponent(dogId)}/active`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variantIndex }),
  });
}

export function regenDog(
  sessionId: string,
  dogIndex: number,
  prompt: string,
  padding: number = 2.75,
  inpaintModel?: string,
  deferComposite: boolean = false,
): Promise<{ variantIndex: number; file: string; composited: boolean }> {
  return request(`/api/sessions/${sessionId}/dogs/${dogIndex}/regen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      padding,
      deferComposite,
      ...(inpaintModel ? { inpaintModel } : {}),
    }),
  });
}

/** Re-inpaint a dog BY STABLE ID (spec -004 §6.9.2) — resolve-then-act so a
 * concurrent reorder can't re-bill the wrong dog. 404 on unknown/legacy id. */
export function regenDogById(
  sessionId: string,
  dogId: string,
  prompt: string,
  padding: number = 2.75,
  inpaintModel?: string,
  deferComposite: boolean = false,
): Promise<{ variantIndex: number; file: string; composited: boolean }> {
  return request(`/api/sessions/${sessionId}/dogs/by-id/${encodeURIComponent(dogId)}/regen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      padding,
      deferComposite,
      ...(inpaintModel ? { inpaintModel } : {}),
    }),
  });
}

export interface RetryFailedDogUnitResponse {
  dogIndex: number;
  status: JobStatus;
  retryable: boolean;
  error: string | null;
  file: string | null;
  variantIndex: number | null;
}

export interface RetryFailedDogsJobResponse {
  jobId: string;
  status: JobStatus;
  succeeded: number;
  failed: number;
  units: RetryFailedDogUnitResponse[];
  error: string | null;
}

export interface CropInpaintJobResponse {
  jobId: string;
  status: JobStatus;
  succeeded: number;
  failed: number;
  colorFile: string | null;
  evalFile: string | null;
  error: string | null;
}

export function startCropInpaintJob(
  sessionId: string,
  hitboxes: Hitbox[],
  dogPrompt: string,
  padding: number = 2.75,
  inpaintModel?: string,
  hardDogPrompt?: string,
  hardDogPercent: number = 30,
  inpaintMode: Exclude<InpaintMode, 'magenta'> = 'crop',
): Promise<CropInpaintJobResponse> {
  return request(`/api/sessions/${sessionId}/inpaint/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hitboxes,
      dogPrompt,
      padding,
      hardDogPercent,
      inpaintMode,
      ...(inpaintModel ? { inpaintModel } : {}),
      ...(hardDogPrompt ? { hardDogPrompt } : {}),
    }),
  });
}

export function getCropInpaintJob(
  sessionId: string,
  jobId: string,
): Promise<CropInpaintJobResponse> {
  return request(`/api/sessions/${sessionId}/inpaint/jobs/${jobId}`, { suppressToast: true });
}

// ── Vertical scene extension (band generation) ──────────────────────────────

export type BandSide = 'top' | 'bottom';

export interface BandGenJobResponse {
  jobId: string;
  status: JobStatus;
  top: boolean;
  bottom: boolean;
  error: string | null;
}

export interface ExtensionState {
  extension: SessionResponse['extension'];
}

/** Start (or regenerate) the top/bottom scenery bands for a level. `sides`
 * selects which bands to run — both for a first Generate, one for a Regen. */
export function startBandGenJob(
  sessionId: string,
  sides: BandSide[],
  topPrompt?: string,
  bottomPrompt?: string,
): Promise<BandGenJobResponse> {
  return request(`/api/sessions/${sessionId}/band-generation/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sides,
      ...(topPrompt ? { topPrompt } : {}),
      ...(bottomPrompt ? { bottomPrompt } : {}),
    }),
  });
}

export function getBandGenJob(sessionId: string, jobId: string): Promise<BandGenJobResponse> {
  return request(`/api/sessions/${sessionId}/band-generation/jobs/${jobId}`, { suppressToast: true });
}

/** URL for a candidate band image in the session's extension/ dir. `version`
 * cache-busts across regenerations (the same path is overwritten). */
export function bandImageUrl(sessionId: string, side: BandSide, version: number): string {
  return `/levels/${sessionId}/extension/${side}.png?v=${version}`;
}

/** Accept the current candidate bands: writes the extension config so
 * export/publish produce an extension level. Requires both bands present. */
export function acceptExtension(sessionId: string): Promise<ExtensionState> {
  return request(`/api/sessions/${sessionId}/extension/accept`, { method: 'POST' });
}

/** Un-accept: drop the extension config (the level reverts to native on export). */
export function clearExtension(sessionId: string): Promise<ExtensionState> {
  return request(`/api/sessions/${sessionId}/extension/clear`, { method: 'POST' });
}

export function startRetryFailedDogsJob(
  sessionId: string,
  dogIndices: number[],
  prompt: string,
  padding: number = 2.75,
  inpaintModel?: string,
): Promise<RetryFailedDogsJobResponse> {
  return request(`/api/sessions/${sessionId}/dogs/retry-inpaint/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dogIndices,
      prompt,
      padding,
      ...(inpaintModel ? { inpaintModel } : {}),
    }),
  });
}

export function getRetryFailedDogsJob(
  sessionId: string,
  jobId: string,
): Promise<RetryFailedDogsJobResponse> {
  return request(`/api/sessions/${sessionId}/dogs/retry-inpaint/jobs/${jobId}`, { suppressToast: true });
}

export function recompositeSession(sessionId: string): Promise<{ ok: boolean }> {
  return request(`/api/sessions/${sessionId}/recomposite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ radial: 0, feather: 0 }),
  });
}

export function clearIncompleteSessions(): Promise<{ deleted: string[]; skipped: string[]; count: number }> {
  return request(`/api/sessions/clear-incomplete`, {
    method: 'POST',
  });
}

export function deleteSession(sessionId: string): Promise<{ deleted: boolean }> {
  return request(`/api/sessions/${sessionId}`, {
    method: 'DELETE',
  });
}

export function revokeExport(sessionId: string): Promise<{ levelId: string; removed: boolean }> {
  return request(`/api/sessions/${sessionId}/export`, {
    method: 'DELETE',
  });
}

export function setArchived(
  sessionId: string,
  archived: boolean,
  variant?: string,
): Promise<{ id: string; archived: boolean; variant?: string }> {
  return request(`/api/sessions/${sessionId}/archive`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived, ...(variant ? { variant } : {}) }),
  });
}

export interface LevelsIndexEntry {
  id: string;
  name?: string;
  jsonPath?: string;
}

export function getLevelsIndex(): Promise<LevelsIndexEntry[]> {
  return request<LevelsIndexEntry[]>(`/api/levels-index`);
}

export function reorderLevelsIndex(ids: string[]): Promise<{ ok: boolean; count: number; order: LevelsIndexEntry[] }> {
  return request(`/api/levels-index`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

export interface LevelAssetDescriptor {
  hash: string;
  size: number;
  path: string;
}

export interface BundledManifestEntry {
  id: string;
  name?: string;
  width?: number;
  height?: number;
  assets?: {
    levelJson?: LevelAssetDescriptor;
    colorImage?: LevelAssetDescriptor;
    thumbnailImage?: LevelAssetDescriptor;
  };
  /** @deprecated Legacy flat shape retained for older local manifests. */
  bwImage?: LevelAssetDescriptor;
  /** @deprecated Legacy flat shape retained for older local manifests. */
  colorImage?: LevelAssetDescriptor;
  dogs?: unknown[];
}

export interface BundledManifest {
  version: number;
  manifestRevision: number;
  generatedAt?: string;
  experimentId?: string;
  levels: BundledManifestEntry[];
}

export function getBundledManifest(): Promise<BundledManifest> {
  return request<BundledManifest>(`/api/bundled-manifest`);
}

export function reorderBundledManifest(ids: string[]): Promise<{ ok: boolean; count: number; manifest: BundledManifest }> {
  return request(`/api/bundled-manifest/order`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

export type SequenceWorkflowDiagnosticCode =
  | 'catalogLevelCohortRestricted'
  | 'catalogLevelMissing'
  | 'catalogLevelTombstoned'
  | 'catalogLevelUnlistable'
  | 'catalogSnapshotUnavailable'
  | 'catalogSnapshotsMissing'
  | 'changelogMissing'
  | 'levelVisibilityBlocked'
  | 'integrityMismatch'
  | 'packageAssetInvalid'
  | 'packageIncomplete'
  | 'packageMissing'
  | 'payloadTooLarge'
  | 'rollbackTargetIneligible'
  | 'rollbackTargetMissing'
  | 'sequenceDestructiveChange'
  | 'sequenceDestructiveChangeUnacknowledged'
  | 'sequenceDraftCatalogStale'
  | 'sequenceDraftStale'
  | 'sequenceDuplicateLevel'
  | 'sequenceEmpty'
  | 'starterPrefixMismatch'
  | 'starterPrefixTooShort'
  | 'supportedBuildStartersEmpty';

export const SEQUENCE_WORKFLOW_DIAGNOSTIC_CODES: readonly SequenceWorkflowDiagnosticCode[] = [
  'catalogLevelCohortRestricted',
  'catalogLevelMissing',
  'catalogLevelTombstoned',
  'catalogLevelUnlistable',
  'catalogSnapshotUnavailable',
  'catalogSnapshotsMissing',
  'changelogMissing',
  'levelVisibilityBlocked',
  'integrityMismatch',
  'packageAssetInvalid',
  'packageIncomplete',
  'packageMissing',
  'payloadTooLarge',
  'rollbackTargetIneligible',
  'rollbackTargetMissing',
  'sequenceDestructiveChange',
  'sequenceDestructiveChangeUnacknowledged',
  'sequenceDraftCatalogStale',
  'sequenceDraftStale',
  'sequenceDuplicateLevel',
  'sequenceEmpty',
  'starterPrefixMismatch',
  'starterPrefixTooShort',
  'supportedBuildStartersEmpty',
];

export interface SequenceDiagnostic {
  code: SequenceWorkflowDiagnosticCode;
  severity: 'error' | 'warning' | 'info';
  blocking: boolean;
  message: string;
  levelId?: string;
  packageId?: string;
  version?: string;
  details?: Record<string, unknown>;
}

export interface SequenceLiveState {
  sequenceVersion: string;
  catalogRevision: string;
  levelIds: string[];
  source: string;
  updatedAt: string | null;
}

export interface SequenceDraftState {
  levelIds: string[];
  baseLiveSequenceVersion: string;
  baseCatalogRevision: string;
  updatedAt: string | null;
  draftRevision: string;
}

export interface SequenceCatalogLevel {
  id: string;
  name: string;
  packageId: string;
  listable: boolean;
  bundledInApp: boolean;
  cohortBuckets: unknown[];
  allCohortAvailable: boolean;
  tombstonedAt: string | null;
}

export interface SequenceCatalogSummary {
  available: boolean;
  catalogRevision: string;
  levelCount: number;
  levels: SequenceCatalogLevel[];
}

export interface SequenceSupportedBuildsSummary {
  source: string;
  platforms: ('android' | 'ios')[];
  starterLevelIds: string[];
  diagnostics: SequenceDiagnostic[];
}

export interface SequenceLocalPreviewLevel {
  id: string;
  name: string;
  inStarterPrefix: boolean;
  inRuntimeManifest: boolean;
  catalogUploaded: boolean;
  catalogListable: boolean;
}

export interface SequenceLocalPreviewSummary {
  source: string;
  levelCount: number;
  starterLevelIds: string[];
  missingStarterLevelIds: string[];
  levels: SequenceLocalPreviewLevel[];
}

export interface SequenceDiffSummary {
  addedIds: string[];
  removedIds: string[];
  movedIds: string[];
  destructive: boolean;
}

export interface SequenceRowStatus {
  levelId: string;
  draftIndex: number | null;
  liveIndex: number | null;
  draftListed: boolean;
  liveListed: boolean;
  added: boolean;
  moved: boolean;
  removed: boolean;
  catalogStatus: 'available' | 'missing' | 'cohort-restricted' | 'tombstoned' | 'unlistable';
  catalogListable: boolean;
  bundledInApp: boolean;
  cohortRestricted: boolean;
  tombstoned: boolean;
  name: string;
}

export interface SequenceValidationSummary {
  activatable: boolean;
  dryRunnable: boolean;
  diagnostics: SequenceDiagnostic[];
  blockingDiagnostics: SequenceDiagnostic[];
  warnings: SequenceDiagnostic[];
  diff: SequenceDiffSummary;
  rows: SequenceRowStatus[];
  missingCatalogLevelIds: string[];
  copyFixPrompt: string | null;
}

export interface SequenceVersionSummary {
  sequenceVersion: string;
  catalogRevision: string;
  levelIds: string[];
  rawPayloadBytes?: number;
  sha256Hex: string;
  rollbackEligible: boolean;
  createdAt: string;
  changelogNote: string;
  packageIds: string[];
}

export interface SequenceVersionDetail extends SequenceVersionSummary {
  rawPayload: string;
}

export interface SequenceAuditEvent {
  eventId: string;
  operation: 'activate' | 'rollback';
  requestId: string;
  status: 'finalized';
  actor: string;
  fromVersion: string | null;
  toVersion: string;
  changelogNote: string;
  diagnostics?: SequenceDiagnostic[];
  diagnosticsCount?: number;
  createdAt: string;
}

export interface SequencePendingAttempt {
  requestId: string;
  operation: 'activate' | 'rollback';
  status: string;
  actor: string;
  sequenceVersion: string;
  rawPayload?: string;
  rawPayloadBytes?: number;
  sha256Hex: string;
  createdAt: string;
  error?: string;
}

export interface SequenceActivationState {
  schemaVersion: number;
  activeVersion: string;
  versions: SequenceVersionSummary[];
  auditEvents: SequenceAuditEvent[];
  pendingAttempts: SequencePendingAttempt[];
  historyCounts?: {
    versions: number;
    auditEvents: number;
    pendingAttempts: number;
  };
  historyTruncated?: boolean;
  retention: {
    retainedLevelIds: string[];
    retainedPackageIds: string[];
  };
  updatedAt: string | null;
}

export interface SequenceWorkflowState {
  schemaVersion: number;
  liveSequence: SequenceLiveState;
  draft: SequenceDraftState;
  catalog: SequenceCatalogSummary;
  localPreview?: SequenceLocalPreviewSummary;
  supportedBuilds: SequenceSupportedBuildsSummary;
  validation: SequenceValidationSummary;
  activation?: SequenceActivationState;
}

export interface SaveSequenceDraftRequest {
  levelIds: string[];
  baseLiveSequenceVersion: string;
  baseCatalogRevision: string;
  draftRevision: string;
}

export interface SequenceDryRunResponse {
  ok: boolean;
  changelogNote: string;
  payload: {
    schemaVersion: 1;
    sequenceVersion: string;
    catalogRevision: string;
    levelIds: string[];
  };
  rawPayload: string;
  sha256Hex: string;
  diagnostics: SequenceDiagnostic[];
  state: SequenceWorkflowState;
  globalActivationMutated: boolean;
}

export function getSequenceWorkflow(): Promise<SequenceWorkflowState> {
  return request<SequenceWorkflowState>('/api/sequence-workflow');
}

export function saveSequenceDraft(body: SaveSequenceDraftRequest): Promise<SequenceWorkflowState> {
  return request<SequenceWorkflowState>('/api/sequence-workflow/draft', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function resetSequenceDraft(body: { draftRevision: string; force?: boolean }): Promise<SequenceWorkflowState> {
  return request<SequenceWorkflowState>('/api/sequence-workflow/draft', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function dryRunSequenceDraft(body: {
  changelogNote: string;
  baseLiveSequenceVersion: string;
  baseCatalogRevision: string;
  draftRevision: string;
}): Promise<SequenceDryRunResponse> {
  return request<SequenceDryRunResponse>('/api/sequence-workflow/dry-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export interface SequenceActivationResponse {
  ok: boolean;
  version: SequenceVersionSummary;
  state: SequenceActivationState;
  idempotent: boolean;
}

export interface SequenceVersionDetailResponse {
  version: SequenceVersionDetail;
  active: boolean;
}

export function startSequenceWorkflow(body: {
  changelogNote: string;
  baseLiveSequenceVersion: string;
  baseCatalogRevision: string;
  draftRevision: string;
  destructiveWarningAcknowledged: boolean;
  requestId: string;
  dynamicBundle: boolean;
}): Promise<JobResponse> {
  return request<JobResponse>('/api/sequence-workflow/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function getSequenceVersionDetail(sequenceVersion: string): Promise<SequenceVersionDetailResponse> {
  return request<SequenceVersionDetailResponse>(`/api/sequence-workflow/versions/${encodeURIComponent(sequenceVersion)}`);
}

export function bgFullUrl(sessionId: string, bgIndex: number): string {
  return `/levels/${sessionId}/bg_${String(bgIndex).padStart(2, '0')}.png`;
}

/**
 * Downscaled WebP proxy of the SELECTED background (~300KB / 1067x1600 vs the
 * ~13MB / 2560x3840 full-res PNG — spec -004 §7). Reuses the existing
 * gallery-preview derivative pipeline: the `gemini_bg_only` variant resolves to
 * the session's selected bg, cached + served immutable. The editor canvas
 * renders this for a snappy load; full-res is only fetched at export. Hitbox
 * geometry is unaffected — coordinates live in full-res image space and scale by
 * bgWidth/bgHeight, so the proxy (same aspect ratio) just renders at display res.
 */
export function bgPreviewUrl(sessionId: string): string {
  return `/api/sessions/${sessionId}/gallery-preview/gemini_bg_only`;
}

export function recompositePreviewUrl(sessionId: string, version: string | number): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/recomposite-preview?scale=0.5&v=${encodeURIComponent(String(version))}`;
}

export function dogVariantUrl(sessionId: string, variantPath: string): string {
  return `/levels/${sessionId}/${variantPath}`;
}
