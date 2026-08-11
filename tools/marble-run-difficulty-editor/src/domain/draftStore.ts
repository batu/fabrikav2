import {
  canonicalDifficultyJson,
  createDefaultDifficultyDraft,
  DIFFICULTY_CONTRACT_VERSION,
  parseDifficultyDraft,
  SHIPPED_BASELINE,
  type DifficultyDraft,
} from '../../../../games/marble_run/src/levels/difficulty-contract.ts';
import { affectedLevelIds, expandDifficultyDraft } from '../../../../games/marble_run/src/levels/difficulty-expand.ts';
import { LEVELS } from '../../../../games/marble_run/src/levels/levels.generated.ts';
import type { LevelDef } from '../../../../games/marble_run/src/marble-board/types.ts';

import { GENERATION_ENGINE_VERSION, type AcceptedLevel } from '../generation/protocol.ts';

export const DRAFT_STORAGE_KEY = 'marble-run-difficulty-editor:draft-v1';
export const PERSISTENCE_VERSION = 1 as const;
export const MAX_PERSISTED_BYTES = 1024 * 1024;
export const AUTOSAVE_SETTLE_MS = 75;

export type WorkspacePhase = 'Current baseline' | 'Draft';
export type LevelGenerationState = 'Generating' | 'Ready' | 'Needs attention';

export interface EditorWorkspaceState {
  readonly phase: WorkspacePhase;
  readonly draft: DifficultyDraft;
  readonly selectedLevelId: number;
  readonly revision: number;
  readonly accepted: Readonly<Record<number, AcceptedLevel>>;
  /** Last valid display board; starts from shipped boards and is never cleared by a failed replacement. */
  readonly boards: Readonly<Record<number, LevelDef>>;
  readonly levelStates: Readonly<Record<number, LevelGenerationState>>;
  readonly failures: Readonly<Record<number, string>>;
  readonly lastWriteDurationMs: number | null;
  readonly persistedBytes: number;
}

interface PersistedWorkspace {
  readonly version: typeof PERSISTENCE_VERSION;
  readonly engineVersion: typeof GENERATION_ENGINE_VERSION;
  readonly contractVersion: typeof DIFFICULTY_CONTRACT_VERSION;
  readonly draft: DifficultyDraft;
  readonly accepted: readonly AcceptedLevel[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface DraftStoreOptions {
  readonly storage?: StorageLike | null;
  readonly now?: () => number;
  readonly autosaveMs?: number;
}

function guardedBrowserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    const storage = window.localStorage;
    const probe = '__marble_difficulty_editor_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compatibleAccepted(value: unknown, draft: DifficultyDraft): readonly AcceptedLevel[] {
  if (!Array.isArray(value)) throw new TypeError('Accepted cache must be an array.');
  const expanded = expandDifficultyDraft(draft);
  const seen = new Set<number>();
  return value.map((entry) => {
    if (!isRecord(entry) || !isRecord(entry.level) || !isRecord(entry.evidence)) throw new TypeError('Accepted cache entry is malformed.');
    const level = entry.level;
    const evidence = entry.evidence;
    const levelId = level.id;
    if (!Number.isInteger(levelId) || (levelId as number) < 1 || (levelId as number) > 110 || seen.has(levelId as number)) throw new TypeError('Accepted cache identities are invalid.');
    seen.add(levelId as number);
    if (!Number.isInteger(level.cols) || !Number.isInteger(level.rows) || !Array.isArray(level.cells) || !Array.isArray(level.gates)) throw new TypeError('Accepted board is malformed.');
    if (level.cells.length !== level.rows || level.cells.some((row) => typeof row !== 'string' || row.length !== level.cols)) throw new TypeError('Accepted board dimensions are inconsistent.');
    if (evidence.levelId !== levelId
      || evidence.source !== 'derived'
      || typeof evidence.measuredDifficulty !== 'number'
      || typeof evidence.solvable !== 'boolean'
      || typeof evidence.shapeKind !== 'string'
      || typeof entry.effectiveInputFingerprint !== 'string'
      || !Number.isSafeInteger(entry.seed)) throw new TypeError('Accepted cache metadata is malformed.');
    if (entry.effectiveInputFingerprint !== canonicalDifficultyJson(expanded[(levelId as number) - 1])) throw new TypeError('Accepted cache input fingerprint is stale.');
    const evidenceSeed = isRecord(evidence.seed) && evidence.seed.provenance !== 'unknown' ? evidence.seed.seed : 0;
    if (entry.seed !== evidenceSeed) throw new TypeError('Accepted cache seed is stale.');
    return entry as unknown as AcceptedLevel;
  });
}

export function restoreWorkspace(storage: StorageLike | null = guardedBrowserStorage()): Pick<EditorWorkspaceState, 'draft' | 'accepted' | 'phase'> {
  const baseline = createDefaultDifficultyDraft();
  if (storage === null) return { draft: baseline, accepted: {}, phase: 'Current baseline' };
  try {
    const raw = storage.getItem(DRAFT_STORAGE_KEY);
    if (raw === null || new TextEncoder().encode(raw).byteLength >= MAX_PERSISTED_BYTES) return { draft: baseline, accepted: {}, phase: 'Current baseline' };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)
      || parsed.version !== PERSISTENCE_VERSION
      || parsed.engineVersion !== GENERATION_ENGINE_VERSION
      || parsed.contractVersion !== DIFFICULTY_CONTRACT_VERSION) throw new TypeError('Unsupported persisted workspace.');
    const draft = parseDifficultyDraft(parsed.draft);
    if (canonicalDifficultyJson(draft.baseline) !== canonicalDifficultyJson(SHIPPED_BASELINE)) throw new TypeError('Persisted baseline does not match the shipped game.');
    const accepted = compatibleAccepted(parsed.accepted, draft);
    return { draft, accepted: Object.fromEntries(accepted.map((entry) => [entry.level.id, entry])), phase: 'Draft' };
  } catch { return { draft: baseline, accepted: {}, phase: 'Current baseline' }; }
}

