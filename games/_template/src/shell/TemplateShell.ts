import {
  buildButtonElement,
  mountHomeMenu,
  mountPauseOverlay,
  mountResultCard,
  mountSettingsPage,
  type UiHandle,
} from "@fabrikav2/ui";
import { assetUrls } from "../../design/assets.ts";
import { copy } from "../../design/copy.ts";
import { gameConfig } from "../../game.config.ts";
import type { TemplateShellController, TemplateShellSnapshot } from "../core/TemplateShellController.ts";
import type { TemplateSettingKey } from "../sdk/TemplateSdk.ts";

const levelIds = Array.from({ length: gameConfig.saga.levels }, (_value, index) => index + 1);

function levelNodeState(snapshot: TemplateShellSnapshot, level: number): "completed" | "current" | "locked" {
  if (snapshot.completedLevels.includes(level)) return "completed";
  return level === snapshot.currentLevel ? "current" : "locked";
}

export interface TemplateShellHandle {
  readonly root: HTMLElement;
  render(): void;
  dispose(): void;
}

export interface MountTemplateShellOptions {
  readonly mountInto: HTMLElement;
  readonly controller: TemplateShellController;
}

function art(src: string, className: string, instance: string): HTMLImageElement {
  const image = document.createElement("img");
  image.className = className;
  image.src = src;
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  image.dataset.fabInstance = instance;
  return image;
}

function iconAction(options: {
  readonly label: string;
  readonly action: string;
  readonly image: string;
  readonly instance: string;
  readonly onClick: () => void;
}): HTMLButtonElement {
  const button = buildButtonElement({
    label: options.label,
    ariaLabel: options.label,
    className: "template-shell__icon-action",
    dataAction: options.action,
    onClick: options.onClick,
  });
  button.dataset.fabInstance = options.instance;
  button.prepend(art(options.image, "template-shell__button-icon", options.instance));
  return button;
}

function currencyCounter(snapshot: TemplateShellSnapshot, instance: string): HTMLElement {
  const counter = document.createElement("div");
  counter.className = "template-shell__currency";
  counter.dataset.fabInstance = instance;
  counter.setAttribute("aria-label", copy["currency.label"]);
  counter.append(
    art(assetUrls.currency, "template-shell__currency-icon", instance),
    Object.assign(document.createElement("span"), { textContent: String(snapshot.currency) }),
  );
  return counter;
}

function menuHeader(
  snapshot: TemplateShellSnapshot,
  controller: TemplateShellController,
  render: () => void,
): HTMLElement {
  const header = document.createElement("header");
  header.className = "template-shell__menu-header";

  const title = document.createElement("h1");
  title.className = "template-shell__title";
  title.dataset.fabInstance = "menu.title";
  title.textContent = copy["game.title"];

  const hero = art(assetUrls.heroArt, "template-shell__hero-art", "menu.hero");
  hero.dataset.fabSlot = "hero-art";

  const utility = document.createElement("div");
  utility.className = "template-shell__utility";
  utility.append(
    currencyCounter(snapshot, "menu.currency"),
    iconAction({
      label: copy["menu.settings"],
      action: "settings",
      image: assetUrls.settings,
      instance: "menu.settings",
      onClick: () => {
        controller.openSettings();
        render();
      },
    }),
  );

  header.append(utility, title, hero);
  return header;
}

function renderMenu(
  mountInto: HTMLElement,
  snapshot: TemplateShellSnapshot,
  controller: TemplateShellController,
  render: () => void,
): UiHandle {
  const handle = mountHomeMenu({
    mountInto,
    id: "template-home",
    header: menuHeader(snapshot, controller, render),
    saga: {
      id: "template-saga",
      state: {
        nodes: levelIds.map((level) => ({
          id: level,
          label: String(level),
          name: `${copy["menu.level"]} ${level}`,
          state: levelNodeState(snapshot, level),
        })),
      },
      actions: {
        onSelectLevel: (level) => {
          controller.selectNode(Number(level));
          render();
        },
      },
      loadingLabel: copy["menu.loading"],
    },
    actions: [
      {
        label: copy["menu.play"],
        ariaLabel: copy["menu.play"],
        className: "template-shell__primary-action",
        spriteImage: assetUrls.buttonPrimary,
        dataAction: "play",
        onClick: () => {
          controller.startCurrent();
          render();
        },
      },
    ],
  });

  for (const node of handle.el.querySelectorAll<HTMLButtonElement>(".fab-levelmap-node")) {
    const level = Number(node.dataset.fabNodeId);
    const state = levelNodeState(snapshot, level);
    node.dataset.fabInstance = `menu.node.${state}`;
    node.dataset.fabNodeState = state;
    if (state === "current") node.dataset.fabAction = "play";
    if (state === "locked") {
      node.dataset.fabAction = "locked";
      node.disabled = true;
      node.setAttribute("aria-disabled", "true");
    }
  }
  return handle;
}

