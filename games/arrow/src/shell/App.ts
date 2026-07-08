import { createFlowMachine, FlowStates, type FlowMachine } from "@fabrikav2/kernel";
import {
  mountHomeMenu,
  mountModalShell,
  mountPauseOverlay,
  mountResultCard,
  type ModalAction,
  type UiHandle,
} from "@fabrikav2/ui";
import {
  captureCanvasPng,
  createPerfRecorder,
  type CaptureResult,
  type ClientPoint,
  type GameHarness,
  type GameVerbHandler,
  type HarnessSaveProfile,
  type PerfRecorder,
  type PerfSample,
} from "@fabrikav2/testkit/harness";
import { driveTo as driveToState } from "@fabrikav2/testkit/testing";
import { copy } from "../../design/copy.js";
import { assetUrls } from "../../design/theme.js";
import { GameController, type GameHooks } from "../game/GameController.js";
import { getLevel, TOTAL_LEVELS } from "../game/levels.js";
import { blockedAtTurn1 } from "../game/solver.js";
import {
  load as loadProgress,
  PROGRESS_KEY,
  recordJuice,
  recordLevelComplete,
  save as saveProgress,
  type Progress,
} from "../game/persist.js";
import type { JuiceSettings } from "../game/juice.js";
import { ARROW_PACK, buildSagaNodes, isSagaLevelOpen } from "./saga.js";

export type ArrowVerb = "tapCell";

export interface ArrowHarness extends GameHarness<ArrowVerb> {
  cellClientPoint(x: number, y: number): ClientPoint | null;
}

export interface AppMounts {
  canvas: HTMLCanvasElement;
  uiRoot: HTMLElement;
}

const BUILD_VERSION = "dev";
const PACKAGE_ID = "com.basegamelab.arrow.dev";

function isTestHarnessEnabled(): boolean {
  const env = import.meta.env;
  return env.MODE !== "production" || env.VITE_ENABLE_TEST_HARNESS === "true";
}

const TEST_HARNESS_ENABLED = isTestHarnessEnabled();

function clampLevelId(id: number): number {
  return Math.min(TOTAL_LEVELS, Math.max(1, Math.floor(id)));
}

function firstFailableLevel(): number {
  for (let id = 1; id <= TOTAL_LEVELS; id += 1) {
    const level = getLevel(id);
    if (level && blockedAtTurn1(level.cols, level.rows, level.paths) > 0) return id;
  }
  return 1;
}

