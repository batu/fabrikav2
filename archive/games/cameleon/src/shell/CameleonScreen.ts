import {
  mountHomeMenu,
  mountModalShell,
  mountPauseOverlay,
  mountResultCard,
  mountToaster,
  mountToggleRows,
  type LevelMapNode,
  type ToasterHandle,
  type UiHandle,
} from "@fabrikav2/ui";

import { copy, type CopyKey } from "../../design/copy.ts";
import { assetUrls } from "../../design/theme.ts";
import { gameConfig } from "../../game.config.ts";
import type { CameleonSnapshot } from "../game/CameleonController.ts";
import {
  CAMELEON_DIRECTIONS,
  CAMELEON_LEVEL_IDS,
  CAMELEON_PLAY_MODES,
  type CameleonDirection,
  type CameleonLevelId,
  type CameleonPlayMode,
} from "../game/level.ts";

export interface CameleonScreenOptions {
  readonly mountInto: HTMLElement;
  readonly onModeSelect?: (mode: CameleonPlayMode) => void;
  readonly onDirectionSelect?: (direction: CameleonDirection) => void;
  readonly onStartLevel?: (levelId: CameleonLevelId) => void;
  readonly onStart?: () => void;
  readonly onContinue?: () => void;
  readonly onRetry?: () => void;
  readonly onConfirmAim?: () => void;
  readonly onPause?: () => void;
  readonly onResume?: () => void;
  readonly onQuitToMenu?: () => void;
  readonly onSettingsOpen?: () => void;
  readonly onSettingsClose?: () => void;
}

export interface CameleonScreen {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  refresh(snapshot: CameleonSnapshot): void;
  showToast(message: string): void;
  destroy(): void;
}

const CANVAS_FALLBACK_WIDTH = 390;
const CANVAS_FALLBACK_HEIGHT = 844;

const CAMELEON_SAGA_LEVELS = [
  { id: "bathhouse", label: "1", name: "saga.level.bathhouse" },
  { id: "waterpark", label: "2", name: "saga.level.waterpark" },
  { id: "museum", label: "3", name: "saga.level.museum" },
  { id: "lido", label: "4", name: "saga.level.lido" },
] as const satisfies readonly { readonly id: CameleonLevelId; readonly label: string; readonly name: CopyKey }[];

const MODE_COPY_KEYS = {
  tap: "mode.tap",
  shoot: "mode.shoot",
  confirm: "mode.confirm",
} as const satisfies Record<CameleonPlayMode, CopyKey>;

const DIRECTION_COPY_KEYS = {
  screenprint: "direction.screenprint",
} as const satisfies Record<CameleonDirection, CopyKey>;

type SurfaceKind = "home" | "settings" | "pause" | "win" | "fail";
type CameleonSettingKey = "sfx" | "haptics";

interface SurfaceMount {
  key: string | null;
  kind: SurfaceKind | null;
  handle: UiHandle | null;
  settingsControls: SettingsControls | null;
}

interface SettingsControls {
  readonly modeButtons: ReadonlyMap<CameleonPlayMode, HTMLButtonElement>;
  readonly directionButtons: ReadonlyMap<CameleonDirection, HTMLButtonElement>;
  readonly toggles: UiHandle;
  readonly toggleInputs: ReadonlyMap<CameleonSettingKey, HTMLInputElement>;
}

const DEFAULT_SETTINGS: Record<CameleonSettingKey, boolean> = {
  sfx: true,
  haptics: true,
};

export function buildCameleonSagaNodes(unlockedLevel = 1): LevelMapNode[] {
  const current = clampLevel(unlockedLevel);
  return CAMELEON_SAGA_LEVELS
    .slice(0, gameConfig.saga.levels)
    .map((level, index) => {
      const levelNumber = index + 1;
      return {
      id: level.id,
      label: level.label,
      name: copy[level.name],
        state:
          levelNumber < current
            ? ("completed" as const)
            : levelNumber === current
              ? ("current" as const)
              : ("locked" as const),
      };
    })
    .reverse();
}

