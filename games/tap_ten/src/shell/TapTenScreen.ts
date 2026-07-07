import { FlowStates } from "@fabrikav2/kernel";
import { mountButton, type ButtonHandle } from "@fabrikav2/ui";
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

  const primary = mountButton({
    mountInto: actions,
    label: copy["menu.play"],
    onClick: () => startOrRestart(opts.controller),
    className: "tap-ten-screen__action",
  });
  const pause = mountButton({
    mountInto: actions,
    label: copy["action.pause"],
    onClick: () => pauseOrResume(opts.controller),
    variant: "secondary",
    className: "tap-ten-screen__action",
  });
  const menu = mountButton({
    mountInto: actions,
    label: copy["action.menu"],
    onClick: () => opts.controller.gotoMenu(),
    variant: "secondary",
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
      render(opts.controller.snapshot(), { status, score: score.value, misses: misses.value }, canvas, {
        primary,
        pause,
        menu,
      });
    },
    destroy(): void {
      unsubscribe();
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

function render(
  snap: TapTenSnapshot,
  labels: { status: HTMLElement; score: HTMLElement; misses: HTMLElement },
  canvas: HTMLCanvasElement,
  buttons: { primary: ButtonHandle; pause: ButtonHandle; menu: ButtonHandle },
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
  buttons.pause.setDisabled(snap.scene !== FlowStates.Playing && snap.scene !== FlowStates.Paused);
  buttons.menu.setDisabled(snap.scene === FlowStates.Menu && !snap.settingsOpen);

  drawBoard(canvas, snap);
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