function renderLevel(
  mountInto: HTMLElement,
  snapshot: TemplateShellSnapshot,
  controller: TemplateShellController,
  render: () => void,
): void {
  const page = document.createElement("main");
  page.className = "template-shell__level";

  const hud = document.createElement("header");
  hud.className = "template-shell__hud";
  const label = document.createElement("p");
  label.className = "template-shell__level-label";
  label.dataset.fabInstance = "level.label";
  label.textContent = `${copy["level.label"]} ${snapshot.currentLevel}`;
  hud.append(
    currencyCounter(snapshot, "level.currency"),
    label,
    iconAction({
      label: copy["level.pause"],
      action: "pause",
      image: assetUrls.pause,
      instance: "level.pause",
      onClick: () => {
        controller.pause();
        render();
      },
    }),
  );

  const gameplay = document.createElement("section");
  gameplay.className = "template-shell__gameplay";
  gameplay.dataset.fabRole = "gameplay-region";
  gameplay.dataset.fabInstance = "level.gameplay-region";
  gameplay.setAttribute("aria-label", copy["level.gameplay.label"]);
  const gameplayTitle = document.createElement("h2");
  gameplayTitle.textContent = copy["level.gameplay.title"];
  const gameplayBody = document.createElement("p");
  gameplayBody.textContent = copy["level.gameplay.body"];
  gameplay.append(art(assetUrls.gameplay, "template-shell__gameplay-art", "level.gameplay-region"), gameplayTitle, gameplayBody);

  const testActions = document.createElement("div");
  testActions.className = "template-shell__test-actions";
  testActions.append(
    buildButtonElement({
      label: copy["level.testWin"],
      className: "template-shell__test-action template-shell__test-action--win",
      spriteImage: assetUrls.buttonPrimary,
      dataAction: "test-win",
      onClick: () => {
        controller.win();
        render();
      },
    }),
    buildButtonElement({
      label: copy["level.testLose"],
      className: "template-shell__test-action template-shell__test-action--lose",
      spriteImage: assetUrls.buttonSecondary,
      dataAction: "test-lose",
      onClick: () => {
        controller.lose();
        render();
      },
    }),
  );
  testActions.children[0]?.setAttribute("data-fab-instance", "level.test-win");
  testActions.children[1]?.setAttribute("data-fab-instance", "level.test-lose");

  page.append(hud, gameplay, testActions);
  mountInto.appendChild(page);
}

function renderSettings(
  mountInto: HTMLElement,
  snapshot: TemplateShellSnapshot,
  controller: TemplateShellController,
  render: () => void,
  isReplacingSurface: () => boolean,
): UiHandle {
  const title = document.createElement("h1");
  title.textContent = copy["settings.title"];
  const page = mountSettingsPage({
    mountInto,
    id: "template-settings",
    header: title,
    backIcon: assetUrls.back,
    backLabel: copy["settings.back"],
    instant: true,
    settings: {
      ...snapshot.settings,
      labels: {
        music: copy["settings.music"],
        sfx: copy["settings.sfx"],
        haptics: copy["settings.haptics"],
      },
    },
    onToggle: (key, next) => {
      controller.setSetting(key as TemplateSettingKey, next);
    },
    onDismiss: () => {
      if (isReplacingSurface() || controller.snapshot().surface !== "settings") return;
      controller.backFromSettings();
      render();
    },
  });
  page.el.dataset.fabInstance = "settings.panel";
  for (const input of page.el.querySelectorAll<HTMLInputElement>("[data-fab-toggle-key] input")) {
    const key = input.closest<HTMLElement>("[data-fab-toggle-key]")?.dataset.fabToggleKey;
    if (!key) continue;
    input.dataset.fabAction = `settings-${key}`;
    input.dataset.fabInstance = `settings.${key}`;
  }
  return page;
}

