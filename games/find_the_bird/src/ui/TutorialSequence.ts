export type TutorialStage = 'guided' | 'zoom' | 'zoomed-find' | 'hint' | 'hinted-find' | 'objective' | 'dismissed';

/** Input-driven tour. Artwork timing never advances the lesson. */
export class TutorialSequence {
  stage: TutorialStage = 'guided';
  guidedFound = 0;
  targetId: string | null;
  private readonly guidedCount: number;

  constructor(firstTarget: string, available: number) {
    this.targetId = firstTarget;
    this.guidedCount = Math.min(3, Math.max(0, available - 2));
    if (this.guidedCount === 0) this.stage = 'zoom';
  }

  found(id: string, next: string | null): boolean {
    if (id !== this.targetId) return false;
    if (this.stage === 'guided') {
      this.guidedFound++;
      this.targetId = next;
      if (this.guidedFound >= this.guidedCount || next === null) this.stage = 'zoom';
    } else if (this.stage === 'zoomed-find') {
      this.targetId = null;
      this.stage = next === null ? 'objective' : 'hint';
    } else if (this.stage === 'hinted-find') {
      this.targetId = null;
      this.stage = 'objective';
    } else return false;
    return true;
  }

  zoomed(): void {
    if (this.stage === 'zoom') this.stage = this.targetId === null ? 'objective' : 'zoomed-find';
  }

  hinted(id: string): void {
    if (this.stage !== 'hint') return;
    this.targetId = id;
    this.stage = 'hinted-find';
  }
}
