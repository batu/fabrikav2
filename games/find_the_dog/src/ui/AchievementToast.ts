const TOAST_ID = 'achievement-unlock-toast';
const TOAST_VISIBLE_MS = 5200;
const TOAST_EXIT_MS = 320;

/**
 * Transient in-app toast announcing newly unlocked achievements. Non-blocking
 * by construction: pointer-events none, no controls, auto-dismisses. Replay
 * protection lives with the caller (the completion callout's per-occurrence
 * guard), so the toast itself stays a dumb presenter.
 */
export function showAchievementUnlockToast(unlocked: readonly { name: string }[]): void {
  if (unlocked.length === 0) return;
  document.getElementById(TOAST_ID)?.remove();

  const toast = document.createElement('aside');
  toast.id = TOAST_ID;
  toast.className = 'achievement-unlock-toast';
  toast.dataset.motion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full';
  toast.setAttribute('role', 'status');
  toast.setAttribute(
    'aria-label',
    `Achievements unlocked: ${unlocked.map((achievement) => achievement.name).join(', ')}`,
  );

  // Copy is deliberately distinct from the completion-card callout (which
  // reads "Achievement unlocked / <names> / guidance") so the two surfaces
  // never show the same text twice on one screen.
  const summary = document.createElement('strong');
  summary.className = 'achievement-unlock-toast-summary';
  summary.textContent = unlocked.length === 1
    ? `🏆 ${unlocked[0]!.name} unlocked!`
    : `🏆 ${unlocked[0]!.name} +${unlocked.length - 1} more unlocked!`;
  toast.append(summary);
  document.body.appendChild(toast);

  window.setTimeout(() => {
    toast.classList.add('achievement-unlock-toast--leaving');
    window.setTimeout(() => toast.remove(), TOAST_EXIT_MS);
  }, TOAST_VISIBLE_MS);
}
