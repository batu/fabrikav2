import { FlowStates } from "@fabrikav2/kernel";
import {
  buildButtonElement,
  buildSettingsModel,
  mountButton,
  mountModalShell,
  mountResultCard,
  mountToggleRows,
  type ButtonHandle,
  type SettingKey,
  type UiHandle,
} from "@fabrikav2/ui";
import { assetUrls } from "../../design/theme.ts";
import { copy } from "../../design/copy.ts";
import {
  TAP_TEN_GOAL,
  TAP_TEN_MAX_MISSES,
  TAP_TEN_TILE_COUNT,
  type TapTenController,
  type TapTenSnapshot,
} from "../game/tapTen.ts";

export interface TapTenScreenOptions {
  readonly mountInto: HTMLElement;
  readonly controller: TapTenController;
}

export interface TapTenScreen {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  tileClientPoint(tile: number): { x: number; y: number };
  refresh(): void;
  destroy(): void;
}

const CANVAS_FALLBACK_SIZE = 320;

const surfaceCopy = {
  settingsClose: "Close",
  settingsMusic: "Music",
  settingsSfx: "SFX",
  settingsHaptics: "Haptics",
  resultLevel: "LEVEL {level}",
  winTitle: "Ten hits",
  winMessage: "Clean run. One coin earned.",
  failTitle: "Too many misses",
  failMessage: "Retry the sequence.",
} as const;

export function mountTapTenScreen(opts: TapTenScreenOptions): TapTenScreen {
  const root = document.createElement("main");
  root.className = "tap-ten-screen fab-ui";

  const header = document.createElement("header");
  header.className = "tap-ten-screen__header";

  const title = document.createElement("h1");
  title.className = "tap-ten-screen__title";
  title.textContent = copy["game.title"];

  const status = document.createElement("p");
  status.className = "tap-ten-screen__status";
  status.setAttribute("aria-live", "polite");

  header.append(title, status);

  const stats = document.createElement("dl");
  stats.className = "tap-ten-screen__stats";

  const score = statNode(copy["hud.score"]);
  const misses = statNode(copy["hud.misses"]);
  stats.append(score.root, misses.root);

  const canvas = document.createElement("canvas");
  canvas.className = "tap-ten-screen__board";
  canvas.setAttribute("aria-label", copy["board.label"]);
  canvas.width = CANVAS_FALLBACK_SIZE;
  canvas.height = CANVAS_FALLBACK_SIZE;

  const actions = document.createElement("div");
  actions.className = "tap-ten-screen__actions";

  root.append(header, stats, canvas, actions);
  opts.mountInto.appendChild(root);

  const preferences: Record<SettingKey, boolean> = {
    music: true,
    sfx: true,
    haptics: true,
  };
  const surface: SurfaceMount = { kind: null, handle: null };

  const primary = mountButton({
    mountInto: actions,
    label: copy["menu.play"],
    spriteImage: assetUrls.buttonPrimary,
    onClick: () => startOrRestart(opts.controller),
    className: "tap-ten-screen__action",
  });
  const pause = mountButton({
    mountInto: actions,
    label: copy["action.pause"],
    spriteImage: assetUrls.buttonSecondary,
    onClick: () => pauseOrResume(opts.controller),
    className: "tap-ten-screen__action",
  });
  const menu = mountButton({
    mountInto: actions,
    label: copy["action.menu"],
    spriteImage: assetUrls.buttonSecondary,
    onClick: () => menuOrSettings(opts.controller),
    className: "tap-ten-screen__action",
  });

  canvas.addEventListener("pointerdown", (event) => {
    const snap = opts.controller.snapshot();
    if (snap.scene !== FlowStates.Playing || !snap.inputReady) return;
    opts.controller.tapTile(tileFromClientPoint(canvas, event.clientX, event.clientY));
  });

  const screen: TapTenScreen = {
    root,
    canvas,
    tileClientPoint(tile: number): { x: number; y: number } {
      return clientPointForTile(canvas, tile);
    },
    refresh(): void {
      render(
        opts.controller.snapshot(),
        { status, score: score.value, misses: misses.value },
        canvas,
        { primary, pause, menu },
        { root, surface, controller: opts.controller, preferences },
      );
    },
    destroy(): void {
      unsubscribe();
      clearSurface(surface);
      root.remove();
    },
  };

  const unsubscribe = opts.controller.subscribe(screen.refresh);
  return screen;
}