export function mountCameleonScreen(opts: CameleonScreenOptions): CameleonScreen {
  const root = document.createElement("main");
  root.className = "cameleon-screen fab-ui";

  const canvas = document.createElement("canvas");
  canvas.className = "cameleon-screen__canvas";
  canvas.setAttribute("aria-label", copy["board.label"]);
  canvas.width = CANVAS_FALLBACK_WIDTH;
  canvas.height = CANVAS_FALLBACK_HEIGHT;

  const hud = document.createElement("section");
  hud.className = "cameleon-screen__hud";

  const found = hudItem(copy["hud.found"]);
  const mode = hudItem(copy["hud.mode"]);
  const ammo = hudItem(copy["hud.darts"]);
  ammo.root.classList.add("cameleon-screen__hud-item--ammo");

  const ammoRow = document.createElement("div");
  ammoRow.className = "cameleon-screen__ammo";
  ammo.root.appendChild(ammoRow);

  const pauseButton = document.createElement("button");
  pauseButton.className = "cameleon-screen__pause-button";
  pauseButton.type = "button";
  pauseButton.setAttribute("aria-label", copy["hud.pause"]);
  pauseButton.textContent = copy["hud.pauseGlyph"];
  pauseButton.addEventListener("click", () => opts.onPause?.());

  const reticle = document.createElement("div");
  reticle.className = "cameleon-screen__reticle";
  reticle.setAttribute("aria-hidden", "true");

  const confirmBar = document.createElement("div");
  confirmBar.className = "cameleon-screen__confirm-bar";
  const confirmButton = document.createElement("button");
  confirmButton.className = "cameleon-screen__confirm";
  confirmButton.type = "button";
  confirmButton.textContent = copy["action.confirm"];
  confirmButton.addEventListener("click", () => opts.onConfirmAim?.());
  confirmBar.appendChild(confirmButton);

  const bench = document.createElement("section");
  bench.className = "cameleon-screen__bench";
  bench.setAttribute("aria-label", copy["bench.label"]);
  const benchSlots = Array.from({ length: 12 }, (_, index) => {
    const slot = document.createElement("span");
    slot.className = "cameleon-screen__bench-slot";
    slot.setAttribute("aria-label", copy["bench.slot"].replace("{slot}", String(index + 1)));
    bench.appendChild(slot);
    return slot;
  });

  hud.append(found.root, mode.root, ammo.root, pauseButton);
  root.append(canvas, hud, reticle, confirmBar, bench);
  opts.mountInto.appendChild(root);

  const toaster = mountToaster({
    mountInto: root,
    className: "cameleon-screen__toaster",
  });
  const preferences = { ...DEFAULT_SETTINGS };
  const surface: SurfaceMount = {
    key: null,
    kind: null,
    handle: null,
    settingsControls: null,
  };

  const screen: CameleonScreen = {
    root,
    canvas,
    refresh(snapshot: CameleonSnapshot): void {
      root.dataset.state = snapshot.scene;
      root.dataset.mode = snapshot.mode;
      root.dataset.inputReady = String(snapshot.inputReady);
      root.dataset.surface = targetSurfaceKey(snapshot) ?? "";
      found.value.textContent = copy["hud.foundValue"]
        .replace("{found}", String(snapshot.foundCount))
        .replace("{total}", String(snapshot.hides.length));
      mode.value.textContent = modeLabel(snapshot.mode);
      ammo.value.textContent = ammoLabel(snapshot);
      renderAmmo(ammoRow, snapshot);
      hud.hidden = snapshot.scene !== "playing" && snapshot.scene !== "paused";
      pauseButton.hidden = snapshot.scene !== "playing";
      confirmBar.hidden = snapshot.scene !== "playing" || snapshot.mode !== "confirm";
      confirmButton.disabled = snapshot.scene !== "playing" || snapshot.mode !== "confirm" || !snapshot.aim?.armed;
      renderReticle(root, reticle, snapshot);
      renderBench(benchSlots, snapshot);
      bench.hidden = snapshot.scene !== "playing" && snapshot.scene !== "paused";
      reconcileSurface(root, snapshot, surface, preferences, opts, toaster);
    },
    showToast(message: string): void {
      toaster.show(message);
    },
    destroy(): void {
      clearSurface(surface);
      toaster.dismiss();
      root.remove();
    },
  };

  return screen;
}

interface HudItem {
  readonly root: HTMLElement;
  readonly value: HTMLElement;
}

function hudItem(labelText: string): HudItem {
  const root = document.createElement("div");
  root.className = "cameleon-screen__hud-item";

  const label = document.createElement("span");
  label.className = "cameleon-screen__hud-label";
  label.textContent = labelText;

  const value = document.createElement("strong");
  value.className = "cameleon-screen__hud-value";

  root.append(label, value);
  return { root, value };
}

function targetSurfaceKey(snapshot: CameleonSnapshot): string | null {
  if (snapshot.settingsOpen) return "settings";
  if (snapshot.scene === "menu") return "home";
  if (snapshot.scene === "paused") return "pause";
  if (snapshot.scene === "complete") return snapshot.spotless ? "win:spotless" : "win";
  if (snapshot.scene === "failed") return "fail";
  return null;
}

