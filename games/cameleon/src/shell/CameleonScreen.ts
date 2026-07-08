import { copy } from "../../design/copy.ts";
import type { CameleonSnapshot } from "../game/CameleonController.ts";

export interface CameleonScreenOptions {
  readonly mountInto: HTMLElement;
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

  hud.append(title, found.root, mode.root, direction.root);
  root.append(canvas, hud);
  opts.mountInto.appendChild(root);

  return {
    root,
    canvas,
    refresh(snapshot: CameleonSnapshot): void {
      root.dataset.state = snapshot.scene;
      found.value.textContent = copy["hud.foundValue"]
        .replace("{found}", String(snapshot.foundCount))
        .replace("{total}", String(snapshot.winAt));
      mode.value.textContent = snapshot.mode;
      direction.value.textContent = snapshot.dir;
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