interface StatNode {
  readonly root: HTMLElement;
  readonly value: HTMLElement;
}

type SurfaceKind = "settings" | "win" | "fail";

interface SurfaceMount {
  kind: SurfaceKind | null;
  handle: UiHandle | null;
}

interface SurfaceContext {
  root: HTMLElement;
  surface: SurfaceMount;
  controller: TapTenController;
  preferences: Record<SettingKey, boolean>;
}

function statNode(labelText: string): StatNode {
  const root = document.createElement("div");
  root.className = "tap-ten-screen__stat";

  const label = document.createElement("dt");
  label.className = "tap-ten-screen__stat-label";
  label.textContent = labelText;

  const value = document.createElement("dd");
  value.className = "tap-ten-screen__stat-value";

  root.append(label, value);
  return { root, value };
}

function startOrRestart(controller: TapTenController): void {
  controller.startLevel(1);
}

function pauseOrResume(controller: TapTenController): void {
  if (controller.snapshot().scene === FlowStates.Paused) {
    controller.resume();
  } else {
    controller.pause();
  }
}

function menuOrSettings(controller: TapTenController): void {
  const snap = controller.snapshot();
  if (snap.scene === FlowStates.Menu && !snap.settingsOpen) {
    controller.openSettings();
    return;
  }
  controller.gotoMenu();
}

function render(
  snap: TapTenSnapshot,
  labels: { status: HTMLElement; score: HTMLElement; misses: HTMLElement },
  canvas: HTMLCanvasElement,
  buttons: { primary: ButtonHandle; pause: ButtonHandle; menu: ButtonHandle },
  surface: SurfaceContext,
): void {
  labels.status.textContent = statusCopy(snap);
  labels.score.textContent = copy["hud.scoreValue"]
    .replace("{score}", String(snap.score))
    .replace("{goal}", String(TAP_TEN_GOAL));
  labels.misses.textContent = copy["hud.missValue"]
    .replace("{misses}", String(snap.misses))
    .replace("{limit}", String(TAP_TEN_MAX_MISSES));

  buttons.primary.setLabel(snap.scene === FlowStates.Menu ? copy["menu.play"] : copy["action.restart"]);
  buttons.pause.setLabel(snap.scene === FlowStates.Paused ? copy["action.resume"] : copy["action.pause"]);
  buttons.menu.setLabel(snap.scene === FlowStates.Menu && !snap.settingsOpen ? copy["state.settings"] : copy["action.menu"]);
  buttons.pause.setDisabled(snap.scene !== FlowStates.Playing && snap.scene !== FlowStates.Paused);
  buttons.menu.setDisabled(snap.settingsOpen);

  drawBoard(canvas, snap);
  reconcileSurface(snap, surface);
}

function targetSurface(snap: TapTenSnapshot): SurfaceKind | null {
  if (snap.settingsOpen) return "settings";
  if (snap.scene === FlowStates.Complete) return "win";
  if (snap.scene === FlowStates.Failed) return "fail";
  return null;
}

function reconcileSurface(snap: TapTenSnapshot, ctx: SurfaceContext): void {
  const next = targetSurface(snap);
  if (ctx.surface.kind === next) return;
  clearSurface(ctx.surface);
  if (next === null) return;
  ctx.surface.kind = next;
  ctx.surface.handle = mountSurface(next, snap, ctx);
}

function clearSurface(surface: SurfaceMount): void {
  const handle = surface.handle;
  surface.kind = null;
  surface.handle = null;
  handle?.dismiss();
}