const FAIL_FIXTURE_LEVEL = firstFailableLevel();

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly uiRoot: HTMLElement;
  private readonly controller: GameController;
  private readonly machine: FlowMachine;
  private readonly perfRecorder: PerfRecorder = createPerfRecorder();
  private screenHandle: UiHandle | null = null;
  private settingsHandle: UiHandle | null = null;
  private progress: Progress = loadProgress();
  private pendingCompleteLevelId = 0;
  private currentLevelId = 0;
  private perfRunning = false;

  constructor(mounts: AppMounts) {
    this.canvas = mounts.canvas;
    this.uiRoot = mounts.uiRoot;

    const hooks: GameHooks = {
      getProgress: () => this.progress,
      onLevelComplete: (level) => this.handleComplete(level.index),
      onLevelFailed: (level) => this.handleFail(level.index),
      onSettingsRequested: () => this.openSettings(true),
      onSelectLevel: (levelId) => this.startLevelId(levelId),
      onTutorialDone: () => this.updateProgress({ ...this.progress, tutorialSeen: true }),
      onFullCompletion: () => undefined,
      onJuiceChange: (juice) => this.onJuiceChange(juice),
    };
    this.controller = new GameController(this.canvas, hooks);
    this.machine = createFlowMachine({ optionalStates: [FlowStates.Paused, FlowStates.LevelSelect] });
    this.machine.events.on("menu:enter", () => this.renderMenu());
    this.machine.events.on("level:start", (payload) => this.enterLevel(Number(payload.levelId)));
    this.machine.events.on("level:complete", () => this.renderComplete());
    this.machine.events.on("level:fail", () => this.renderFailed());
    if (TEST_HARNESS_ENABLED) this.startPerfLoop();
  }

  start(): void {
    this.toMenu();
  }

  resize(): void {
    this.controller.resize();
  }

  harness(): ArrowHarness {
    return {
      gotoState: (state) => this.gotoState(state),
      startLevel: (id) => this.startLevelId(id),
      snapshot: () => this.snapshot(),
      sagaNodes: () => buildSagaNodes(this.progress).map((node) => node.id),
      unlockAll: () => {
        this.updateProgress({
          ...this.progress,
          packProgress: { ...this.progress.packProgress, [ARROW_PACK]: TOTAL_LEVELS },
        });
        this.refreshMenuIfVisible();
      },
      grantCoins: () => undefined,
      resetSave: () => {
        localStorage.removeItem(PROGRESS_KEY);
        this.progress = loadProgress();
        this.renderMenu();
      },
      seedSave: (profile) => {
        this.seedSave(profile);
        this.refreshMenuIfVisible();
      },
      verbs: this.buildVerbs(),
      winLevel: () => this.runAutoWin(),
      failLevel: () => this.runAutoFail(),
      driveTo: (state) => this.driveTo(state),
      capture: (): CaptureResult => captureCanvasPng(this.canvas),
      perf: (): PerfSample => this.perfRecorder.sample(),
      cellClientPoint: (x, y) => this.controller.cellClientPoint(x, y),
    };
  }

  private renderMenu(): void {
    this.clearScreen();
    this.dismissSettings();
    this.controller.showIdle();
    const playLevel = this.nextPlayableLevel();
    this.screenHandle = mountHomeMenu({
      mountInto: this.uiRoot,
      header: this.buildMenuHeader(),
      saga: {
        state: { nodes: buildSagaNodes(this.progress) },
        actions: { onSelectLevel: (id) => this.onSagaSelect(Number(id)) },
        loadingLabel: copy["saga.loading"],
      },
      actions: [
        {
          label: copy["menu.play"],
          ariaLabel: `${copy["menu.play"]} ${copy["menu.levelButton"]} ${playLevel}`,
          dataAction: "play",
          className: "arrow-play-button",
          onClick: () => this.startLevelId(playLevel),
        },
      ],
    });
  }

  private enterLevel(levelId: number): void {
    this.clearScreen();
    this.dismissSettings();
    this.currentLevelId = clampLevelId(levelId);
    this.controller.startLevel(this.currentLevelId);
  }

  private renderComplete(): void {
    const levelId = this.pendingCompleteLevelId || this.currentLevelId;
    const level = getLevel(levelId);
    if (level?.pack && level.indexInPack !== undefined) {
      this.updateProgress(recordLevelComplete(this.progress, level.pack, level.indexInPack));
    }
    this.controller.stop();
    this.clearScreen();
    if ((this.progress.packProgress[ARROW_PACK] ?? 0) >= TOTAL_LEVELS) {
      this.mountFinale();
    } else {
      this.mountWin(levelId);
    }
  }

  private renderFailed(): void {
    this.controller.stop();
    this.clearScreen();
    this.mountLose();
  }

  private buildMenuHeader(): HTMLElement {
    const header = document.createElement("div");
    header.className = "arrow-menu-header";
    const titleWrap = document.createElement("div");
    const title = document.createElement("h1");
    title.className = "arrow-menu-title";
    title.textContent = copy["game.title"];
    const subtitle = document.createElement("div");
    subtitle.className = "arrow-menu-subtitle";
    subtitle.textContent = copy["menu.saga"];
    titleWrap.append(title, subtitle);
    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "arrow-icon-button";
    settings.dataset.fabAction = "settings";
    settings.setAttribute("aria-label", copy["menu.settings"]);
    const settingsIcon = document.createElement("img");
    settingsIcon.src = assetUrls.gear;
    settingsIcon.alt = "";
    settingsIcon.setAttribute("aria-hidden", "true");
    settings.appendChild(settingsIcon);
    settings.addEventListener("click", () => this.openSettings(false));
    header.append(titleWrap, settings);
    return header;
  }

  private mountWin(levelId: number): void {
    this.screenHandle = mountResultCard({
      mountInto: this.uiRoot,
      variant: "win",
      title: copy["result.win.title"],
      eyebrow: `${copy["menu.levelButton"]} ${levelId}`,
      ribbonImage: assetUrls.ribbonWin,
      messages: copy["result.win.message"],
      actions: this.resultActions([
        {
          label: copy["result.win.next"],
          dataAction: "result-next",
          onClick: () => this.next(levelId),
        },
        {
          label: copy["result.win.replay"],
          dataAction: "result-replay",
          onClick: () => this.startLevelId(levelId),
        },
      ]),
    });
  }

  private mountFinale(): void {
    this.screenHandle = mountResultCard({
      mountInto: this.uiRoot,
      variant: "win",
      title: copy["result.finale.title"],
      ribbonImage: assetUrls.ribbonWin,
      messages: copy["result.finale.message"],
      actions: this.resultActions([
        {
          label: copy["result.finale.action"],
          dataAction: "result-menu",
          onClick: () => this.toMenu(),
        },
      ]),
    });
  }

  private mountLose(): void {
    this.screenHandle = mountResultCard({
      mountInto: this.uiRoot,
      variant: "lose",
      title: copy["result.lose.title"],
      eyebrow: `${copy["menu.levelButton"]} ${this.currentLevelId}`,
      ribbonImage: assetUrls.ribbonLose,
      messages: copy["result.lose.message"],
      actions: this.resultActions([
        {
          label: copy["result.lose.retry"],
          dataAction: "result-retry",
          onClick: () => this.retry(),
        },
        {
          label: copy["result.lose.quit"],
          dataAction: "result-menu",
          onClick: () => this.toMenu(),
        },
      ]),
    });
  }

  private resultActions(actions: ModalAction[]): ModalAction[] {
    return actions.map((action) => ({ ...action, className: "arrow-result-action" }));
  }

  private openSettings(inGame: boolean): void {
    if (this.settingsHandle) return;
    if (inGame) this.controller.stop();
    const body = document.createElement("div");
    body.className = "arrow-settings-body";
    const row = document.createElement("div");
    row.className = "arrow-settings-row";
    row.textContent = copy["settings.body"];
    body.appendChild(row);
    this.settingsHandle = mountModalShell({
      mountInto: this.uiRoot,
      title: copy["settings.title"],
      closeButton: {
        label: copy["settings.closeGlyph"],
        ariaLabel: copy["settings.close"],
        dataAction: "settings-close",
      },
      body,
      actions: this.settingsActions(inGame),
      backdropDismiss: true,
      cardClassName: "arrow-settings-card",
      onDismiss: () => {
        this.settingsHandle = null;
        if (inGame && this.machine.state === FlowStates.Playing) {
          this.controller.startLevel(this.currentLevelId);
        }
      },
    });
  }

  private settingsActions(inGame: boolean): ModalAction[] {
    const actions: ModalAction[] = [
      {
        label: copy["settings.restart"],
        dataAction: "settings-restart",
        onClick: () => {
          this.dismissSettings();
          this.startLevelId(this.currentLevelId || this.nextPlayableLevel());
        },
      },
      {
        label: copy["settings.restartAll"],
        dataAction: "settings-reset",
        onClick: () => {
          this.dismissSettings();
          this.resetProgress();
        },
      },
    ];
    if (inGame) {
      actions.push({
        label: copy["pause.quit"],
        dataAction: "settings-home",
        onClick: () => {
          this.dismissSettings();
          this.toMenu();
        },
      });
    }
    return actions.map((action) => ({ ...action, className: "arrow-settings-action" }));
  }

  private mountPause(): void {
    this.screenHandle = mountPauseOverlay({
      mountInto: this.uiRoot,
      actions: {
        onResume: () => this.resumeGame(),
        onSettings: () => this.openSettings(true),
        onQuit: () => this.toMenu(),
      },
      labels: {
        title: copy["pause.title"],
        resume: copy["pause.resume"],
        settings: copy["pause.settings"],
        quit: copy["pause.quit"],
      },
    });
  }

  private toMenu(): void {
    if (this.machine.state === FlowStates.Menu) {
      this.renderMenu();
      return;
    }
    if (this.machine.state === FlowStates.Boot || this.machine.can("toMenu")) {
      this.machine.toMenu();
    }
  }

  private startLevelId(levelId: number): void {
    const id = clampLevelId(levelId);
    if (this.machine.state !== FlowStates.Boot && this.machine.state !== FlowStates.Menu) {
      if (this.machine.can("toMenu")) this.machine.toMenu();
    }
    if (this.machine.can("start")) this.machine.start(String(id));
  }

  private next(levelId: number): void {
    const nextId = levelId + 1;
    if (nextId > TOTAL_LEVELS) {
      this.toMenu();
      return;
    }
    if (this.machine.can("next")) this.machine.next(String(nextId));
  }

  private retry(): void {
    if (this.machine.can("retry")) this.machine.retry();
  }

  private pauseGame(): void {
    if (!this.machine.can("pause")) return;
    this.machine.pause();
    this.controller.stop();
    this.clearScreen();
    this.mountPause();
  }

  private resumeGame(): void {
    if (!this.machine.can("resume")) return;
    this.machine.resume();
    this.clearScreen();
    this.controller.startLevel(this.currentLevelId);
  }

  private onSagaSelect(levelId: number): void {
    if (!isSagaLevelOpen(this.progress, levelId)) return;
    this.startLevelId(levelId);
  }

  private handleComplete(levelId: number): void {
    this.pendingCompleteLevelId = levelId;
    if (this.machine.can("complete")) this.machine.complete();
  }

  private handleFail(levelId: number): void {
    this.currentLevelId = levelId;
    if (this.machine.can("fail")) this.machine.fail();
  }

  private nextPlayableLevel(): number {
    const done = this.progress.packProgress[ARROW_PACK] ?? 0;
    return done >= TOTAL_LEVELS ? 1 : done + 1;
  }

  private resetProgress(): void {
    localStorage.removeItem(PROGRESS_KEY);
    this.progress = loadProgress();
    this.toMenu();
  }

  private seedSave(profile: HarnessSaveProfile): void {
    const unlocked = profile.unlockedLevel === undefined
      ? this.nextPlayableLevel()
      : clampLevelId(profile.unlockedLevel);
    this.updateProgress({
      ...this.progress,
      packProgress: {
        ...this.progress.packProgress,
        [ARROW_PACK]: Math.max(0, unlocked - 1),
      },
      mute: profile.sfx === false,
    });
  }

  private onJuiceChange(juice: JuiceSettings): void {
    this.updateProgress(recordJuice(this.progress, juice));
  }

  private updateProgress(progress: Progress): void {
    this.progress = progress;
    saveProgress(this.progress);
  }

  private refreshMenuIfVisible(): void {
    if (this.machine.state === FlowStates.Menu) this.renderMenu();
  }

  private clearScreen(): void {
    if (this.screenHandle) {
      this.screenHandle.dismiss();
      this.screenHandle = null;
    }
  }

  private dismissSettings(): void {
    if (this.settingsHandle) {
      const handle = this.settingsHandle;
      this.settingsHandle = null;
      handle.dismiss();
    }
  }

  private async runAutoWin(): Promise<boolean> {
    return this.controller.winLevel();
  }

  private async runAutoFail(): Promise<boolean> {
    if (await this.controller.failLevel()) return true;
    this.startLevelId(FAIL_FIXTURE_LEVEL);
    if (!(await this.waitForInputReady())) return false;
    return this.controller.failLevel();
  }

  private async waitForInputReady(): Promise<boolean> {
    for (let i = 0; i < 60; i += 1) {
      if (this.snapshot().inputReady === true) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return this.snapshot().inputReady === true;
  }

  private driveTo(state: string): Promise<boolean> {
    return driveToState({
      gotoMenu: () => this.toMenu(),
      startLevel: (id) => this.startLevelId(id),
      openSettings: () => this.openSettings(false),
      pause: () => this.pauseGame(),
      autoWin: () => this.runAutoWin(),
      autoFail: () => this.runAutoFail(),
      snapshot: () => this.snapshot(),
    }, state);
  }

  private gotoState(state: string): void {
    switch (state) {
      case "Settings":
        this.toMenu();
        this.openSettings(false);
        return;
      case "PauseOverlay":
        this.startLevelId(1);
        this.pauseGame();
        return;
      case "ResultCard":
        this.startLevelId(1);
        return;
      case "HomeMenu":
      case "SagaMap":
      default:
        this.toMenu();
    }
  }

  private buildVerbs(): Record<ArrowVerb, GameVerbHandler> {
    const offscreen: ClientPoint = { x: -1, y: -1 };
    return {
      tapCell: {
        run: (x: number, y: number) => this.controller.tapCell(x, y),
        clientPoint: (x: number, y: number) => this.controller.cellClientPoint(x, y) ?? offscreen,
      },
    };
  }

  private startPerfLoop(): void {
    if (this.perfRunning) return;
    this.perfRunning = true;
    let last = performance.now();
    const tick = (): void => {
      const now = performance.now();
      this.perfRecorder.record(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  snapshot(): Record<string, unknown> {
    const controller = this.controller.snapshot();
    return {
      ...controller,
      scene: this.machine.state,
      settingsOpen: this.settingsHandle !== null,
      packProgress: { ...this.progress.packProgress },
      sagaNodeIds:
        this.machine.state === FlowStates.Menu || this.machine.state === FlowStates.LevelSelect
          ? buildSagaNodes(this.progress).map((node) => node.id)
          : [],
      packageId: PACKAGE_ID,
      buildVersion: BUILD_VERSION,
    };
  }
}

export const isHarnessEnabled = TEST_HARNESS_ENABLED;
