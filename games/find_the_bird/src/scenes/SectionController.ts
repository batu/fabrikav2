import type Phaser from 'phaser';
import type { LevelData, LevelDog, LevelSection } from '../data/levels';

/**
 * Section-gated camera for wide (landscape) levels.
 *
 * A landscape level has an optional `sections` array on its level.json.
 * Each section is a vertical slice of the wide canvas; the camera shows
 * one section's anchor at a time. When the player finds all dogs in the
 * current section the camera pans to the next. The Well Done overlay
 * appears directly after the last section — landscape levels no longer
 * zoom out (was removing visible letterbox).
 *
 * Portrait levels do not instantiate this class — GameScene falls back
 * to its pre-existing single-view behaviour when `level.sections` is
 * absent.
 */

export interface SectionControllerCallbacks {
  onSectionEntered?: (sectionIndex: number, section: LevelSection) => void;
}

export const SECTION_PAN = {
  preHoldMs: 0,
  durationMs: 2200,
  settleMs: 0,
  inputGraceMs: 100,
  /** Tween used to reset pinch-zoom before a pan so the bounds math is sound. */
  zoomResetMs: 180,
  /** Past this fraction of duration, taps in the destination section register. */
  midpanThreshold: 0.3,
} as const;

export class SectionController {
  currentSectionIndex = 0;
  isPanning = false;
  /** When mid-pan, the index the camera is moving toward. Null otherwise. */
  targetSectionIndex: number | null = null;
  /** Tween progress 0..1; only meaningful while isPanning. */
  private panProgress = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly level: LevelData,
    private readonly sections: LevelSection[],
    /** Canvas-space pixels-per-level-pixel scale */
    private readonly imgScale: number,
    private readonly viewportW: number,
    private readonly viewportH: number,
    private readonly callbacks: SectionControllerCallbacks = {},
  ) {}

  /** Level pixels mapped to canvas pixels for section i → scrollX target. */
  sectionScrollX(sectionIndex: number): number {
    const sec = this.sections[sectionIndex];
    return sec.xStart * this.imgScale;
  }

  /** Canvas viewport X-range for section i (used for camera bounds). */
  sectionCanvasRange(sectionIndex: number): { xStart: number; xEnd: number } {
    const sec = this.sections[sectionIndex];
    return {
      xStart: sec.xStart * this.imgScale,
      xEnd: sec.xEnd * this.imgScale,
    };
  }

  /** Return dogs whose centre falls within section i's x-range. */
  dogsInSection(sectionIndex: number): LevelDog[] {
    const sec = this.sections[sectionIndex];
    return this.level.dogs.filter((d) => d.x >= sec.xStart && d.x < sec.xEnd);
  }

  /** Section index for a given dog (by x centre). */
  sectionForDog(dog: LevelDog): number {
    for (let i = 0; i < this.sections.length; i++) {
      const sec = this.sections[i];
      if (dog.x >= sec.xStart && dog.x < sec.xEnd) return i;
    }
    // Edge case: dog.x === level.width (last section's xEnd is exclusive).
    return this.sections.length - 1;
  }

  /** All dogs in section i are present in the found set. */
  isSectionComplete(sectionIndex: number, foundIds: Set<string>): boolean {
    const sectionDogs = this.dogsInSection(sectionIndex);
    if (sectionDogs.length === 0) return true;
    return sectionDogs.every((d) => foundIds.has(d.id));
  }

  /** Apply camera bounds to the current section (clamps scrollX). */
  clampCameraToCurrentSection(): void {
    const cam = this.scene.cameras.main;
    const { xStart } = this.sectionCanvasRange(this.currentSectionIndex);
    cam.setBounds(xStart, 0, this.viewportW, this.viewportH);
    cam.setScroll(xStart, 0);
  }

  /**
   * Animate the camera from the current section to `targetIndex`.
   * Resolves when the pan has fully settled (including post-settle delay).
   *
   * If the player left the camera pinch-zoomed, tween zoom back to 1 first
   * so the widened-bounds math is sound (bounds are computed in unzoomed
   * canvas space). Temporarily widens bounds for the duration of the pan
   * so the tween can cross what would otherwise be a hard clamp.
   */
  async panToSection(targetIndex: number): Promise<void> {
    const cam = this.scene.cameras.main;
    this.isPanning = true;
    this.targetSectionIndex = targetIndex;
    this.panProgress = 0;

    // Reset zoom if user left it elevated via pinch — bounds math below
    // assumes zoom=1.
    if (Math.abs(cam.zoom - 1) > 0.001) {
      await new Promise<void>((resolve) => {
        this.scene.tweens.add({
          targets: cam,
          zoom: 1,
          duration: SECTION_PAN.zoomResetMs,
          ease: 'Sine.easeOut',
          onComplete: () => resolve(),
        });
      });
    }

    const targetScrollX = this.sectionScrollX(targetIndex);
    const previousScrollX = cam.scrollX;
    // Widen bounds so the tween can traverse
    const minX = Math.min(previousScrollX, targetScrollX);
    const maxX = Math.max(previousScrollX, targetScrollX) + this.viewportW;
    cam.setBounds(minX, 0, maxX - minX, this.viewportH);

    return new Promise<void>((resolve) => {
      const startPan = (): void => {
        this.scene.tweens.add({
          targets: cam,
          scrollX: targetScrollX,
          duration: SECTION_PAN.durationMs,
          ease: 'Sine.easeInOut',
          onUpdate: (tween: Phaser.Tweens.Tween): void => {
            this.panProgress = tween.progress;
          },
          onComplete: () => {
            this.currentSectionIndex = targetIndex;
            const finish = (): void => {
              this.clampCameraToCurrentSection();
              this.isPanning = false;
              this.targetSectionIndex = null;
              this.panProgress = 0;
              this.callbacks.onSectionEntered?.(targetIndex, this.sections[targetIndex]);
              resolve();
            };
            if (SECTION_PAN.settleMs > 0) {
              this.scene.time.delayedCall(SECTION_PAN.settleMs, finish);
            } else {
              finish();
            }
          },
        });
      };

      if (SECTION_PAN.preHoldMs > 0) {
        this.scene.time.delayedCall(SECTION_PAN.preHoldMs, startPan);
      } else {
        startPan();
      }
    });
  }

  /**
   * True once the pan is past `midpanThreshold` of duration. After this
   * point dogs in the destination section become tappable, reinforcing
   * the "one continuous world" feel rather than locking input out for
   * the entire transition.
   */
  get isAfterMidpan(): boolean {
    return this.isPanning && this.panProgress >= SECTION_PAN.midpanThreshold;
  }

  get totalSections(): number {
    return this.sections.length;
  }

  get isLastSection(): boolean {
    return this.currentSectionIndex >= this.sections.length - 1;
  }
}