function surfaceKind(key: string): SurfaceKind {
  if (key.startsWith("win")) return "win";
  if (key === "fail") return "fail";
  if (key === "settings") return "settings";
  if (key === "pause") return "pause";
  return "home";
}

function reconcileSurface(
  mountInto: HTMLElement,
  snapshot: CameleonSnapshot,
  surface: SurfaceMount,
  preferences: Record<CameleonSettingKey, boolean>,
  opts: CameleonScreenOptions,
  toaster: ToasterHandle,
): void {
  const nextKey = targetSurfaceKey(snapshot);
  if (surface.key !== nextKey) {
    clearSurface(surface);
    if (nextKey !== null) mountSurface(mountInto, nextKey, snapshot, surface, preferences, opts, toaster);
  }
  if (surface.kind === "settings" && surface.settingsControls) {
    updateSettingsControls(surface.settingsControls, snapshot, preferences);
  }
}

function mountSurface(
  mountInto: HTMLElement,
  key: string,
  snapshot: CameleonSnapshot,
  surface: SurfaceMount,
  preferences: Record<CameleonSettingKey, boolean>,
  opts: CameleonScreenOptions,
  toaster: ToasterHandle,
): void {
  surface.key = key;
  surface.kind = surfaceKind(key);
  switch (surface.kind) {
    case "home":
      surface.handle = mountHomeSurface(mountInto, snapshot, opts, toaster);
      return;
    case "settings": {
      const mounted = mountSettingsSurface(mountInto, snapshot, preferences, opts, toaster);
      surface.handle = mounted.handle;
      surface.settingsControls = mounted.controls;
      return;
    }
    case "pause":
      surface.handle = mountPauseSurface(mountInto, opts);
      return;
    case "win":
      surface.handle = mountResultSurface(mountInto, "win", snapshot, opts);
      return;
    case "fail":
      surface.handle = mountResultSurface(mountInto, "fail", snapshot, opts);
      return;
  }
}

function clearSurface(surface: SurfaceMount): void {
  const handle = surface.handle;
  const controls = surface.settingsControls;
  surface.key = null;
  surface.kind = null;
  surface.handle = null;
  surface.settingsControls = null;
  controls?.toggles.dismiss();
  handle?.dismiss();
}

function mountHomeSurface(
  mountInto: HTMLElement,
  snapshot: CameleonSnapshot,
  opts: CameleonScreenOptions,
  toaster: ToasterHandle,
): UiHandle {
  const header = document.createElement("header");
  header.className = "cameleon-screen__menu-header";
  const title = document.createElement("h1");
  title.className = "cameleon-screen__menu-title";
  title.textContent = copy["game.title"];
  header.appendChild(title);

  return mountHomeMenu({
    mountInto,
    header,
    saga: {
      state: { nodes: buildCameleonSagaNodes(snapshot.unlockedLevel) },
      actions: {
        onSelectLevel: (id) => {
          if (typeof id === "string" && (CAMELEON_LEVEL_IDS as readonly string[]).includes(id)) {
            opts.onStartLevel?.(id as CameleonLevelId);
            return;
          }
          toaster.show(copy["toast.locked"]);
        },
      },
      loadingLabel: copy["saga.loading"],
    },
    actions: [
      {
        label: copy["menu.play"],
        spriteImage: assetUrls.buttonPrimary,
        className: "cameleon-screen__menu-action cameleon-screen__play",
        dataAction: "play",
        onClick: () => opts.onStart?.(),
      },
      {
        label: copy["menu.settings"],
        spriteImage: assetUrls.buttonSecondary,
        className: "cameleon-screen__menu-action cameleon-screen__settings-open",
        dataAction: "settings",
        onClick: () => opts.onSettingsOpen?.(),
      },
    ],
    id: "cameleon-home-menu",
  });
}

