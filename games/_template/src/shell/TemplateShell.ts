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
import type { TemplateShellController, TemplateShellSnapshot } from "../core/TemplateShellController.ts";
import type { TemplateSettingKey } from "../sdk/TemplateSdk.ts";

type ProgressionNodeState = "completed" | "current" | "locked";

interface ProgressionNode {
  readonly id: number;
  readonly label: string;
  readonly name: string;
  readonly state: ProgressionNodeState;
}

function progressionNodes(snapshot: TemplateShellSnapshot): readonly ProgressionNode[] {
  const completedLevel = snapshot.completedLevels[snapshot.completedLevels.length - 1];
  return [
    {
      id: completedLevel ?? 0,
      label: completedLevel === undefined ? "✓" : String(completedLevel),
      name:
        completedLevel === undefined
          ? `${copy["menu.start"]}, ${copy["menu.node.completed"]}`
          : `${copy["menu.level"]} ${completedLevel}, ${copy["menu.node.completed"]}`,
      state: "completed",
    },
    {
      id: snapshot.currentLevel,
      label: String(snapshot.currentLevel),
      name: `${copy["menu.level"]} ${snapshot.currentLevel}, ${copy["menu.node.current"]}`,
      state: "current",
    },
    {
      id: snapshot.currentLevel + 1,
      label: String(snapshot.currentLevel + 1),
      name: `${copy["menu.level"]} ${snapshot.currentLevel + 1}, ${copy["menu.node.locked"]}`,
      state: "locked",
    },
  ];
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

function art(src: string, className: string, instance?: string): HTMLImageElement {
  const image = document.createElement("img");
  image.className = className;
  image.src = src;
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  if (instance) image.dataset.fabInstance = instance;
  return image;
}

function assignInstance(root: ParentNode, selector: string, instance: string): void {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing semantic instance owner for ${instance}: ${selector}`);
  element.dataset.fabInstance = instance;
}

function iconAction(options: {
  readonly label: string;
  readonly action: string;
  readonly image: string;
  readonly instance: string;
  readonly className?: string;
  readonly onClick: () => void;
}): HTMLButtonElement {
  const button = buildButtonElement({
    label: options.label,
    ariaLabel: options.label,
    className: ["template-shell__icon-action", options.className].filter(Boolean).join(" "),
    dataAction: options.action,
    onClick: options.onClick,
  });
  button.dataset.fabInstance = options.instance;
  button.prepend(art(options.image, "template-shell__button-icon"));
  return button;
}

function currencyCounter(snapshot: TemplateShellSnapshot, instance?: string): HTMLElement {
  const counter = document.createElement("div");
  counter.className = "template-shell__currency template-shell__currency--contrasted";
  if (instance) counter.dataset.fabInstance = instance;
  counter.setAttribute("role", "status");
  counter.setAttribute("aria-label", `${snapshot.currency} ${copy["currency.label"]}`);
  const currencyLabel = document.createElement("span");
  currencyLabel.className = "template-shell__currency-label";
  currencyLabel.textContent = copy["currency.label"];
  const currencyValue = document.createElement("span");
  currencyValue.className = "template-shell__currency-value";
  currencyValue.textContent = String(snapshot.currency);
  counter.append(
    art(assetUrls.currency, "template-shell__currency-icon"),
    currencyValue,
    currencyLabel,
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

  const heading = document.createElement("div");
  heading.className = "template-shell__heading";
  const subtitle = document.createElement("p");
  subtitle.className = "template-shell__subtitle";
  subtitle.textContent = copy["menu.subtitle"];
  heading.append(title, subtitle);

  const heroStage = document.createElement("div");
  heroStage.className = "template-shell__hero-stage";
  heroStage.dataset.fabInstance = "menu.hero";
  heroStage.dataset.fabSlot = "hero-art";
  heroStage.setAttribute("role", "img");
  heroStage.setAttribute("aria-label", copy["menu.hero"]);
  const heroMarker = document.createElement("span");
  heroMarker.className = "template-shell__hero-marker";
  heroMarker.setAttribute("aria-hidden", "true");
  heroStage.appendChild(heroMarker);

  const utility = document.createElement("div");
  utility.className = "template-shell__utility";
  utility.append(
    currencyCounter(snapshot, "menu.currency"),
    iconAction({
      label: copy["menu.settings"],
      action: "settings",
      image: assetUrls.settings,
      instance: "menu.settings",
      className: "template-shell__icon-action--utility",
      onClick: () => {
        controller.openSettings();
        render();
      },
    }),
  );

  header.append(utility, heading, heroStage);
  return header;
}

function renderMenu(
  mountInto: HTMLElement,
  snapshot: TemplateShellSnapshot,
  controller: TemplateShellController,
  render: () => void,
): UiHandle {
  const nodes = progressionNodes(snapshot);
  const handle = mountHomeMenu({
    mountInto,
    id: "template-home",
    header: menuHeader(snapshot, controller, render),
    saga: {
      id: "template-saga",
      state: {
        nodes,
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
        dataAction: "play",
        onClick: () => {
          controller.startCurrent();
          render();
        },
      },
    ],
  });

  assignInstance(handle.el, ".fab-levelmap", "menu.progression-map");
  const progressionMap = handle.el.querySelector<HTMLElement>('[data-fab-instance="menu.progression-map"]')!;
  progressionMap.setAttribute("role", "group");
  progressionMap.setAttribute("aria-label", copy["menu.progression"]);
  assignInstance(handle.el, '.fab-home-menu-actions [data-fab-action="play"]', "menu.play");

  for (const [index, node] of Array.from(handle.el.querySelectorAll<HTMLButtonElement>(".fab-levelmap-node")).entries()) {
    const state = nodes[index]?.state;
    if (!state) throw new Error(`Missing progression node model at index ${index}`);
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

type BackdropKind = "pause" | "result";

function renderSampleOutcomes(
  controller: TemplateShellController,
  render: () => void,
  backdrop: boolean,
): HTMLElement {
  const sample = document.createElement("section");
  sample.className = "template-shell__sample-outcomes";
  sample.dataset.templateDiagnostic = backdrop ? "outcomes-backdrop" : "outcomes";

  const sampleTitle = document.createElement("h2");
  sampleTitle.className = "template-shell__sample-title";
  sampleTitle.textContent = copy["level.sample.title"];
  const sampleBody = document.createElement("p");
  sampleBody.className = "template-shell__sample-body";
  sampleBody.textContent = copy["level.sample.body"];
  if (!backdrop) {
    sampleTitle.id = "template-sample-outcomes-title";
    sample.setAttribute("aria-labelledby", sampleTitle.id);
  }

  const testActions = document.createElement("div");
  testActions.className = "template-shell__test-actions";
  const winAction = buildButtonElement({
    label: copy["level.testWin"],
    className: "template-shell__test-action template-shell__test-action--win",
    dataAction: backdrop ? undefined : "test-win",
    onClick: backdrop
      ? () => undefined
      : () => {
          controller.win();
          render();
        },
  });
  const loseAction = buildButtonElement({
    label: copy["level.testLose"],
    className: "template-shell__test-action template-shell__test-action--lose",
    dataAction: backdrop ? undefined : "test-lose",
    onClick: backdrop
      ? () => undefined
      : () => {
          controller.lose();
          render();
        },
  });
  if (!backdrop) {
    winAction.dataset.fabInstance = "level.test-win";
    loseAction.dataset.fabInstance = "level.test-lose";
  }
  testActions.append(winAction, loseAction);
  sample.append(sampleTitle, sampleBody, testActions);
  return sample;
}

function renderLevel(
  mountInto: HTMLElement,
  snapshot: TemplateShellSnapshot,
  controller: TemplateShellController,
  render: () => void,
  options: { readonly backdrop?: BackdropKind; readonly displayedLevel?: number } = {},
): void {
  const backdrop = options.backdrop;
  const page = document.createElement("main");
  page.className = [
    "template-shell__level",
    backdrop && "template-shell__level--inert-backdrop",
    backdrop && `template-shell__level--${backdrop}-backdrop`,
  ]
    .filter(Boolean)
    .join(" ");
  if (backdrop) {
    page.dataset.templateBackdrop = `${backdrop}-level`;
    page.setAttribute("aria-hidden", "true");
    page.setAttribute("inert", "");
  }

  const hud = document.createElement("header");
  hud.className = "template-shell__hud";
  const label = document.createElement("h1");
  label.className = "template-shell__level-label template-shell__level-label--identity";
  if (!backdrop) label.dataset.fabInstance = "level.label";
  label.textContent = `${copy["level.label"]} ${options.displayedLevel ?? snapshot.currentLevel}`;
  hud.append(currencyCounter(snapshot, backdrop ? undefined : "level.currency"), label);
  if (!backdrop) {
    hud.append(
      iconAction({
        label: copy["level.pause"],
        action: "pause",
        image: assetUrls.pause,
        instance: "level.pause",
        className: "template-shell__icon-action--hud",
        onClick: () => {
          controller.pause();
          render();
        },
      }),
    );
  } else {
    const visualPause = buildButtonElement({
      label: copy["level.pause"],
      ariaLabel: copy["level.pause"],
      className: "template-shell__icon-action template-shell__icon-action--hud",
      onClick: () => undefined,
    });
    visualPause.tabIndex = -1;
    visualPause.prepend(art(assetUrls.pause, "template-shell__button-icon"));
    hud.appendChild(visualPause);
  }

  const gameplay = document.createElement("section");
  gameplay.className = "template-shell__gameplay template-shell__gameplay--trail";
  if (!backdrop) {
    gameplay.dataset.fabRole = "gameplay-region";
    gameplay.dataset.fabInstance = "level.gameplay-region";
    gameplay.dataset.templateSocket = "replaceable-mechanic";
    gameplay.setAttribute("role", "group");
    gameplay.setAttribute("aria-label", copy["level.gameplay.label"]);
  }
  const gameplayCopy = document.createElement("div");
  gameplayCopy.className = "template-shell__gameplay-copy";
  const gameplayKicker = document.createElement("p");
  gameplayKicker.className = "template-shell__gameplay-kicker";
  gameplayKicker.textContent = copy["level.gameplay.kicker"];
  const gameplayTitle = document.createElement("h2");
  gameplayTitle.textContent = copy["level.gameplay.title"];
  const gameplayBody = document.createElement("p");
  gameplayBody.textContent = copy["level.gameplay.body"];
  const gameplayLandscape = document.createElement("div");
  gameplayLandscape.className = "template-shell__gameplay-landscape";
  gameplayLandscape.setAttribute("aria-hidden", "true");
  const gameplayMarker = document.createElement("span");
  gameplayMarker.className = "template-shell__gameplay-marker";
  gameplayLandscape.appendChild(gameplayMarker);
  gameplayCopy.append(gameplayKicker, gameplayTitle, gameplayBody);
  gameplay.append(gameplayLandscape, gameplayCopy);

  page.append(hud, gameplay, renderSampleOutcomes(controller, render, Boolean(backdrop)));
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
  title.id = "template-settings-title";
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
  page.el.setAttribute("role", "dialog");
  page.el.setAttribute("aria-modal", "true");
  page.el.setAttribute("aria-labelledby", title.id);
  assignInstance(page.el, '[data-fab-action="back"]', "settings.back");
  for (const input of page.el.querySelectorAll<HTMLInputElement>("[data-fab-toggle-key] input")) {
    const key = input.closest<HTMLElement>("[data-fab-toggle-key]")?.dataset.fabToggleKey;
    if (!key) continue;
    input.dataset.fabAction = `settings-${key}`;
    input.dataset.fabInstance = `settings.${key}`;
    input.setAttribute("role", "switch");
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
  assignInstance(pause.el, ".fab-modal-card", "pause.panel");
  assignInstance(pause.el, '[data-fab-action="pause-resume"]', "pause.resume");
  assignInstance(pause.el, '[data-fab-action="pause-settings"]', "pause.settings");
  assignInstance(pause.el, '[data-fab-action="pause-quit"]', "pause.home");
  return pause;
}

function renderResult(
  mountInto: HTMLElement,
  snapshot: TemplateShellSnapshot,
  controller: TemplateShellController,
  render: () => void,
): UiHandle {
  const win = snapshot.surface === "win";
  const displayedLevel = win ? Math.max(1, snapshot.currentLevel - 1) : snapshot.currentLevel;
  const panelInstance = win ? "win.panel" : "fail.panel";
  const actions = win
    ? [
        {
          label: copy["win.next"],
          className: "template-shell__overlay-action template-shell__overlay-action--primary",
          dataAction: "result-next",
          onClick: () => {
            controller.next();
            render();
          },
        },
        {
          label: copy["win.home"],
          className: "template-shell__overlay-action template-shell__overlay-action--secondary",
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
          className: "template-shell__overlay-action template-shell__overlay-action--primary",
          dataAction: "result-retry",
          onClick: () => {
            controller.retry();
            render();
          },
        },
        {
          label: copy["fail.home"],
          className: "template-shell__overlay-action template-shell__overlay-action--secondary",
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
    eyebrow: `${copy["level.label"]} ${displayedLevel}`,
    ribbonImage: win ? assetUrls.ribbonWin : assetUrls.ribbonFail,
    art: art(win ? assetUrls.win : assetUrls.fail, "template-shell__result-art"),
    messages: win ? copy["win.message"] : copy["fail.message"],
    actions,
  });
  assignInstance(result.el, ".fab-modal-card", panelInstance);
  if (win) {
    assignInstance(result.el, '[data-fab-action="result-next"]', "win.next");
    assignInstance(result.el, '[data-fab-action="result-menu"]', "win.home");
  } else {
    assignInstance(result.el, '[data-fab-action="result-retry"]', "fail.retry");
    assignInstance(result.el, '[data-fab-action="result-menu"]', "fail.home");
  }
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
    }
    root.replaceChildren();
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
        renderLevel(root, snapshot, options.controller, render, { backdrop: "pause" });
        surfaceHandle = renderPause(root, options.controller, render);
        break;
      case "win":
      case "fail":
        renderLevel(root, snapshot, options.controller, render, {
          backdrop: "result",
          displayedLevel: snapshot.surface === "win" ? Math.max(1, snapshot.currentLevel - 1) : snapshot.currentLevel,
        });
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