function mountSurface(kind: SurfaceKind, snap: TapTenSnapshot, ctx: SurfaceContext): UiHandle {
  switch (kind) {
    case "settings":
      return mountSettingsSurface(ctx);
    case "win":
      return mountResultSurface("win", snap, ctx);
    case "fail":
      return mountResultSurface("fail", snap, ctx);
  }
}

function mountSettingsSurface(ctx: SurfaceContext): UiHandle {
  const togglesSection = document.createElement("div");
  togglesSection.className = "tap-ten-surface__toggles";
  const actions = document.createElement("div");
  actions.className = "fab-modal-actions tap-ten-surface__actions";
  actions.appendChild(
    buildSpriteAction({
      label: surfaceCopy.settingsClose,
      image: assetUrls.buttonPrimary,
      dataAction: "settings-close",
      onClick: () => ctx.controller.gotoMenu(),
    }),
  );

  let toggles: UiHandle | null = null;
  const handle = mountModalShell({
    mountInto: ctx.root,
    ribbon: {
      title: copy["state.settings"],
      image: assetUrls.ribbonNeutral,
    },
    body: togglesSection,
    actions,
    cardClassName: "tap-ten-surface tap-ten-surface--settings",
    cardImage: assetUrls.popup,
    onDismiss: () => toggles?.dismiss(),
  });
  toggles = mountToggleRows({
    mountInto: togglesSection,
    rows: buildSettingsModel({
      ...ctx.preferences,
      labels: {
        music: surfaceCopy.settingsMusic,
        sfx: surfaceCopy.settingsSfx,
        haptics: surfaceCopy.settingsHaptics,
      },
    }).toggles,
    onToggle: (key, next) => {
      ctx.preferences[key as SettingKey] = next;
    },
  });
  return handle;
}

function mountResultSurface(kind: "win" | "fail", snap: TapTenSnapshot, ctx: SurfaceContext): UiHandle {
  const isWin = kind === "win";
  const actions = document.createElement("div");
  actions.className = "fab-modal-actions tap-ten-surface__actions";
  actions.append(
    buildSpriteAction({
      label: isWin ? copy["action.restart"] : copy["action.restart"],
      image: assetUrls.buttonPrimary,
      dataAction: isWin ? "result-restart" : "result-retry",
      onClick: () => ctx.controller.startLevel(snap.levelId),
    }),
    buildSpriteAction({
      label: copy["action.menu"],
      image: assetUrls.buttonSecondary,
      dataAction: "result-menu",
      onClick: () => ctx.controller.gotoMenu(),
    }),
  );

  return mountResultCard({
    mountInto: ctx.root,
    variant: isWin ? "win" : "lose",
    title: isWin ? surfaceCopy.winTitle : surfaceCopy.failTitle,
    eyebrow: surfaceCopy.resultLevel.replace("{level}", String(snap.levelId)),
    ribbonImage: isWin ? assetUrls.ribbonWin : assetUrls.ribbonFail,
    cardImage: assetUrls.popup,
    messages: isWin ? surfaceCopy.winMessage : surfaceCopy.failMessage,
    rewardDisplay: isWin ? buildRewardNode(snap.coins) : undefined,
    actions,
  });
}

function buildRewardNode(coins: number): HTMLElement {
  const reward = document.createElement("div");
  reward.className = "tap-ten-surface__reward";
  reward.textContent = `+${Math.max(1, coins)}`;
  return reward;
}

function buildSpriteAction(opts: {
  label: string;
  image: string;
  dataAction: string;
  onClick: () => void;
}): HTMLButtonElement {
  return buildButtonElement({
    label: opts.label,
    spriteImage: opts.image,
    dataAction: opts.dataAction,
    className: "tap-ten-surface__button",
    onClick: () => opts.onClick(),
  });
}

function statusCopy(snap: TapTenSnapshot): string {
  if (snap.settingsOpen) return copy["state.settings"];
  switch (snap.scene) {
    case FlowStates.Playing:
      return copy["state.playing"];
    case FlowStates.Paused:
      return copy["state.paused"];
    case FlowStates.Complete:
      return copy["state.win"];
    case FlowStates.Failed:
      return copy["state.fail"];
    case FlowStates.Menu:
    default:
      return copy["state.menu"];
  }
}