function renderPause(
  mountInto: HTMLElement,
  controller: TemplateShellController,
  render: () => void,
): UiHandle {
  const pause = mountPauseOverlay({
    mountInto,
    id: "template-pause",
    actions: {
      onResume: () => {
        controller.resume();
        render();
      },
      onSettings: () => {
        controller.openSettings();
        render();
      },
      onQuit: () => {
        controller.home();
        render();
      },
    },
    labels: {
      title: copy["pause.title"],
      resume: copy["pause.resume"],
      settings: copy["pause.settings"],
      quit: copy["pause.home"],
    },
  });
  pause.el.dataset.fabInstance = "pause.panel";
  return pause;
}

function renderResult(
  mountInto: HTMLElement,
  snapshot: TemplateShellSnapshot,
  controller: TemplateShellController,
  render: () => void,
): UiHandle {
  const win = snapshot.surface === "win";
  const artInstance = win ? "win.panel" : "fail.panel";
  const actions = win
    ? [
        {
          label: copy["win.next"],
          className: "template-shell__primary-action",
          spriteImage: assetUrls.buttonPrimary,
          dataAction: "result-next",
          onClick: () => {
            controller.next();
            render();
          },
        },
        {
          label: copy["win.home"],
          className: "template-shell__secondary-action",
          spriteImage: assetUrls.buttonSecondary,
          dataAction: "result-menu",
          onClick: () => {
            controller.home();
            render();
          },
        },
      ]
    : [
        {
          label: copy["fail.retry"],
          className: "template-shell__primary-action",
          spriteImage: assetUrls.buttonPrimary,
          dataAction: "result-retry",
          onClick: () => {
            controller.retry();
            render();
          },
        },
        {
          label: copy["fail.home"],
          className: "template-shell__secondary-action",
          spriteImage: assetUrls.buttonSecondary,
          dataAction: "result-menu",
          onClick: () => {
            controller.home();
            render();
          },
        },
      ];
  const result = mountResultCard({
    mountInto,
    id: win ? "template-win" : "template-fail",
    variant: win ? "win" : "lose",
    title: win ? copy["win.title"] : copy["fail.title"],
    eyebrow: `${copy["level.label"]} ${snapshot.currentLevel}`,
    ribbonImage: assetUrls.ribbon,
    cardImage: assetUrls.modalPanel,
    art: art(win ? assetUrls.win : assetUrls.fail, "template-shell__result-art", artInstance),
    messages: win ? copy["win.message"] : copy["fail.message"],
    actions,
  });
  result.el.dataset.fabInstance = artInstance;
  return result;
}

/** Mount the complete editor-neutral shell. No UI state lives in this renderer. */
export function mountTemplateShell(options: MountTemplateShellOptions): TemplateShellHandle {
  const root = document.createElement("div");
  root.className = "template-shell";
  options.mountInto.replaceChildren(root);

  let surfaceHandle: UiHandle | null = null;
  let replacingSurface = false;

  const clearSurface = (): void => {
    replacingSurface = true;
    if (surfaceHandle) {
      surfaceHandle.dismiss();
      surfaceHandle = null;
    } else {
      root.replaceChildren();
    }
    replacingSurface = false;
  };

  const render = (): void => {
    clearSurface();
    const snapshot = options.controller.snapshot();
    root.dataset.fabState = snapshot.surface;
    switch (snapshot.surface) {
      case "menu":
        surfaceHandle = renderMenu(root, snapshot, options.controller, render);
        break;
      case "level":
        renderLevel(root, snapshot, options.controller, render);
        break;
      case "settings":
        surfaceHandle = renderSettings(root, snapshot, options.controller, render, () => replacingSurface);
        break;
      case "pause":
        surfaceHandle = renderPause(root, options.controller, render);
        break;
      case "win":
      case "fail":
        surfaceHandle = renderResult(root, snapshot, options.controller, render);
        break;
    }
  };

  render();
  return {
    root,
    render,
    dispose(): void {
      clearSurface();
      root.remove();
    },
  };
}