function mountSettingsSurface(
  mountInto: HTMLElement,
  snapshot: CameleonSnapshot,
  preferences: Record<CameleonSettingKey, boolean>,
  opts: CameleonScreenOptions,
  toaster: ToasterHandle,
): { readonly handle: UiHandle; readonly controls: SettingsControls } {
  const body = document.createElement("div");
  body.className = "cameleon-screen__settings-body";

  const modeSection = pickerSection(copy["settings.mode"]);
  const modeButtons = new Map<CameleonPlayMode, HTMLButtonElement>();
  for (const playMode of CAMELEON_PLAY_MODES) {
    const button = pickerButton(modeLabel(playMode), "mode", playMode);
    button.addEventListener("click", () => opts.onModeSelect?.(playMode));
    modeButtons.set(playMode, button);
    modeSection.options.appendChild(button);
  }

  const directionSection = pickerSection(copy["settings.direction"]);
  const directionButtons = new Map<CameleonDirection, HTMLButtonElement>();
  for (const visualDirection of CAMELEON_DIRECTIONS) {
    const button = pickerButton(directionLabel(visualDirection), "direction", visualDirection);
    button.addEventListener("click", () => opts.onDirectionSelect?.(visualDirection));
    directionButtons.set(visualDirection, button);
    directionSection.options.appendChild(button);
  }
  // A one-option picker is clutter: hide the row while only one style ships.
  directionSection.root.hidden = CAMELEON_DIRECTIONS.length < 2;

  const togglesSection = document.createElement("div");
  togglesSection.className = "cameleon-screen__settings-toggles";
  const toggles = mountToggleRows({
    mountInto: togglesSection,
    rows: [
      { key: "sfx", label: copy["settings.sfx"], value: preferences.sfx },
      { key: "haptics", label: copy["settings.haptics"], value: preferences.haptics },
    ],
    onToggle: (key, next) => {
      if (key !== "sfx" && key !== "haptics") return;
      preferences[key] = next;
      toaster.show(next ? copy["toast.enabled"] : copy["toast.disabled"]);
    },
    id: "cameleon-settings-toggles",
  });
  const toggleInputs = new Map<CameleonSettingKey, HTMLInputElement>();
  for (const key of ["sfx", "haptics"] as const) {
    const input = toggles.el.querySelector<HTMLInputElement>(`.fab-toggle-row[data-fab-toggle-key="${key}"] input`);
    if (input) toggleInputs.set(key, input);
  }

  body.append(modeSection.root, directionSection.root, togglesSection);
  const handle = mountModalShell({
    mountInto,
    ribbon: {
      title: copy["settings.title"],
      image: assetUrls.ribbonNeutral,
    },
    closeButton: {
      label: copy["settings.closeGlyph"],
      ariaLabel: copy["settings.close"],
      dataAction: "settings-close",
      className: "cameleon-screen__modal-close",
    },
    body,
    backdropDismiss: true,
    cardClassName: "cameleon-screen__modal-card cameleon-screen__settings-card",
    cardImage: assetUrls.popup,
    onDismiss: () => opts.onSettingsClose?.(),
    id: "cameleon-settings",
  });
  const controls = { modeButtons, directionButtons, toggles, toggleInputs };
  updateSettingsControls(controls, snapshot, preferences);
  return { handle, controls };
}

function pickerSection(labelText: string): { readonly root: HTMLElement; readonly options: HTMLElement } {
  const root = document.createElement("section");
  root.className = "cameleon-screen__settings-section";
  const label = document.createElement("h3");
  label.className = "cameleon-screen__settings-label";
  label.textContent = labelText;
  const options = document.createElement("div");
  options.className = "cameleon-screen__settings-options";
  root.append(label, options);
  return { root, options };
}

function pickerButton(label: string, kind: "mode" | "direction", value: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = `cameleon-screen__picker-button cameleon-screen__${kind}-button`;
  button.type = "button";
  button.textContent = label;
  button.dataset[kind] = value;
  return button;
}

function updateSettingsControls(
  controls: SettingsControls,
  snapshot: CameleonSnapshot,
  preferences: Record<CameleonSettingKey, boolean>,
): void {
  for (const [playMode, button] of controls.modeButtons) {
    button.setAttribute("aria-pressed", String(playMode === snapshot.mode));
  }
  for (const [visualDirection, button] of controls.directionButtons) {
    button.setAttribute("aria-pressed", String(visualDirection === snapshot.dir));
  }
  for (const [key, input] of controls.toggleInputs) {
    input.checked = preferences[key];
  }
}

function mountPauseSurface(mountInto: HTMLElement, opts: CameleonScreenOptions): UiHandle {
  return mountPauseOverlay({
    mountInto,
    actions: {
      onResume: () => opts.onResume?.(),
      onSettings: () => opts.onSettingsOpen?.(),
      onQuit: () => opts.onQuitToMenu?.(),
    },
    labels: {
      title: copy["pause.title"],
      resume: copy["pause.resume"],
      settings: copy["pause.settings"],
      quit: copy["pause.quit"],
    },
    id: "cameleon-pause",
  });
}

