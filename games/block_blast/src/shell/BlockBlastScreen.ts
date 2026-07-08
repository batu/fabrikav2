import { FlowStates } from "@fabrikav2/kernel";
import {
  buildButtonElement,
  buildSettingsModel,
  mountHomeMenu,
  mountModalShell,
  mountPauseOverlay,
  mountResultCard,
  mountToggleRows,
  type SettingKey,
  type UiHandle,
} from "@fabrikav2/ui";

import { BLOCK_BLAST_STAGE_COUNT } from "../../content/stages.ts";
import { copy } from "../../design/copy.ts";
import { assetUrls } from "../../design/theme.ts";
import type { BlockBlastController } from "../game/BlockBlastFlow.ts";
import { getPieceById } from "../game/pieces.ts";
import { GRID_SIZE, HAND_SLOTS } from "../game/rules.ts";
import type { BlockBlastSnapshot, PieceDefinition, StageObjective } from "../game/types.ts";

export interface BlockBlastScreenOptions {
  readonly mountInto: HTMLElement;
  readonly controller: BlockBlastController;
}

export interface BlockBlastScreen {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  slotClientPoint(slotIndex: number): { x: number; y: number };
  cellClientPoint(anchorX: number, anchorY: number): { x: number; y: number };
  refresh(): void;
  destroy(): void;
}

interface Layout {
  readonly width: number;
  readonly height: number;
  readonly boardX: number;
  readonly boardY: number;
  readonly boardSize: number;
  readonly cell: number;
  readonly gap: number;
  readonly handY: number;
  readonly slotSize: number;
  readonly slotCenters: readonly { x: number; y: number }[];
}

interface SurfaceMount {
  kind: "menu" | "settings" | "pause" | "win" | "fail" | null;
  handle: UiHandle | null;
}

const BLOCK_COLORS = [
  "--bb-block-a",
  "--bb-block-b",
  "--bb-block-c",
  "--bb-block-d",
  "--bb-block-e",
  "--bb-block-f",
  "--bb-block-g",
] as const;

