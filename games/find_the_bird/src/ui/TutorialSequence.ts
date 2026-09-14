export type TutorialStage = 'guided' | 'zoom' | 'pan' | 'hint' | 'hinted-find' | 'dismissed';

/** Input-driven tour. Artwork timing never advances the lesson. */
export class TutorialSequence {
  stage: TutorialStage = 'guided';
  guidedFound = 0;
  targetId: string | null;
  private readonly guidedCount: number;

  constructor(firstTarget: string, available: number) {
    this.targetId = firstTarget;
    this.guidedCount = Math.min(3, Math.max(0, available - 1));
    if (this.guidedCount === 0) this.stage = 'zoom';
  }

  found(id: string, next: string | null): boolean {
    if (id !== this.targetId) return false;
    if (this.stage === 'guided') {
      this.guidedFound++;
      this.targetId = next;
      if (this.guidedFound >= this.guidedCount || next === null) this.stage = 'zoom';
    } else if (this.stage === 'hinted-find') {
      this.targetId = null;
      this.stage = 'dismissed';
    } else return false;
    return true;
  }

  zoomed(): void {
    if (this.stage === 'zoom') this.stage = this.targetId === null ? 'dismissed' : 'pan';
  }

  panned(_direction: 'left' | 'right'): void {
    if (this.stage !== 'pan') return;
    this.stage = this.targetId === null ? 'dismissed' : 'hint';
    this.targetId = null;
  }

  hinted(id: string): void {
    if (this.stage !== 'hint') return;
    this.targetId = id;
    this.stage = 'hinted-find';
  }
}
