/**
 * Progress persistence — localStorage under a versioned key.
 *
 * v2 shape: per-pack completion replaces the flat highestLevelCompleted
 *   counter so the saga can gate each node on the previous completed node.
 *
 *   {
 *     schema: "arrow-progress",
 *     version: 2,
 *     packProgress: Record<packSlug, number>,  // 0..pack length
 *     mute: boolean,
 *     tutorialSeen: boolean,
 *     bestTimeSeconds: number,
 *     completions: number,
 *     juice?: JuiceSettings,
 *   }
 *
 * v1 payloads migrate on load: v1.highestLevelCompleted maps to
 *   packProgress["all"], capped to the carried 40-level authored saga.
 *
 * Intentionally thin: no server, no auth. Loss of local storage just
 * resets the player to level 1 — no value at risk.
 */

import { DEFAULT_JUICE, validate as validateJuice, type JuiceSettings } from "./juice.js";

export const LEGACY_PROGRESS_KEY = "@fabrika/arrow/progress/v1";
export const PROGRESS_KEY = "@fabrikav2/arrow/progress/v2";
const KEY = PROGRESS_KEY;
const CURRENT_PACK = "all";
const CURRENT_PACK_COUNT = 40;

export interface Progress {
  schema: "arrow-progress";
  version: 2;
  /** How many levels have been cleared in each pack (0..pack.length). */
  packProgress: Record<string, number>;
  mute: boolean;
  tutorialSeen: boolean;
  /** Best full-playthrough time in seconds; 0 = never cleared. */
  bestTimeSeconds: number;
  /** Total number of full playthroughs (reaching the end screen). */
  completions: number;
  /** Animation juice knobs. Persisted so the designer's tuning survives reloads. */
  juice: JuiceSettings;
}

const DEFAULT: Progress = {
  schema: "arrow-progress",
  version: 2,
  packProgress: {},
  mute: false,
  tutorialSeen: false,
  bestTimeSeconds: 0,
  completions: 0,
  juice: DEFAULT_JUICE,
};

// Legacy payload — only fields the v1→v2 migration reads.
interface LegacyV1 {
  schema?: unknown;
  version?: unknown;
  highestLevelCompleted?: unknown;
  mute?: unknown;
  tutorialSeen?: unknown;
  bestTimeSeconds?: unknown;
  completions?: unknown;
  juice?: unknown;
}

/** Match the generator's `meta.indexInPack` upper bound (1..99). Anything
 *  above is a tampered payload or a future-version artifact — clamp so
 *  totalCompleted() can't report nonsense and skip the player past
 *  legitimate levels. */
const PACK_COUNT_CAP = CURRENT_PACK_COUNT;

function sanitizePackProgress(raw: unknown): Record<string, number> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [slug, count] of Object.entries(raw as Record<string, unknown>)) {
    // Slug must start with a letter — rejects purely-numeric keys that
    // would otherwise sneak through from an array-typed payload.
    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(slug)) continue;
    const n = Math.floor(Number(count));
    if (!Number.isFinite(n) || n < 0) continue;
    out[slug] = Math.min(PACK_COUNT_CAP, n);
  }
  return out;
}

function migrateV1(p: LegacyV1): Progress {
  const hlc = Math.max(0, Math.floor(Number(p.highestLevelCompleted) || 0));
  return {
    schema: "arrow-progress",
    version: 2,
    packProgress: hlc > 0 ? { [CURRENT_PACK]: Math.min(CURRENT_PACK_COUNT, hlc) } : {},
    mute: p.mute === true,
    tutorialSeen: p.tutorialSeen === true,
    bestTimeSeconds: Math.max(0, Math.floor(Number(p.bestTimeSeconds) || 0)),
    completions: Math.max(0, Math.floor(Number(p.completions) || 0)),
    juice: validateJuice((p.juice ?? {}) as Partial<JuiceSettings>),
  };
}

export function load(): Progress {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_PROGRESS_KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT };
    const p = parsed as Record<string, unknown>;
    if (p.schema !== "arrow-progress") return { ...DEFAULT };
    if (p.version === 1) return migrateV1(p as LegacyV1);
    if (p.version !== 2) return { ...DEFAULT };
    const p2 = p as Partial<Progress>;
    return {
      schema: "arrow-progress",
      version: 2,
      packProgress: sanitizePackProgress(p2.packProgress),
      mute: p2.mute === true,
      tutorialSeen: p2.tutorialSeen === true,
      bestTimeSeconds: Math.max(0, Math.floor(p2.bestTimeSeconds ?? 0)),
      completions: Math.max(0, Math.floor(p2.completions ?? 0)),
      juice: validateJuice((p2.juice ?? {}) as Partial<JuiceSettings>),
    };
  } catch {
    return { ...DEFAULT };
  }
}

export function save(progress: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // Quota exceeded / private mode — swallow; progress is best-effort.
  }
}

/** Number of levels completed in a given pack. Returns 0 if the pack
 *  has no record yet. */
export function packCompleted(p: Progress, pack: string): number {
  return p.packProgress[pack] ?? 0;
}

/** Sum of cleared levels across all packs — replaces the old flat
 *  `highestLevelCompleted`. Callers that only care about "total done"
 *  (boot-to-next-level, full-completion gate) use this. */
export function totalCompleted(p: Progress): number {
  let total = 0;
  for (const n of Object.values(p.packProgress)) total += n;
  return total;
}

/** Mark `indexInPack` (1-based) as complete within `pack`. Monotonic
 *  non-decreasing: replaying an earlier level doesn't regress. */
export function recordLevelComplete(p: Progress, pack: string, indexInPack: number): Progress {
  const current = p.packProgress[pack] ?? 0;
  if (indexInPack <= current) return p;
  return { ...p, packProgress: { ...p.packProgress, [pack]: indexInPack } };
}

export function recordFullCompletion(p: Progress, seconds: number): Progress {
  const best = p.bestTimeSeconds === 0 ? seconds : Math.min(p.bestTimeSeconds, seconds);
  return { ...p, completions: p.completions + 1, bestTimeSeconds: best };
}

export function recordJuice(p: Progress, juice: JuiceSettings): Progress {
  return { ...p, juice };
}
