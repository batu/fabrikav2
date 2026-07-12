import {
  buildButtonElement,
  mountHomeMenu,
  mountPauseOverlay,
  mountResultCard,
  mountSettingsPage,
  mountShopPage,
  type UiHandle,
} from "@fabrikav2/ui";
import { assetUrls } from "../../design/assets.ts";
import { copy } from "../../design/copy.ts";
import { progressionRoute } from "../../design/presentation.ts";
import type { TemplateShellController, TemplateShellSnapshot } from "../core/TemplateShellController.ts";
import type { TemplateSettingKey } from "../sdk/TemplateSdk.ts";
import type { ProofShopPayload } from "../sdk/proofShopCatalog.ts";

type ProgressionNodeState = "completed" | "current" | "locked";

interface ProgressionNode {
  readonly id: number;
  readonly label: string;
  readonly name: string;
  readonly state: ProgressionNodeState;
  readonly instance: ProgressionNodeState;
  readonly disabled?: boolean;
}

function progressionNodes(snapshot: TemplateShellSnapshot): readonly ProgressionNode[] {
  if (snapshot.completedLevels.includes(snapshot.currentLevel)) {
    const firstLevel = Math.max(1, snapshot.currentLevel - 2);
    return (["completed", "current", "locked"] as const).map((instance, index) => {
      const id = firstLevel + index;
      return {
        id,
        label: String(id),
        name: `${copy["menu.level"]} ${id}, ${copy["menu.node.completed"]}`,
        state: "completed",
        instance,
        disabled: true,
      };
    });
  }

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
      instance: "completed",
    },
    {
      id: snapshot.currentLevel,
      label: String(snapshot.currentLevel),
      name: `${copy["menu.level"]} ${snapshot.currentLevel}, ${copy["menu.node.current"]}`,
      state: "current",
      instance: "current",
    },
    {
      id: snapshot.currentLevel + 1,
      label: String(snapshot.currentLevel + 1),
      name: `${copy["menu.level"]} ${snapshot.currentLevel + 1}, ${copy["menu.node.locked"]}`,
      state: "locked",
      instance: "locked",
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
  readonly enableTestOutcomes?: boolean;
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

function failureBarrier(): HTMLElement {
  const barrier = document.createElement("div");
  barrier.className = "template-shell__fail-barrier";
  barrier.setAttribute("aria-hidden", "true");
  return barrier;
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

function currencyCounter(snapshot: TemplateShellSnapshot, instance?: string, compact = false): HTMLElement {
  const counter = document.createElement("div");
  counter.className = [
    "template-shell__currency",
    "template-shell__currency--contrasted",
    compact && "template-shell__currency--compact",
  ]
    .filter(Boolean)
    .join(" ");
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
      label: copy["menu.shop"],
      action: "shop",
      image: assetUrls.shop,
      instance: "menu.shop",
      className: "template-shell__icon-action--utility",
      onClick: () => {
        controller.openShop();
        render();
      },
    }),
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
  const progressionPath = progressionMap.querySelector<HTMLElement>(".fab-levelmap-path")!;
  const route = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  route.classList.add("template-shell__route");
  route.setAttribute("viewBox", progressionRoute.viewBox);
  route.setAttribute("preserveAspectRatio", "none");
  route.setAttribute("aria-hidden", "true");
  route.setAttribute("focusable", "false");
  for (const className of ["template-shell__route-track", "template-shell__route-line"]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.classList.add(className);
    path.setAttribute("d", progressionRoute.path);
    route.appendChild(path);
  }
  progressionPath.prepend(route);
  assignInstance(handle.el, '.fab-home-menu-actions [data-fab-action="play"]', "menu.play");

  for (const [index, node] of Array.from(handle.el.querySelectorAll<HTMLButtonElement>(".fab-levelmap-node")).entries()) {
    const model = nodes[index];
    if (!model) throw new Error(`Missing progression node model at index ${index}`);
    node.dataset.fabInstance = `menu.node.${model.instance}`;
    node.dataset.fabNodeState = model.state;
    if (model.instance === "current") node.dataset.fabAction = "play";
    if (model.disabled || model.state === "locked") {
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
  sample.hidden = backdrop;

  const sampleTitle = document.createElement("p");
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
  options: {
    readonly backdrop?: BackdropKind;
    readonly enableTestOutcomes?: boolean;
  } = {},
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
  label.textContent = `${copy["level.label"]} ${snapshot.activeLevel ?? snapshot.currentLevel}`;
  hud.append(currencyCounter(snapshot, backdrop ? undefined : "level.currency", true), label);
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
  gameplayMarker.setAttribute("aria-hidden", "true");
  gameplayLandscape.appendChild(gameplayMarker);
  gameplayCopy.append(gameplayKicker, gameplayTitle, gameplayBody);
  gameplay.append(gameplayLandscape, gameplayCopy);

  page.append(hud, gameplay);
  if (options.enableTestOutcomes) {
    page.append(renderSampleOutcomes(controller, render, Boolean(backdrop)));
  }
  mountInto.appendChild(page);
}

function secondaryCurrencyCounter(snapshot: TemplateShellSnapshot): HTMLElement {
  const counter = document.createElement("div");
  counter.className =
    "template-shell__currency template-shell__currency--contrasted template-shell__currency--compact";
  counter.dataset.fabInstance = "shop.currency.secondary";
  counter.setAttribute("role", "status");
  counter.setAttribute(
    "aria-label",
    `${snapshot.secondaryCurrency} ${copy["currency.secondary.label"]}`,
  );
  const label = document.createElement("span");
  label.className = "template-shell__currency-label";
  label.textContent = copy["currency.secondary.label"];
  const value = document.createElement("span");
  value.className = "template-shell__currency-value";
  value.textContent = String(snapshot.secondaryCurrency);
  counter.append(art(assetUrls.currency, "template-shell__currency-icon"), value, label);
  return counter;
}

function renderShop(
  mountInto: HTMLElement,
  snapshot: TemplateShellSnapshot,
  controller: TemplateShellController,
  render: () => void,
): UiHandle {
  const page = document.createElement("main");
  page.className = "template-shell__shop";
  page.dataset.fabInstance = "shop.page";
  page.setAttribute("role", "region");

  const header = document.createElement("header");
  header.className = "template-shell__shop-header";
  const title = document.createElement("h1");
  title.id = "template-shop-title";
  title.className = "template-shell__title template-shell__shop-title";
  title.dataset.fabInstance = "shop.title";
  title.textContent = copy["shop.title"];
  header.append(
    iconAction({
      label: copy["shop.back"],
      action: "back",
      image: assetUrls.back,
      instance: "shop.back",
      className: "template-shell__icon-action--utility",
      onClick: () => {
        controller.backFromShop();
        render();
      },
    }),
    title,
  );
  page.setAttribute("aria-labelledby", title.id);

  const balances = document.createElement("div");
  balances.className = "template-shell__shop-balances";
  balances.append(currencyCounter(snapshot, "shop.currency", true), secondaryCurrencyCounter(snapshot));

  const catalogRegion = document.createElement("section");
  catalogRegion.className = "template-shell__shop-catalog";
  catalogRegion.dataset.fabInstance = "shop.grid";
  catalogRegion.setAttribute("role", "group");
  catalogRegion.setAttribute("aria-label", copy["shop.catalog"]);

  page.append(header, balances, catalogRegion);
  mountInto.appendChild(page);

  const iap = controller.sdk.iap;
  const catalogHandle = mountShopPage<ProofShopPayload>({
    mountInto: catalogRegion,
    id: "template-shop-catalog",
    iap,
    sections: [{ group: "items", layout: "grid", title: copy["shop.items"] }],
    copy: {
      purchase: {
        pending: copy["shop.purchase.pending"],
        busy: copy["shop.purchase.busy"],
        unavailable: copy["shop.purchase.unavailable"],
      },
      restore: {
        title: copy["shop.restore.title"],
        status: {
          idle: copy["shop.restore.status.idle"],
          initializing: copy["shop.restore.status.initializing"],
          busy: copy["shop.restore.status.busy"],
          unavailable: copy["shop.restore.status.unavailable"],
          pending: copy["shop.restore.status.pending"],
          restored: copy["shop.restore.status.restored"],
          empty: copy["shop.restore.status.empty"],
          failed: copy["shop.restore.status.failed"],
        },
        button: {
          rest: copy["shop.restore"],
          pending: copy["shop.restore.pending"],
          restored: copy["shop.restore.restored"],
        },
      },
    },
  });

  // Read-only semantic identity: each sample card maps to its contract
  // instance through the controller's shop-item statuses. Cards stay inert —
  // no data-fab-action is ever attached to a card. ShopPage rebuilds card DOM
  // on every service refresh, so annotation re-runs on childList mutations.
  const annotate = (): void => {
    for (const item of snapshot.shopItems) {
      const card = catalogHandle.el.querySelector<HTMLElement>(`[data-catalog-id="${item.id}"]`);
      if (!card) continue;
      card.dataset.fabInstance = `shop.item.${item.status}`;
      card.dataset.fabVariant = item.status;
      card.setAttribute("role", "group");
    }
    const restore = catalogHandle.el.querySelector<HTMLElement>('[data-fab-action="shop-restore"]');
    if (restore) restore.dataset.fabInstance = "shop.restore";
  };
  annotate();
  const cardObserver = new MutationObserver(annotate);
  cardObserver.observe(catalogRegion, { childList: true, subtree: true });

  // Deterministic readiness: the fake provider resolves immediately, so one
  // post-init refresh flips the buttons out of their pending labels.
  void iap.init().then(() => {
    if (controller.snapshot().surface !== "shop") return;
    catalogHandle.refresh();
    annotate();
  });

  return {
    el: page,
    dismiss: () => {
      cardObserver.disconnect();
      catalogHandle.dismiss();
    },
    dismissed: catalogHandle.dismissed,
  };
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
  // Full-page surface, deliberately distinct from the Pause modal: no dialog
  // role, no aria-modal, no scrim — a header Back action over toggle rows.
  page.el.dataset.fabInstance = "settings.page";
  page.el.setAttribute("role", "region");
  page.el.setAttribute("aria-labelledby", title.id);
  title.dataset.fabInstance = "settings.title";
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
  const displayedLevel = snapshot.activeLevel ?? snapshot.currentLevel;
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
          className: "template-shell__overlay-action template-shell__overlay-action--tertiary",
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
          className: "template-shell__overlay-action template-shell__overlay-action--tertiary",
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
    art: win ? art(assetUrls.win, "template-shell__result-art") : failureBarrier(),
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
        renderLevel(root, snapshot, options.controller, render, {
          enableTestOutcomes: options.enableTestOutcomes,
        });
        break;
      case "shop":
        surfaceHandle = renderShop(root, snapshot, options.controller, render);
        break;
      case "settings":
        surfaceHandle = renderSettings(root, snapshot, options.controller, render, () => replacingSurface);
        break;
      case "pause":
        renderLevel(root, snapshot, options.controller, render, {
          backdrop: "pause",
          enableTestOutcomes: options.enableTestOutcomes,
        });
        surfaceHandle = renderPause(root, options.controller, render);
        break;
      case "win":
      case "fail":
        renderLevel(root, snapshot, options.controller, render, {
          backdrop: "result",
          enableTestOutcomes: options.enableTestOutcomes,
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
