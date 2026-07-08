/**
 * Session stats — lightweight counters tracking this-session play
 * for the end-of-game celebration screen. Resets on page load; not
 * persisted, since the persistent value is "did the player beat all
 * the authored saga at least once".
 */

export interface SessionStats {
  taps: number;
  blockedTaps: number;
  levelsCleared: number;
  startedAt: number;
}

export function newSessionStats(): SessionStats {
  return { taps: 0, blockedTaps: 0, levelsCleared: 0, startedAt: performance.now() };
}

export function recordTap(stats: SessionStats, blocked: boolean): void {
  stats.taps++;
  if (blocked) stats.blockedTaps++;
}

export function recordClear(stats: SessionStats): void {
  stats.levelsCleared++;
}

export function elapsedSeconds(stats: SessionStats): number {
  return Math.round((performance.now() - stats.startedAt) / 1000);
}
