// ── Wire types ─────────────────────────────────────────────────────────────

/** Level orientation (replaces the prior 5-option aspect-ratio config).
 * Storage field on the backend is `mode`; on the wire it's `orientation`. */
export type Orientation = 'portrait' | 'landscape';

/** Per-section camera geometry for landscape 3-panel levels. Local copy of the
 * game's `LevelSection` interface (src/data/levels.ts) — duplicated to avoid
 * crossing the package boundary into game source. */
export interface LevelSection {
  xStart: number;
  xEnd: number;
}

export interface Hitbox {
  x: number;
  y: number;
  r: number;
  // A1 stable dog identity: carried by value once minted, never re-derived from
  // array position. Optional — absent on sessions not yet backfilled/minted.
  id?: string;
}

export type HiddennessLevel = 'easy' | 'hard';

export interface DogState {
  index: number;
  // A1 stable dog identity. Optional/additive — `undefined` on sessions not yet
  // backfilled or minted. NEVER use `dog.id && dog.activeVariant`-style truthiness
  // (activeVariant=0 is a real painted variant; id presence does not imply painted).
  id?: string;
  status: 'pending' | 'generating' | 'done' | 'error';
  // `null` means "no painted variant on disk" (pending or errored).
  // An integer is a valid variant index (0 is a real, painted variant).
  // Consumers MUST distinguish `null` from `0` — falsy-coercing them
  // together silently ships errored dogs in exports (fix 015).
  activeVariant: number | null;
  promptOverride: string | null;
  variants: string[];
  error?: string;
}

export type SpriteCandidateStatus =
  | 'ready'
  | 'missing_image'
  | 'invalid_image'
  | 'invalid_metadata'
  | 'not_pickup_usable';

export interface SpriteCandidate {
  id: string;
  dogIndex: number;
  spriteIndex: number;
  status: SpriteCandidateStatus;
  reason: string | null;
  image: string | null;
  metadataPath: string | null;
  mask?: string | null;
  sourceVariant?: string | null;
  width?: number | null;
  height?: number | null;
  anchorX?: number | null;
  anchorY?: number | null;
  technique?: string | null;
  quality?: Record<string, unknown> | null;
}

export type AnimationJobStatus = 'running' | 'completed' | 'failed';
export type AnimationReviewStatus = 'running' | 'generated' | 'failed' | 'missing_file';

export interface AnimationJob {
  id: string;
  status: AnimationJobStatus;
  sourceCandidateId: string;
  sourceImage: string | null;
  prompt: string;
  motionPreset: string | null;
  customPrompt: string | null;
  durationSeconds: number;
  fps: number;
  provider: string;
  model: string;
  providerJobId: string | null;
  contentType: string | null;
  previewPath: string | null;
  previewExists?: boolean;
  reviewStatus?: AnimationReviewStatus;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
}

export interface Background {
  index: number;
  file: string;
  generationTime: number;
  width?: number;
  height?: number;
  provider?: string;
  providerModelId?: string;
  providerJobId?: string;
  status?: string;
  selectable?: boolean;
  outputKind?: string;
  contentType?: string;
  estimatedCreativeUnits?: number | null;
  actualCreativeUnits?: number | null;
  promptContext?: Record<string, unknown>;
  kind?: 'generated' | 'upscaled' | string;
  sourceIndex?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  sourceImageHash?: string;
  upscaleModel?: string;
  upscaleScale?: number;
  targetLongEdge?: number;
}

export interface ModelOption {
  id: string;
  label: string;
}

export interface SettingDef {
  label: string;
  scenes: Record<string, string>;     // scene key → scene prompt
  shortDescriptions?: Record<string, string>; // scene key → compact planner context
}

export interface ConfigResponse {
  views: Record<string, string>;      // key → description (e.g. "isometric" → "Isometric 45-degree...")
  styles: Record<string, string>;     // key → description
  settings: Record<string, SettingDef>; // setting key → {label, scenes} — grouped source of truth
  entities: Record<string, string>;   // entity slug → noun phrase (e.g. "dog" → "cute dog")
  entityPromptTemplate: string;       // "Add a {entity} to the center..." — {entity} is substituted client-side
  models: ModelOption[];
  inpaintModels?: ModelOption[];
  upscaleModels?: ModelOption[];
}

export interface MaskParams {
  radial: number;
  feather: number;
}

export interface SessionResponse {
  id: string;
  /** Level orientation. Always present after Slice A; pre-feature legacy
   * sessions hydrate as 'portrait'. (Note: the prior `mode: 'setup' | 'workspace'`
   * field was UI flow-state — repurposed; the new field is `orientation`.) */
  orientation: Orientation;
  style: string;
  /** Bg-gen model. Kept as `model` for backward compatibility with older UI code. */
  model: string;
  bgModel?: string;
  bgProvider?: string;
  inpaintModel?: string;
  upscaleEnabled?: boolean;
  upscaleModel?: string | null;
  upscaleTargetLongEdge?: number;
  scenePrompt: string;
  dogPrompt: string;
  /** @deprecated Ambiguous after partial-export: session.json.n_dogs
   * (intended) and level.json.dogs.length (shipped) can differ but
   * both are called "nDogs" on the wire. Prefer `intendedDogCount` /
   * `paintedDogCount` once the backend populates them. This field keeps
   * the older meaning (intended count from session.json) for now. */
  nDogs: number;
  /** Optional split surface: intended count from session.json.n_dogs. */
  intendedDogCount?: number;
  /** Optional split surface: painted/shipped count from level.json. */
  paintedDogCount?: number;
  backgrounds: Background[];
  selectedBgIndex: number | null;
  bgWidth: number;
  bgHeight: number;
  /** Server-authoritative section ranges for landscape levels. Empty for portrait.
   * Populated on the backend on first select-bg via integer-arithmetic split. */
  sections: LevelSection[];
  hitboxes: Hitbox[];
  dogs: DogState[];
  /** Legacy paste-mask params. The current crop flow ignores these and
   * always recomposites with raw diff-mask paste. */
  maskParams?: MaskParams;
  setting?: string | null;
  scene?: string | null;
  entity?: string | null;
  promptContext?: Record<string, unknown>;
  archived?: boolean;
  /** @deprecated Operator-facing local preview state. */
  exported: boolean;
  catalogUploaded?: boolean;
  catalogListable?: boolean;
  catalogTombstoned?: boolean;
  bundledInApp?: boolean;
  /** Which variant is currently shipped in public/levels/<id>/color.png. */
  exportedVariant?: string;
  /** Accepted vertical-extension config (null/absent until the band-gen stage
   * accepts). Pipeline-only bookkeeping; the runtime ignores it. */
  extension?: { targetAspect: number; bandsRef: string } | null;
  /** Which candidate bands currently exist on disk — lets the Extend stage
   * re-surface Accept after a reload without a fresh (paid) regeneration. */
  extensionBands?: { top: boolean; bottom: boolean };
}

// ── Editor state ───────────────────────────────────────────────────────────

export interface GenerationProgress {
  succeeded: number;
  failed: number;
  total: number;
}
