import { GameplayController, type GameplayHooks } from '../../../../games/marble_run/src/gameplay/GameplayController.ts';
import type { LevelDef } from '../../../../games/marble_run/src/marble-board/types.ts';

export type PreviewOutcome = 'playing' | 'won' | 'failed';

export interface PreviewController {
  startLevelDefinition(level: LevelDef): void;
  dispose(): void;
}

export type PreviewControllerFactory = (host: HTMLElement, hooks: GameplayHooks) => PreviewController;

export interface EditorGameplayPreviewOptions {
  readonly onOutcome?: (outcome: PreviewOutcome) => void;
  readonly controllerFactory?: PreviewControllerFactory;
}

/** One isolated gameplay renderer. Its hooks cannot reach runtime services. */
export class EditorGameplayPreview {
  private readonly controllerFactory: PreviewControllerFactory;
  private readonly onOutcome: (outcome: PreviewOutcome) => void;
  private controller: PreviewController | null = null;
  private level: LevelDef | null = null;

  constructor(private readonly host: HTMLElement, options: EditorGameplayPreviewOptions = {}) {
    this.controllerFactory = options.controllerFactory ?? ((element, hooks) => new GameplayController(element, hooks));
    this.onOutcome = options.onOutcome ?? (() => undefined);
  }

  open(level: LevelDef): void {
    this.close();
    this.level = level;
    this.controller = this.controllerFactory(this.host, {
      getCoins: () => 0,
      spendCoins: () => false,
      onWin: () => this.onOutcome('won'),
      onFail: () => this.onOutcome('failed'),
      onHintUsed: () => undefined,
      openSettings: () => undefined,
      isFirstLevel: () => false,
    });
    this.controller.startLevelDefinition(level);
    this.onOutcome('playing');
  }

  restart(): boolean {
    if (this.controller === null || this.level === null) return false;
    this.controller.startLevelDefinition(this.level);
    this.onOutcome('playing');
    return true;
  }

  close(): void {
    this.controller?.dispose();
    this.controller = null;
    this.level = null;
  }

  dispose(): void { this.close(); }
}
