export type FindPraisePhrase = 'Good!' | 'Combo!' | 'Incredible!';

/** Attempt-local feedback only: never changes score, rewards, or progression. */
export class FindPraisePolicy {
  private hinted = new Set<string>();
  private count = 0;
  private lastFind: number | null = null;

  find(id: string, now: number, hard: boolean, tutorial = false): FindPraisePhrase | null {
    if (tutorial || this.hinted.has(id)) {
      this.interrupt();
      return null;
    }
    this.count = this.lastFind !== null && now >= this.lastFind && now - this.lastFind <= 4000
      ? this.count + 1 : 1;
    this.lastFind = now;
    const combo = this.count === 3;
    if (combo) this.interrupt();
    return combo ? (hard ? 'Incredible!' : 'Combo!') : hard ? 'Good!' : null;
  }

  markHinted(id: string): void {
    this.hinted.add(id);
    this.interrupt();
  }

  interrupt(): void { this.count = 0; this.lastFind = null; }
  reset(): void { this.interrupt(); this.hinted.clear(); }
}
