const HOME_SHELL_SELECTOR = '#home-shell';
const HOME_PAGE_OVERLAY_SELECTOR = '#home-page-overlay';

type MaybeInertElement = HTMLElement & { inert?: boolean };

function setInert(element: HTMLElement, inert: boolean): void {
  (element as MaybeInertElement).inert = inert;
}

export function showHomeMenuLayer(overlay: HTMLElement | null = document.getElementById('hud-overlay')): void {
  if (overlay === null) return;

  overlay.classList.add('home-mode');
  const shell = overlay.querySelector<HTMLElement>(HOME_SHELL_SELECTOR);
  if (shell === null) return;

  shell.hidden = false;
  shell.removeAttribute('aria-hidden');
  setInert(shell, false);
}

export function hideHomeMenuLayer(overlay: HTMLElement | null = document.getElementById('hud-overlay')): void {
  if (overlay === null) return;

  overlay.classList.remove('home-mode');
  overlay.querySelector<HTMLElement>(HOME_PAGE_OVERLAY_SELECTOR)?.remove();

  const shell = overlay.querySelector<HTMLElement>(HOME_SHELL_SELECTOR);
  if (shell === null) return;

  shell.hidden = true;
  shell.setAttribute('aria-hidden', 'true');
  setInert(shell, true);
}