function mountResultSurface(
  mountInto: HTMLElement,
  kind: "win" | "fail",
  snapshot: CameleonSnapshot,
  opts: CameleonScreenOptions,
): UiHandle {
  const isWin = kind === "win";
  const title = isWin
    ? snapshot.spotless
      ? copy["result.spotless"]
      : copy["result.win"]
    : copy["result.fail"];
  return mountResultCard({
    mountInto,
    variant: isWin ? "win" : "lose",
    title,
    eyebrow: copy["result.level"].replace("{level}", snapshot.levelId.toUpperCase()),
    ribbonImage: isWin ? assetUrls.ribbonWin : assetUrls.ribbonFail,
    cardImage: assetUrls.popup,
    messages: isWin ? undefined : formatFoundCount(snapshot),
    rewardDisplay: isWin ? resultCountNode(snapshot) : undefined,
    actions: [
      {
        label: isWin ? copy["result.continue"] : copy["result.retry"],
        spriteImage: assetUrls.buttonPrimary,
        className: "cameleon-screen__result-action",
        dataAction: isWin ? "result-continue" : "result-retry",
        onClick: () => {
          if (isWin) opts.onContinue?.();
          else opts.onRetry?.();
        },
      },
    ],
    id: isWin ? "cameleon-result-win" : "cameleon-result-fail",
  });
}

function resultCountNode(snapshot: CameleonSnapshot): HTMLElement {
  const node = document.createElement("strong");
  node.className = "cameleon-screen__result-count";
  node.textContent = formatFoundCount(snapshot);
  return node;
}

function modeLabel(mode: CameleonPlayMode): string {
  return copy[MODE_COPY_KEYS[mode]];
}

function directionLabel(direction: CameleonDirection): string {
  return copy[DIRECTION_COPY_KEYS[direction]];
}

function ammoLabel(snapshot: CameleonSnapshot): string {
  if (snapshot.maxAmmo === null) return copy["hud.dartsFree"];
  return copy["hud.dartsValue"]
    .replace("{ammo}", String(snapshot.ammo ?? 0))
    .replace("{max}", String(snapshot.maxAmmo));
}

function formatFoundCount(snapshot: CameleonSnapshot): string {
  return copy["result.count"]
    .replace("{found}", String(snapshot.foundCount))
    .replace("{total}", String(snapshot.hides.length));
}

function renderAmmo(row: HTMLElement, snapshot: CameleonSnapshot): void {
  const maxAmmo = snapshot.maxAmmo ?? 0;
  row.replaceChildren();
  for (let index = 0; index < maxAmmo; index += 1) {
    const dart = document.createElement("span");
    dart.className = "cameleon-screen__dart";
    dart.dataset.spent = String(index >= (snapshot.ammo ?? 0));
    row.appendChild(dart);
  }
}

function renderReticle(root: HTMLElement, reticle: HTMLElement, snapshot: CameleonSnapshot): void {
  const aim = snapshot.aim;
  const visible =
    snapshot.scene === "playing" &&
    snapshot.mode === "confirm" &&
    aim !== null &&
    aim.point.x >= snapshot.scrollX &&
    aim.point.x <= snapshot.scrollX + snapshot.viewport.width &&
    aim.point.y >= 0 &&
    aim.point.y <= snapshot.viewport.height;

  reticle.hidden = !visible;
  if (!visible || !aim) return;

  const x = ((aim.point.x - snapshot.scrollX) / snapshot.viewport.width) * 100;
  const y = (aim.point.y / snapshot.viewport.height) * 100;
  root.style.setProperty("--cameleon-reticle-x", `${x}%`);
  root.style.setProperty("--cameleon-reticle-y", `${y}%`);
  reticle.dataset.armed = String(aim.armed);
}

function renderBench(slots: readonly HTMLElement[], snapshot: CameleonSnapshot): void {
  slots.forEach((slot, index) => {
    const hide = snapshot.hides[index];
    const found = hide?.phase === "found";
    slot.dataset.found = String(found);
    slot.setAttribute(
      "aria-label",
      found && hide
        ? copy["bench.collected"].replace("{id}", hide.id)
        : copy["bench.slot"].replace("{slot}", String(index + 1)),
    );
  });
}

function clampLevel(levelNumber: number): number {
  const max = Math.max(1, Math.min(CAMELEON_LEVEL_IDS.length, gameConfig.saga.levels));
  if (!Number.isFinite(levelNumber)) return 1;
  return Math.min(Math.max(Math.trunc(levelNumber), 1), max);
}
