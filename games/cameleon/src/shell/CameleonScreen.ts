import { copy } from "../../design/copy.ts";
import type { CameleonSnapshot } from "../game/CameleonController.ts";
import { CAMELEON_PLAY_MODES, type CameleonPlayMode } from "../game/level.ts";

export interface CameleonScreenOptions {
  readonly mountInto: HTMLElement;
  readonly onModeSelect?: (mode: CameleonPlayMode) => void;
  readonly onStart?: () => void;
  readonly onConfirmAim?: () => void;
}

export interface CameleonScreen {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  refresh(snapshot: CameleonSnapshot): void;
  destroy(): void;
}

const CANVAS_FALLBACK_WIDTH = 390;
const CANVAS_FALLBACK_HEIGHT = 844;

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

  const title = document.createElement("h1");
  title.className = "cameleon-screen__title";
  title.textContent = copy["hud.status"];

  const found = hudItem(copy["hud.found"]);
  const mode = hudItem(copy["hud.mode"]);
  const direction = hudItem(copy["hud.dir"]);
  const ammo = hudItem("Darts");
  direction.root.classList.add("cameleon-screen__hud-item--direction");
  ammo.root.classList.add("cameleon-screen__hud-item--ammo");

  const hint = document.createElement("button");
  hint.className = "cameleon-screen__hint";
  hint.type = "button";
  hint.textContent = "?";
  hint.setAttribute("aria-label", "Hint");

  const ammoRow = document.createElement("div");
  ammoRow.className = "cameleon-screen__ammo";
  ammo.root.appendChild(ammoRow);

  const startMenu = document.createElement("section");
  startMenu.className = "cameleon-screen__start";

  const modeButtons = new Map<CameleonPlayMode, HTMLButtonElement>();
  const modePicker = document.createElement("div");
  modePicker.className = "cameleon-screen__mode-picker";
  for (const playMode of CAMELEON_PLAY_MODES) {
    const button = document.createElement("button");
    button.className = "cameleon-screen__mode-button";
    button.type = "button";
    button.dataset.mode = playMode;
    button.textContent = modeLabel(playMode);
    button.addEventListener("click", () => opts.onModeSelect?.(playMode));
    modeButtons.set(playMode, button);
    modePicker.appendChild(button);
  }

  const playButton = document.createElement("button");
  playButton.className = "cameleon-screen__play";
  playButton.type = "button";
  playButton.textContent = copy["menu.play"];
  playButton.addEventListener("click", () => opts.onStart?.());
  startMenu.append(modePicker, playButton);

  const reticle = document.createElement("div");
  reticle.className = "cameleon-screen__reticle";
  reticle.setAttribute("aria-hidden", "true");

  const confirmBar = document.createElement("div");
  confirmBar.className = "cameleon-screen__confirm-bar";
  const confirmButton = document.createElement("button");
  confirmButton.className = "cameleon-screen__confirm";
  confirmButton.type = "button";
  confirmButton.textContent = "CONFIRM";
  confirmButton.addEventListener("click", () => opts.onConfirmAim?.());
  confirmBar.appendChild(confirmButton);

  const bench = document.createElement("section");
  bench.className = "cameleon-screen__bench";
  bench.setAttribute("aria-label", "Collection bench");
  const benchSlots = Array.from({ length: 12 }, (_, index) => {
    const slot = document.createElement("span");
    slot.className = "cameleon-screen__bench-slot";
    slot.setAttribute("aria-label", `Collection slot ${index + 1}`);
    bench.appendChild(slot);
    return slot;
  });

  const result = document.createElement("section");
  result.className = "cameleon-screen__result";

  hud.append(title, found.root, mode.root, direction.root, ammo.root, hint);
  root.append(canvas, hud, startMenu, reticle, confirmBar, bench, result);
  opts.mountInto.appendChild(root);

  return {
    root,
    canvas,
    refresh(snapshot: CameleonSnapshot): void {
      root.dataset.state = snapshot.scene;
      root.dataset.mode = snapshot.mode;
      root.dataset.inputReady = String(snapshot.inputReady);
      found.value.textContent = copy["hud.foundValue"]
        .replace("{found}", String(snapshot.foundCount))
        .replace("{total}", String(snapshot.hides.length));
      mode.value.textContent = modeLabel(snapshot.mode);
      direction.value.textContent = snapshot.dir.toUpperCase();
      ammo.value.textContent = snapshot.ammo === null ? "-" : `${snapshot.ammo}/${snapshot.maxAmmo ?? snapshot.ammo}`;
      renderAmmo(ammoRow, snapshot);
      ammo.root.hidden = snapshot.maxAmmo === null;
      hint.dataset.dimmed = String(snapshot.tapMissMockery);
      startMenu.hidden = snapshot.scene !== "menu";
      confirmBar.hidden = snapshot.scene !== "playing" || snapshot.mode !== "confirm";
      confirmButton.disabled = snapshot.scene !== "playing" || snapshot.mode !== "confirm" || !snapshot.aim?.armed;
      renderReticle(root, reticle, snapshot);
      renderBench(benchSlots, snapshot);
      renderResult(result, snapshot);
      for (const [playMode, button] of modeButtons) {
        button.setAttribute("aria-pressed", String(playMode === snapshot.mode));
      }
    },
    destroy(): void {
      root.remove();
    },
  };
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

function modeLabel(mode: CameleonPlayMode): string {
  switch (mode) {
    case "tap":
      return "Tap";
    case "shoot":
      return "Shoot";
    case "confirm":
      return "Confirm";
  }
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
    slot.setAttribute("aria-label", found ? `Collected ${hide.id}` : `Collection slot ${index + 1}`);
  });
}

function renderResult(result: HTMLElement, snapshot: CameleonSnapshot): void {
  if (snapshot.scene === "complete") {
    result.hidden = false;
    result.textContent = snapshot.spotless ? copy["result.spotless"] : copy["result.win"];
    result.dataset.outcome = snapshot.spotless ? "spotless" : "win";
    return;
  }
  if (snapshot.scene === "failed") {
    result.hidden = false;
    result.textContent = copy["result.fail"];
    result.dataset.outcome = "fail";
    return;
  }
  result.hidden = true;
  result.textContent = "";
  delete result.dataset.outcome;
}
