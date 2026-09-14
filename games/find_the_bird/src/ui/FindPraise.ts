import { prefersReducedMotion } from '@fabrikav2/ui';
import type { FindPraisePhrase } from './FindPraisePolicy';

export const FIND_PRAISE = { maxActive: 2, durationMs: 1300 } as const;

/** Screen-space feedback; never participates in hit testing or scoring. */
export class FindPraise {
  private active = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

  show(x: number, y: number, phrase: FindPraisePhrase): void {
    while (this.active.size >= FIND_PRAISE.maxActive) this.remove(this.active.keys().next().value!);
    const el = document.createElement('div');
    el.className = 'find-praise';
    el.dataset.reducedMotion = String(prefersReducedMotion());
    const label = document.createElement('span');
    label.className = 'find-praise-word';
    label.textContent = phrase;
    el.appendChild(label);
    if (phrase !== 'Good!') {
      const stars = document.createElement('span');
      stars.className = 'find-praise-stars';
      stars.textContent = '★ ★ ★';
      el.appendChild(stars);
    }
    for (let i = 0; i < 4; i++) {
      const spark = document.createElement('i');
      spark.className = 'find-praise-spark';
      spark.textContent = '✦';
      spark.style.setProperty('--spark-index', String(i));
      el.appendChild(spark);
    }
    el.style.left = `${Math.max(110, Math.min(window.innerWidth - 110, x))}px`;
    el.style.top = `${Math.max(140, Math.min(window.innerHeight - 175, y - 45))}px`;
    (document.getElementById('hud-overlay') ?? document.body).appendChild(el);
    this.active.set(el, setTimeout(() => this.remove(el), FIND_PRAISE.durationMs));
  }

  private remove(el: HTMLElement): void {
    clearTimeout(this.active.get(el));
    this.active.delete(el);
    el.remove();
  }

  clear(): void { for (const el of this.active.keys()) this.remove(el); }
}