function drawBoard(canvas: HTMLCanvasElement, snap: TapTenSnapshot): void {
  const context = canvas.getContext("2d");
  if (!context) return;

  const { size, ratio } = resizeCanvas(canvas);
  const style = getComputedStyle(canvas);
  const boardBg = token(style, "--fab-tap-board-bg", "Canvas");
  const tileIdle = token(style, "--fab-tap-tile-idle", "ButtonFace");
  const tileLit = token(style, "--fab-tap-tile-lit", "Highlight");
  const tileDone = token(style, "--fab-tap-tile-done", "CanvasText");
  const tileFail = token(style, "--fab-tap-tile-fail", "Mark");
  const text = token(style, "--fab-tap-board-text", "CanvasText");
  const gap = numericToken(style, "--fab-tap-board-gap", 12);
  const radius = numericToken(style, "--fab-tap-tile-radius", 18);
  const cell = (size - gap * 3) / 2;

  context.save();
  context.scale(ratio, ratio);
  context.clearRect(0, 0, size, size);
  context.fillStyle = boardBg;
  roundRect(context, 0, 0, size, size, radius + gap);
  context.fill();

  for (let tile = 0; tile < TAP_TEN_TILE_COUNT; tile += 1) {
    const col = tile % 2;
    const row = Math.floor(tile / 2);
    const x = gap + col * (cell + gap);
    const y = gap + row * (cell + gap);
    context.fillStyle = tileFill(snap, tile, tileIdle, tileLit, tileDone, tileFail);
    roundRect(context, x, y, cell, cell, radius);
    context.fill();
    context.fillStyle = text;
    context.font = token(style, "--fab-tap-board-font", "700 34px system-ui");
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(tile + 1), x + cell / 2, y + cell / 2);
  }
  context.restore();
}

function tileFill(
  snap: TapTenSnapshot,
  tile: number,
  idle: string,
  lit: string,
  done: string,
  fail: string,
): string {
  if (snap.scene === FlowStates.Complete) return done;
  if (snap.scene === FlowStates.Failed) return fail;
  if (snap.scene === FlowStates.Playing && tile === snap.litTile) return lit;
  return idle;
}

function token(style: CSSStyleDeclaration, name: string, fallback: string): string {
  return style.getPropertyValue(name).trim() || fallback;
}

function numericToken(style: CSSStyleDeclaration, name: string, fallback: number): number {
  const raw = Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(raw) ? raw : fallback;
}

function resizeCanvas(canvas: HTMLCanvasElement): { size: number; ratio: number } {
  const rect = canvas.getBoundingClientRect();
  const cssSize = Math.max(1, Math.round(rect.width || CANVAS_FALLBACK_SIZE));
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.round(cssSize * ratio);
  if (canvas.width !== width || canvas.height !== width) {
    canvas.width = width;
    canvas.height = width;
  }
  return { size: cssSize, ratio };
}

function tileFromClientPoint(canvas: HTMLCanvasElement, x: number, y: number): number {
  const rect = canvas.getBoundingClientRect();
  const size = rect.width || CANVAS_FALLBACK_SIZE;
  const localX = Math.max(0, Math.min(size - 1, x - rect.left));
  const localY = Math.max(0, Math.min(size - 1, y - rect.top));
  const col = localX < size / 2 ? 0 : 1;
  const row = localY < size / 2 ? 0 : 1;
  return row * 2 + col;
}

function clientPointForTile(canvas: HTMLCanvasElement, tile: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const size = rect.width || CANVAS_FALLBACK_SIZE;
  const normalized = Math.max(0, Math.min(TAP_TEN_TILE_COUNT - 1, Math.trunc(tile)));
  const col = normalized % 2;
  const row = Math.floor(normalized / 2);
  return {
    x: rect.left + size * (col === 0 ? 0.25 : 0.75),
    y: rect.top + size * (row === 0 ? 0.25 : 0.75),
  };
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}