export function mountBlockBlastScreen(opts: BlockBlastScreenOptions): BlockBlastScreen {
  const root = document.createElement("main");
  root.className = "block-blast-screen fab-ui";

  const header = document.createElement("header");
  header.className = "block-blast-screen__header";
  const title = document.createElement("h1");
  title.className = "block-blast-screen__title";
  title.textContent = copy["game.title"];
  const subtitle = document.createElement("p");
  subtitle.className = "block-blast-screen__subtitle";
  header.append(title, subtitle);

  const stats = document.createElement("dl");
  stats.className = "block-blast-screen__stats";
  const score = statNode(copy["hud.score"]);
  const best = statNode(copy["hud.best"]);
  const stage = statNode(copy["hud.stage"]);
  const target = statNode(copy["hud.target"]);
  stats.append(score.root, best.root, stage.root, target.root);

  const canvas = document.createElement("canvas");
  canvas.className = "block-blast-screen__canvas";
  canvas.width = 390;
  canvas.height = 650;

  const actions = document.createElement("div");
  actions.className = "block-blast-screen__actions";
  actions.append(
    buildAction(copy["action.pause"], "pause", () => opts.controller.pause()),
    buildAction(copy["action.restart"], "restart", () => restartCurrent(opts.controller)),
    buildAction(copy["action.menu"], "menu", () => opts.controller.gotoMenu()),
  );

  const overlay = document.createElement("div");
  overlay.className = "block-blast-screen__overlay";

  root.append(header, stats, canvas, actions, overlay);
  opts.mountInto.appendChild(root);

  let lastLayout = layoutForCanvas(canvas);
  const surface: SurfaceMount = { kind: null, handle: null };
  const preferences: Record<SettingKey, boolean> = { music: true, sfx: true, haptics: true };

  canvas.addEventListener("pointerdown", (event) => {
    const point = canvasPoint(canvas, event.clientX, event.clientY);
    const layout = lastLayout;
    const slot = slotAtPoint(layout, point.x, point.y);
    if (slot !== null) {
      opts.controller.selectSlot(slot);
      return;
    }
    const cell = cellAtPoint(layout, point.x, point.y);
    if (cell) opts.controller.tapCell(cell.anchorX, cell.anchorY);
  });

  const screen: BlockBlastScreen = {
    root,
    canvas,
    slotClientPoint(slotIndex: number): { x: number; y: number } {
      lastLayout = layoutForCanvas(canvas);
      const center = lastLayout.slotCenters[Math.max(0, Math.min(HAND_SLOTS - 1, Math.trunc(slotIndex)))]!;
      return clientPoint(canvas, center.x, center.y);
    },
    cellClientPoint(anchorX: number, anchorY: number): { x: number; y: number } {
      lastLayout = layoutForCanvas(canvas);
      return clientPoint(
        canvas,
        lastLayout.boardX + anchorX * (lastLayout.cell + lastLayout.gap) + lastLayout.cell / 2,
        lastLayout.boardY + anchorY * (lastLayout.cell + lastLayout.gap) + lastLayout.cell / 2,
      );
    },
    refresh(): void {
      const snap = opts.controller.snapshot();
      subtitle.textContent = subtitleFor(snap);
      score.value.textContent = String(snap.score);
      best.value.textContent = String(snap.bestScore);
      stage.value.textContent = snap.mode === "endless" ? copy["hud.mode.endless"] : String(snap.stageId);
      target.value.textContent = targetCopy(snap.objective);
      lastLayout = renderCanvas(canvas, root, snap);
      reconcileSurface(snap, {
        overlay,
        surface,
        controller: opts.controller,
        preferences,
      });
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

interface SurfaceContext {
  readonly overlay: HTMLElement;
  readonly surface: SurfaceMount;
  readonly controller: BlockBlastController;
  readonly preferences: Record<SettingKey, boolean>;
}

function statNode(labelText: string): StatNode {
  const root = document.createElement("div");
  root.className = "block-blast-screen__stat";
  const label = document.createElement("dt");
  label.className = "block-blast-screen__stat-label";
  label.textContent = labelText;
  const value = document.createElement("dd");
  value.className = "block-blast-screen__stat-value";
  root.append(label, value);
  return { root, value };
}

function buildAction(label: string, action: string, onClick: () => void): HTMLButtonElement {
  return buildButtonElement({
    label,
    dataAction: action,
    className: "block-blast-screen__action",
    onClick,
  });
}

function restartCurrent(controller: BlockBlastController): void {
  const snap = controller.snapshot();
  if (snap.mode === "endless") controller.startEndless();
  else controller.startStage(snap.stageId);
}

function subtitleFor(snap: BlockBlastSnapshot): string {
  if (snap.scene === FlowStates.Menu) return copy["menu.best"].replace("{score}", String(snap.bestScore));
  if (snap.mode === "endless") return copy["hud.mode.endless"];
  return copy["menu.stage"].replace("{stage}", String(snap.stageId));
}

function targetCopy(objective: StageObjective): string {
  if (objective.kind === "score") return copy["target.score"].replace("{target}", String(objective.target));
  if (objective.kind === "placements") return copy["target.placements"].replace("{target}", String(objective.target));
  return copy["hud.mode.endless"];
}

function targetSurface(snap: BlockBlastSnapshot): SurfaceMount["kind"] {
  if (snap.settingsOpen) return "settings";
  if (snap.scene === FlowStates.Menu) return "menu";
  if (snap.scene === FlowStates.Paused) return "pause";
  if (snap.scene === FlowStates.Complete) return "win";
  if (snap.scene === FlowStates.Failed) return "fail";
  return null;
}

function reconcileSurface(snap: BlockBlastSnapshot, ctx: SurfaceContext): void {
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

function mountSurface(kind: NonNullable<SurfaceMount["kind"]>, snap: BlockBlastSnapshot, ctx: SurfaceContext): UiHandle {
  if (kind === "menu") return mountMenuSurface(snap, ctx);
  if (kind === "settings") return mountSettingsSurface(ctx);
  if (kind === "pause") {
    return mountPauseOverlay({
      mountInto: ctx.overlay,
      labels: {
        title: copy["action.pause"],
        resume: copy["action.resume"],
        settings: copy["action.settings"],
        quit: copy["action.menu"],
      },
      actions: {
        onResume: () => ctx.controller.resume(),
        onSettings: () => ctx.controller.openSettings(),
        onQuit: () => ctx.controller.gotoMenu(),
      },
    });
  }
  return mountResultSurface(kind, snap, ctx);
}

function mountMenuSurface(snap: BlockBlastSnapshot, ctx: SurfaceContext): UiHandle {
  const header = document.createElement("div");
  header.className = "block-blast-menu-header";
  const title = document.createElement("h2");
  title.className = "block-blast-menu-header__title";
  title.textContent = copy["game.title"];
  const best = document.createElement("p");
  best.className = "block-blast-menu-header__best";
  best.textContent = copy["menu.best"].replace("{score}", String(snap.bestScore));
  header.append(title, best);

  return mountHomeMenu({
    mountInto: ctx.overlay,
    header,
    saga: {
      state: { nodes: buildSagaNodes(snap) },
      actions: {
        onSelectLevel: (id) => {
          const level = Number(id);
          if (Number.isFinite(level) && level <= snap.unlockedStage) ctx.controller.startStage(level);
        },
      },
      loadingLabel: copy["menu.loading"],
    },
    actions: [
      {
        label: copy["menu.stage"].replace("{stage}", String(snap.unlockedStage)),
        dataAction: "play",
        onClick: () => ctx.controller.startStage(snap.unlockedStage),
      },
      {
        label: copy["menu.endless"],
        dataAction: "endless",
        onClick: () => ctx.controller.startEndless(),
      },
      {
        label: copy["action.settings"],
        dataAction: "settings",
        onClick: () => ctx.controller.openSettings(),
      },
    ],
  });
}

function buildSagaNodes(snap: BlockBlastSnapshot) {
  const windowSize = 6;
  const current = Math.max(1, Math.min(BLOCK_BLAST_STAGE_COUNT, snap.unlockedStage));
  const start = Math.max(1, Math.min(current - 1, BLOCK_BLAST_STAGE_COUNT - windowSize + 1));
  const end = Math.min(BLOCK_BLAST_STAGE_COUNT, start + windowSize - 1);
  const nodes = [];
  for (let id = end; id >= start; id -= 1) {
    nodes.push({
      id,
      label: String(id),
      name: copy["menu.stage"].replace("{stage}", String(id)),
      state: snap.completedStages.includes(id) ? "completed" : id === current ? "current" : "locked",
    } as const);
  }
  return nodes;
}

function mountSettingsSurface(ctx: SurfaceContext): UiHandle {
  const body = document.createElement("div");
  body.className = "block-blast-surface__body";
  let toggles: UiHandle | null = null;
  const handle = mountModalShell({
    mountInto: ctx.overlay,
    title: copy["settings.title"],
    body,
    actions: [
      {
        label: copy["action.close"],
        dataAction: "settings-close",
        onClick: () => ctx.controller.closeSettings(),
      },
    ],
    cardClassName: "block-blast-surface",
    onDismiss: () => toggles?.dismiss(),
  });
  toggles = mountToggleRows({
    mountInto: body,
    rows: buildSettingsModel({
      ...ctx.preferences,
      labels: {
        music: copy["settings.music"],
        sfx: copy["settings.sfx"],
        haptics: copy["settings.haptics"],
      },
    }).toggles,
    onToggle: (key, next) => {
      ctx.preferences[key as SettingKey] = next;
    },
  });
  return handle;
}

function mountResultSurface(kind: "win" | "fail", snap: BlockBlastSnapshot, ctx: SurfaceContext): UiHandle {
  const isWin = kind === "win";
  const score = document.createElement("div");
  score.className = "block-blast-surface__score";
  score.textContent = copy["result.score"].replace("{score}", String(snap.score));
  const nextStage = Math.min(BLOCK_BLAST_STAGE_COUNT, snap.stageId + 1);

  return mountResultCard({
    mountInto: ctx.overlay,
    variant: isWin ? "win" : "lose",
    title: isWin ? copy["result.win.title"] : copy["result.fail.title"],
    eyebrow: snap.mode === "endless" ? copy["hud.mode.endless"] : copy["menu.stage"].replace("{stage}", String(snap.stageId)),
    ribbonImage: isWin ? assetUrls.ribbonWin : assetUrls.ribbonFail,
    messages: isWin ? copy["result.win.message"] : copy["result.fail.message"],
    rewardDisplay: score,
    actions: isWin
      ? [
          {
            label: copy["action.next"],
            dataAction: "result-next",
            onClick: () => (snap.mode === "endless" ? ctx.controller.startEndless() : ctx.controller.startStage(nextStage)),
          },
          {
            label: copy["action.menu"],
            dataAction: "result-menu",
            onClick: () => ctx.controller.gotoMenu(),
          },
        ]
      : [
          {
            label: copy["action.retry"],
            dataAction: "result-retry",
            onClick: () => (snap.mode === "endless" ? ctx.controller.startEndless() : ctx.controller.startStage(snap.stageId)),
          },
          {
            label: copy["action.menu"],
            dataAction: "result-menu",
            onClick: () => ctx.controller.gotoMenu(),
          },
        ],
  });
}

function renderCanvas(canvas: HTMLCanvasElement, root: HTMLElement, snap: BlockBlastSnapshot): Layout {
  const layout = layoutForCanvas(canvas);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(layout.width * dpr));
  canvas.height = Math.max(1, Math.round(layout.height * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return layout;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, layout.width, layout.height);
  const palette = paletteFrom(root);
  drawBoard(ctx, layout, snap, palette);
  drawHand(ctx, layout, snap, palette);
  return layout;
}

function layoutForCanvas(canvas: HTMLCanvasElement): Layout {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 390;
  const height = rect.height || 650;
  const gap = 4;
  const boardSize = Math.min(width - 34, height * 0.58, 370);
  const cell = (boardSize - gap * (GRID_SIZE - 1)) / GRID_SIZE;
  const boardX = (width - boardSize) / 2;
  const boardY = 28;
  const slotSize = Math.min(86, width * 0.23);
  const handY = height - slotSize - 26;
  const slotCenters = Array.from({ length: HAND_SLOTS }, (_, i) => ({
    x: width * (0.22 + i * 0.28),
    y: handY + slotSize / 2,
  }));
  return { width, height, boardX, boardY, boardSize, cell, gap, handY, slotSize, slotCenters };
}

interface Palette {
  readonly boardBg: string;
  readonly empty: string;
  readonly line: string;
  readonly preview: string;
  readonly previewBad: string;
  readonly blocks: readonly string[];
}

function paletteFrom(root: HTMLElement): Palette {
  const styles = getComputedStyle(root);
  const read = (name: string): string => styles.getPropertyValue(name).trim();
  return {
    boardBg: read("--bb-board-bg"),
    empty: read("--bb-board-empty"),
    line: read("--bb-board-line"),
    preview: read("--bb-board-preview"),
    previewBad: read("--bb-board-preview-bad"),
    blocks: BLOCK_COLORS.map(read),
  };
}

function drawBoard(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  snap: BlockBlastSnapshot,
  palette: Palette,
): void {
  roundedRect(ctx, layout.boardX - 8, layout.boardY - 8, layout.boardSize + 16, layout.boardSize + 16, 14);
  ctx.fillStyle = palette.boardBg;
  ctx.fill();

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const px = layout.boardX + x * (layout.cell + layout.gap);
      const py = layout.boardY + y * (layout.cell + layout.gap);
      roundedRect(ctx, px, py, layout.cell, layout.cell, 7);
      const cell = snap.board[y]![x];
      ctx.fillStyle = cell === null ? palette.empty : palette.blocks[cell % palette.blocks.length]!;
      ctx.fill();
    }
  }

  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 2;
  roundedRect(ctx, layout.boardX - 8, layout.boardY - 8, layout.boardSize + 16, layout.boardSize + 16, 14);
  ctx.stroke();
}

function drawHand(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  snap: BlockBlastSnapshot,
  palette: Palette,
): void {
  for (let slot = 0; slot < HAND_SLOTS; slot += 1) {
    const center = layout.slotCenters[slot]!;
    roundedRect(ctx, center.x - layout.slotSize / 2, layout.handY, layout.slotSize, layout.slotSize, 12);
    ctx.fillStyle = snap.activeSlot === slot ? palette.preview : palette.empty;
    ctx.fill();
    const piece = pieceFromSnapshot(snap, slot);
    if (!piece) continue;
    drawPiece(ctx, piece, center.x, center.y, layout.slotSize / 5.4, palette);
  }
}

function pieceFromSnapshot(snap: BlockBlastSnapshot, slot: number): PieceDefinition | null {
  const pieceId = snap.handPieceIds[slot];
  if (!pieceId) return null;
  return getPieceById(pieceId);
}

function drawPiece(
  ctx: CanvasRenderingContext2D,
  piece: PieceDefinition,
  centerX: number,
  centerY: number,
  cellSize: number,
  palette: Palette,
): void {
  const maxX = Math.max(...piece.cells.map((cell) => cell.x));
  const maxY = Math.max(...piece.cells.map((cell) => cell.y));
  const originX = centerX - ((maxX + 1) * cellSize) / 2;
  const originY = centerY - ((maxY + 1) * cellSize) / 2;
  for (const cell of piece.cells) {
    roundedRect(ctx, originX + cell.x * cellSize, originY + cell.y * cellSize, cellSize - 2, cellSize - 2, 5);
    ctx.fillStyle = palette.blocks[piece.colorIndex % palette.blocks.length]!;
    ctx.fill();
  }
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function canvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

function clientPoint(canvas: HTMLCanvasElement, x: number, y: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: rect.left + x, y: rect.top + y };
}

function slotAtPoint(layout: Layout, x: number, y: number): number | null {
  for (let slot = 0; slot < HAND_SLOTS; slot += 1) {
    const center = layout.slotCenters[slot]!;
    if (
      x >= center.x - layout.slotSize / 2 &&
      x <= center.x + layout.slotSize / 2 &&
      y >= layout.handY &&
      y <= layout.handY + layout.slotSize
    ) {
      return slot;
    }
  }
  return null;
}

function cellAtPoint(layout: Layout, x: number, y: number): { anchorX: number; anchorY: number } | null {
  if (
    x < layout.boardX ||
    x > layout.boardX + layout.boardSize ||
    y < layout.boardY ||
    y > layout.boardY + layout.boardSize
  ) {
    return null;
  }
  const anchorX = Math.floor((x - layout.boardX) / (layout.cell + layout.gap));
  const anchorY = Math.floor((y - layout.boardY) / (layout.cell + layout.gap));
  if (anchorX < 0 || anchorX >= GRID_SIZE || anchorY < 0 || anchorY >= GRID_SIZE) return null;
  return { anchorX, anchorY };
}