export class DraftStore {
  private state: EditorWorkspaceState;
  private readonly listeners = new Set<() => void>();
  private readonly storage: StorageLike | null;
  private readonly now: () => number;
  private readonly autosaveMs: number;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(options: DraftStoreOptions = {}) {
    this.storage = options.storage === undefined ? guardedBrowserStorage() : options.storage;
    this.now = options.now ?? (() => performance.now());
    this.autosaveMs = options.autosaveMs ?? AUTOSAVE_SETTLE_MS;
    const restored = restoreWorkspace(this.storage);
    this.state = {
      ...restored,
      boards: {
        ...Object.fromEntries(LEVELS.map((level) => [level.id, level])),
        ...Object.fromEntries(Object.values(restored.accepted).map((result) => [result.level.id, result.level])),
      },
      selectedLevelId: 1,
      revision: 0,
      levelStates: {},
      failures: {},
      lastWriteDurationMs: null,
      persistedBytes: 0,
    };
  }

  getSnapshot = (): EditorWorkspaceState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  edit(nextDraft: DifficultyDraft): readonly number[] {
    const validated = parseDifficultyDraft(nextDraft);
    const affected = affectedLevelIds(this.state.draft, validated);
    if (affected.length === 0 && canonicalDifficultyJson(this.state.draft) === canonicalDifficultyJson(validated)) return affected;
    const levelStates = { ...this.state.levelStates };
    const failures = { ...this.state.failures };
    for (const levelId of affected) {
      levelStates[levelId] = 'Generating';
      delete failures[levelId];
    }
    this.publish({ ...this.state, phase: 'Draft', draft: validated, revision: this.state.revision + 1, levelStates, failures });
    this.scheduleAutosave();
    return affected;
  }

  markGenerating(levelIds: readonly number[], revision: number): void {
    if (revision < this.state.revision) return;
    const levelStates = { ...this.state.levelStates };
    for (const id of levelIds) levelStates[id] = 'Generating';
    this.publish({ ...this.state, revision, levelStates });
  }

  accept(revision: number, result: AcceptedLevel): void {
    if (revision !== this.state.revision) return;
    const id = result.level.id;
    this.publish({
      ...this.state,
      accepted: { ...this.state.accepted, [id]: result },
      boards: { ...this.state.boards, [id]: result.level },
      levelStates: { ...this.state.levelStates, [id]: 'Ready' },
      failures: Object.fromEntries(Object.entries(this.state.failures).filter(([key]) => Number(key) !== id)),
    });
    this.scheduleAutosave();
  }

  fail(revision: number, levelId: number, reason: string): void {
    if (revision !== this.state.revision) return;
    this.publish({
      ...this.state,
      levelStates: { ...this.state.levelStates, [levelId]: 'Needs attention' },
      failures: { ...this.state.failures, [levelId]: reason },
    });
  }

  selectLevel(levelId: number): void {
    if (!Number.isInteger(levelId) || levelId < 1 || levelId > 110) throw new RangeError('Level selection must be between 1 and 110.');
    this.publish({ ...this.state, selectedLevelId: levelId });
  }

  flushAutosave(): boolean {
    if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
    if (this.storage === null) return false;
    const payload: PersistedWorkspace = {
      version: PERSISTENCE_VERSION,
      engineVersion: GENERATION_ENGINE_VERSION,
      contractVersion: DIFFICULTY_CONTRACT_VERSION,
      draft: { ...this.state.draft, derivedEvidence: [] },
      accepted: Object.values(this.state.accepted).sort((a, b) => a.level.id - b.level.id),
    };
    const serialized = canonicalDifficultyJson(payload);
    const bytes = new TextEncoder().encode(serialized).byteLength;
    if (bytes >= MAX_PERSISTED_BYTES) return false;
    try {
      const started = this.now();
      this.storage.setItem(DRAFT_STORAGE_KEY, serialized);
      const duration = this.now() - started;
      this.publish({ ...this.state, lastWriteDurationMs: duration, persistedBytes: bytes });
      return true;
    } catch { return false; }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
    this.listeners.clear();
  }

  private scheduleAutosave(): void {
    if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => this.flushAutosave(), this.autosaveMs);
  }

  private publish(next: EditorWorkspaceState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}
