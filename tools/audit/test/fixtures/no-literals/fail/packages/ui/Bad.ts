// Every anti-guardrail-#2 pattern, one per line, so the linter must flag all
// three violation kinds: color (hex + rgba), copy, asset path.
export function mountBad(host: HTMLElement): void {
  host.style.color = '#ff0000';
  host.textContent = 'Welcome to the game';
  const bg = 'rgba(0, 0, 0, 0.5)';
  const icon = 'sprites/hero.png';
  host.setAttribute('style', bg + icon);
}
