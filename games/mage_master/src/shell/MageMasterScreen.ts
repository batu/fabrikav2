import {
  animateEconomyTransfer,
  buildButtonElement,
  mountModalShell,
  mountPauseOverlay,
  mountResultCard,
  mountSagaMap,
  mountSettingsPage,
  mountShopPage,
  mountToaster,
  type LevelMapNode,
  type ShopCopy,
  type ShopPageHandle,
  type ToasterHandle,
  type UiHandle,
} from "@fabrikav2/ui";
import { ENERGY } from "../../content/economy.ts";
import { ARENA_THEME, levelSpec } from "../../content/levels.ts";
import { enemyDefinition, type EnemyKind } from "../../content/enemies.ts";
import { MAGE_CLASSES, type MageClass } from "../../content/mages.ts";
import { MAX_RIFT_TIER, PULL_COST_CRYSTALS, oddsFor, riftTier } from "../../content/rift.ts";
import { GEM_GROUP, gemsForProductId, type GemGrant } from "../../content/shop.ts";
import { PERCENT_STATS, STAT_KEYS, type StatKey } from "../../content/stats.ts";
import { armorIcon, assetUrls, chromeIcon, currencyIcon, frame, lettering, magesIcon, nodeArt, propSprite, riftPortal, scene, shopIcon, shopNavIcon, unitSprite, weaponIcon } from "../../design/assets.ts";
import { copy, fill, type CopyKey } from "../../design/copy.ts";
import { createBattleRenderer, type BattleRenderer } from "../battle/BattleScene.ts";
import { createSfx, type Sfx } from "../game/sfx.ts";
import { composeMage, composeMageUrl, type MageLook } from "../battle/mageComposite.ts";
import { itemPower, itemStats, mageStats, type Item } from "../game/economy/items.ts";
import { discardValue, skipCost } from "../game/economy/save.ts";
import type { MageMasterController, MageMasterSnapshot, Surface } from "../game/MageMasterController.ts";
import type { BattleView } from "../game/sim/types.ts";

export interface MageMasterScreenOptions {
  readonly mountInto: HTMLElement;
  readonly controller: MageMasterController;
  readonly sfx?: Sfx;
}

export interface MageMasterScreen {
  readonly root: HTMLElement;
  refresh(): void;
  /** Client point of a named control for real-input harness verbs. */
  clientPoint(action: string): { x: number; y: number } | null;
  captureBattleFrames(count: number, everyMs: number): Promise<string[]>;
  destroy(): void;
}

type Page = "menu" | "rift" | "mages" | "shop" | "battle";
const REVEAL_DELAY_MS = 550;
/** Kit flight (760 ms) plus its token stagger; the pill is the count-up's until then. */
const FLY_HOLD_MS = 1400;
/** Loot counts down to zero over the flight, then the result card proceeds. */
const RESULT_COLLECT_MS = 1000;
const LOOT_COUNTDOWN_MS = 760;
type Overlay = "pause" | "settings" | "win" | "fail" | "reveal" | "offline" | "item" | null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function img(src: string | undefined, className: string, alt = ""): HTMLElement {
  if (!src) {
    const ph = el("span", `${className} mm-ph`);
    ph.setAttribute("aria-hidden", "true");
    return ph;
  }
  const image = el("img", className);
  image.src = src;
  image.alt = alt;
  image.draggable = false;
  return image;
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return fill("time.seconds", { s });
  if (s < 3600) return fill("time.minutes", { m: Math.floor(s / 60), s: s % 60 });
  return fill("time.hours", { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) });
}

/** Top-bar counters: full up to four digits, then compact so the pill never ellipsizes. */
function formatCount(value: number): string {
  const n = Math.max(0, Math.floor(value));
  if (n < 10_000) return String(n);
  if (n < 100_000) return fill("num.thousands", { n: (n / 1000).toFixed(1) });
  if (n < 1_000_000) return fill("num.thousands", { n: Math.floor(n / 1000) });
  return fill("num.millions", { n: (n / 1_000_000).toFixed(1) });
}

function formatStat(key: StatKey, value: number): string {
  if (PERCENT_STATS.has(key)) return `${Math.round(value * 100)}%`;
  if (key === "atkSpeed") return `${value.toFixed(2)}/s`;
  if (key === "hpRegen") return `${value.toFixed(1)}/s`;
  return String(Math.round(value));
}

function pageFor(surface: Surface): Page {
  switch (surface) {
    case "rift":
      return "rift";
    case "mages":
      return "mages";
    case "shop":
      return "shop";
    case "battle":
    case "pause":
    case "win":
    case "fail":
      return "battle";
    case "settings":
    case "menu":
    default:
      return "menu";
  }
}

/** ShopPage takes every label injected; the SDK ships the state, copy.ts the words. */
const SHOP_COPY: ShopCopy = {
  purchase: { pending: copy["shop.buying"], busy: copy["shop.busy"], unavailable: copy["shop.unavailable"] },
  restore: {
    title: copy["shop.restore.title"],
    status: {
      idle: copy["shop.restore.idle"],
      initializing: copy["shop.restore.initializing"],
      busy: copy["shop.restore.busy"],
      unavailable: copy["shop.restore.unavailable"],
      pending: copy["shop.restore.pending"],
      restored: copy["shop.restore.restored"],
      empty: copy["shop.restore.empty"],
      failed: copy["shop.restore.failed"],
    },
    button: { rest: copy["shop.restore.button"], pending: copy["shop.restore.buttonPending"], restored: copy["shop.restore.buttonDone"] },
  },
};

function mageName(cls: MageClass): string {
  return copy[`mage.${cls}.name`];
}

function itemName(item: Item): string {
  const rarity = copy[`rarity.${item.rarity}`];
  if (item.weapon) return `${rarity} ${copy[`element.${item.weapon.element}`]} ${copy["reveal.weapon"]}`;
  return `${rarity} ${copy["reveal.armor"]}`;
}

function lookFor(snap: MageMasterSnapshot, cls: MageClass): MageLook {
  const loadout = snap.loadout[cls];
  return { cls, element: loadout.weapon.weapon?.element ?? "fire", armorRarity: loadout.armor.rarity };
}

/** Mage portrait that upgrades from the base sprite to the gear composite once drawn. */
function mageImage(look: MageLook, className: string, alt: string): HTMLElement {
  const image = img(unitSprite(look.cls), className, alt);
  if (image instanceof HTMLImageElement) {
    void composeMageUrl(look).then((url) => {
      image.src = url;
    });
  }
  return image;
}

/** A portrait inside the ornate round frame (falls back to the bare portrait). */
function framedPortrait(look: MageLook, className: string, alt: string, ring: string | undefined): HTMLElement {
  const portrait = mageImage(look, className, alt);
  if (!ring) return portrait;
  const wrap = el("span", "mm-portrait");
  wrap.append(portrait, img(ring, "mm-portrait__frame"));
  return wrap;
}

export function mountMageMasterScreen(opts: MageMasterScreenOptions): MageMasterScreen {
  const { controller } = opts;
  const root = el("div", "mm-root fab-ui");
  // Minimal interface mod: the same DOM without painted chrome, scenes,
  // lettering, or map dressing; mage-master-minimal.css restyles the rest.
  const isMinimal = (): boolean => controller.snapshot().settings.minimalUi;
  const skinned = <T,>(url: T | undefined): T | undefined => (isMinimal() ? undefined : url);
  const artFrame = (name: Parameters<typeof frame>[0]): string | undefined => skinned(frame(name));
  const artScene = (name: Parameters<typeof scene>[0]): string | undefined => skinned(scene(name));
  const artLettering = (name: Parameters<typeof lettering>[0]): string | undefined => skinned(lettering(name));
  const artNode = (state: Parameters<typeof nodeArt>[0]): string | undefined => skinned(nodeArt(state));
  const artProp = (name: Parameters<typeof propSprite>[0]): string | undefined => skinned(propSprite(name));
  opts.mountInto.replaceChildren(root);

  const topbar = el("header", "mm-topbar");
  const body = el("div", "mm-body");
  const nav = el("nav", "mm-nav");
  root.append(topbar, body, nav);
  // Ornate frames reach CSS as custom properties so the stylesheet stays free of
  // asset paths. Re-applied on every refresh so a late-resolving asset heals itself.
  const applyFrames = (): void => {
    const frames: Array<[string, string | undefined]> = [
      ["--fab-mm-frame-panel", artFrame("panel")],
      ["--fab-mm-frame-button", artFrame("button")],
      ["--fab-mm-frame-button-dark", artFrame("button-dark")],
      ["--fab-mm-frame-portrait", artFrame("portrait")],
      ["--fab-mm-scene-home", artScene("home")],
      ["--fab-mm-scene-rift", artScene("rift")],
    ];
    for (const [name, url] of frames) if (url) root.style.setProperty(name, `url(${url})`);
    root.classList.toggle("mm-root--framed", Boolean(artFrame("panel") && artFrame("button")));
    root.classList.toggle("mm-root--minimal", isMinimal());
  };
  applyFrames();
  const toaster: ToasterHandle = mountToaster({ mountInto: root, id: "mm-toaster" });
  // Warm the chrome art so the first paint of any framed surface is never unskinned.
  const warmUrls = [assetUrls.panel, assetUrls.ribbon.win, assetUrls.ribbon.fail, assetUrls.ribbon.neutral, assetUrls.button.primary, assetUrls.button.secondary];
  for (const url of warmUrls) {
    if (!url) continue;
    const warm = new Image();
    warm.src = url;
  }
  const sfx = opts.sfx ?? createSfx();
  root.addEventListener("pointerdown", () => sfx.unlock(), { passive: true });
  root.addEventListener("click", (event) => {
    if ((event.target as HTMLElement | null)?.closest("button")) sfx.play("tap");
  });

  let page: Page | null = null;
  let pageKey = "";

  let overlayHandle: UiHandle | null = null;
  let shop: ShopPageHandle | null = null;
  let renderer: BattleRenderer | null = null;
  let itemDetail: Item | null = null;
  let previousTier = controller.snapshot().riftTier;
  let resetArmedAt: number | null = null;
  let revealDelayUntil = 0;
  let previousSurface: Surface = controller.snapshot().surface;
  const live = new Map<string, HTMLElement>();
  /** Totals last written to the pills; a grant flies its tokens from the old value to the new one. */
  const displayed = { gold: 0, crystal: 0, gem: 0 };
  let totalsBefore = { ...displayed };
  type Currency = keyof typeof displayed;
  /** While a flight counts a pill up, the periodic refresh leaves that pill alone. */
  const countingUntil: Record<Currency, number> = { gold: 0, crystal: 0, gem: 0 };
  /** Kit coin-fly from `source` to the matching top-bar pill, counting the pill up from -> to. */
  const flyCurrency = (key: Currency, amount: number, source: Element | null, from: number, to: number): boolean => {
    const tokenImage = currencyIcon(key);
    const target = root.querySelector(`[data-fab-economy-target="${key}"]`);
    if (amount <= 0 || !tokenImage || !target || target.getBoundingClientRect().width === 0) return false;
    countingUntil[key] = Date.now() + FLY_HOLD_MS;
    void animateEconomyTransfer({
      kind: key === "gold" ? "coin" : "hint",
      amount,
      tokenImage,
      source,
      owner: root,
      targets: [`[data-fab-economy-target="${key}"]`],
      countElement: live.get(`pill-${key}`) ?? null,
      fromValue: from,
      toValue: to,
      mountInto: root,
    });
    return true;
  };
  /** Count a loot cell's "+N" down to zero as its tokens leave. */
  const countDown = (cell: Element | null, amount: number): void => {
    const label = cell?.querySelector<HTMLElement>("span:last-child");
    if (!label) return;
    const startedAt = performance.now();
    const step = (now: number): void => {
      if (!label.isConnected) return;
      const t = Math.min(1, (now - startedAt) / LOOT_COUNTDOWN_MS);
      label.textContent = `+${Math.round(amount * (1 - t) ** 3)}`;
      if (t < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  };
  const hudBars = new Map<MageClass, { fill: HTMLElement; value: HTMLElement; card: HTMLElement }>();
  const stageDots: HTMLElement[] = [];

  // ---------- top bar ----------
  const currencyPill = (key: "energy" | "gold" | "crystal" | "gem", label: string): HTMLElement => {
    const pill = el("div", `mm-pill mm-pill--${key}`);
    pill.dataset.fabEconomyTarget = key;
    pill.setAttribute("role", "status");
    pill.setAttribute("aria-label", label);
    pill.append(img(currencyIcon(key), "mm-pill__icon"));
    // Value and (for energy) the regen timer stack in a column so every pill
    // can share the bar's width equally without the longest one starving the rest.
    const text = el("span", "mm-pill__text");
    const value = el("span", "mm-pill__value", "0");
    text.append(value);
    live.set(`pill-${key}`, value);
    if (key === "energy") {
      const sub = el("span", "mm-pill__sub", "");
      text.append(sub);
      live.set("pill-energy-sub", sub);
    }
    pill.append(text);
    return pill;
  };
  topbar.append(
    currencyPill("energy", copy["currency.energy"]),
    currencyPill("gold", copy["currency.gold"]),
    currencyPill("crystal", copy["currency.crystals"]),
    currencyPill("gem", copy["currency.gems"]),
  );

  // ---------- nav ----------
  const navButton = (label: string, action: string, icon: string | undefined, onClick: () => void): HTMLButtonElement => {
    const button = buildButtonElement({ label, ariaLabel: label, className: "mm-nav__btn", dataAction: action, onClick });
    button.replaceChildren(img(icon, "mm-nav__icon"), el("span", "mm-nav__label", label));
    return button;
  };
  nav.append(
    navButton(copy["nav.home"], "nav-home", chromeIcon("home"), () => controller.home()),
    navButton(copy["nav.rift"], "nav-rift", riftPortal(), () => (controller.snapshot().surface === "rift" ? undefined : controller.openRift() || (controller.home() && controller.openRift()))),
    navButton(copy["nav.mages"], "nav-mages", magesIcon(), () => (controller.snapshot().surface === "mages" ? undefined : controller.openMages() || (controller.home() && controller.openMages()))),
    navButton(copy["nav.shop"], "nav-shop", shopNavIcon(), () => (controller.snapshot().surface === "shop" ? undefined : controller.openShop() || (controller.home() && controller.openShop()))),
    navButton(copy["nav.settings"], "nav-settings", chromeIcon("settings"), () => controller.openSettings()),
  );

  // ---------- pages ----------
  const renderMenu = (snap: MageMasterSnapshot): HTMLElement => {
    const home = el("main", "mm-home");
    const hero = el("section", "mm-home__hero");
    const titleArt = artLettering("title");
    if (titleArt) {
      const title = el("h1", "mm-home__title mm-home__title--art");
      title.append(img(titleArt, "mm-home__title-art", copy["game.title"]));
      hero.append(title);
    } else {
      hero.append(el("h1", "mm-home__title", copy["game.title"]));
    }
    const party = el("div", "mm-party");
    if (artScene("home")) party.classList.add("mm-party--scene");
    for (const cls of MAGE_CLASSES) {
      const card = el("div", `mm-party__mage mm-party__mage--${cls}`);
      card.append(mageImage(lookFor(snap, cls), "mm-party__sprite", mageName(cls)), el("span", "mm-party__name", mageName(cls)));
      party.append(card);
    }
    hero.append(party);

    const ladder = el("section", "mm-home__ladder");
    ladder.setAttribute("aria-label", copy["menu.progression"]);
    // Map dressing on the flanks so the board reads as a camp map, not an empty plank.
    for (const [prop, cls] of [["tent", "mm-home__deco mm-home__deco--tent"], ["campfire", "mm-home__deco mm-home__deco--fire"], ["rock-sand", "mm-home__deco mm-home__deco--rock"], ["cactus", "mm-home__deco mm-home__deco--cactus"], ["bones", "mm-home__deco mm-home__deco--bones"], ["grass", "mm-home__deco mm-home__deco--grass"]] as const) {
      const url = artProp(prop);
      if (url) ladder.append(img(url, cls));
    }
    const current = snap.unlockedLevel;
    // Climb: the current level sits at the bottom, the next three rise above it.
    const nodes: LevelMapNode[] = [];
    for (let id = current + 2; id >= current; id -= 1) {
      const state = id < current ? "completed" : id === current ? "current" : "locked";
      const stateLabel = state === "completed" ? copy["menu.cleared"] : state === "current" ? copy["menu.next"] : copy["menu.locked"];
      nodes.push({ id, label: String(id), name: `${copy["menu.level"]} ${id}, ${stateLabel}`, state });
    }
    const artCurrent = artNode("current");
    const artLocked = artNode("locked");
    const artCompleted = artNode("completed");
    const hasNodeArt = Boolean(artCurrent && artLocked && artCompleted);
    const map = mountSagaMap({
      mountInto: ladder,
      id: "mm-saga",
      suppressDefaultNodeDisc: hasNodeArt,
      theme: hasNodeArt
        ? {
            "--fab-levelmap-art-current": `url(${artCurrent})`,
            "--fab-levelmap-art-locked": `url(${artLocked})`,
            "--fab-levelmap-art-completed": `url(${artCompleted})`,
            "--fab-levelmap-art-default": `url(${artLocked})`,
          }
        : undefined,
      state: { nodes },
      actions: {
        onSelectLevel: (id) => {
          const level = Number(id);
          if (level <= snap.unlockedLevel) controller.enterLevel(level);
        },
      },
      loadingLabel: copy["menu.loading"],
    });
    for (const node of map.el.querySelectorAll<HTMLButtonElement>(".fab-levelmap-node")) {
      const id = Number(node.dataset.fabNodeId);
      node.dataset.fabAction = id <= snap.unlockedLevel ? `level-${id}` : "locked";
      if (id > snap.unlockedLevel) node.disabled = true;
    }

    const playWrap = el("div", "mm-home__play");
    const play = buildButtonElement({
      label: `${copy["menu.play"]} · ${copy["menu.level"]} ${current}`,
      className: "mm-btn mm-btn--primary mm-btn--big",
      spriteImage: assetUrls.button.primary,
      dataAction: "play",
      onClick: () => controller.enterLevel(current),
    });
    const cost = el("span", "mm-home__cost");
    cost.append(img(currencyIcon("energy"), "mm-inline-icon"), el("span", undefined, String(ENERGY.levelCost)));
    play.append(cost);
    const energyNote = el("p", "mm-home__note", "");
    live.set("energy-note", energyNote);
    playWrap.append(play, energyNote);
    home.append(hero, ladder, playWrap);
    return home;
  };

  const renderRift = (snap: MageMasterSnapshot): HTMLElement => {
    const rift = el("main", "mm-rift");
    const head = el("header", "mm-page__head");
    head.append(el("h1", "mm-page__title", copy["rift.title"]));
    const tierBadge = el("span", "mm-rift__tier", snap.riftTier >= MAX_RIFT_TIER ? copy["rift.maxTier"] : fill("rift.tier", { tier: snap.riftTier + 1 }));
    head.append(tierBadge);
    const stage = el("section", "mm-rift__stage");
    const stageInner = el("div", "mm-rift__inner");
    const art = el("div", "mm-rift__art");
    if (artScene("rift")) art.classList.add("mm-rift__art--scene");
    const portal = img(riftPortal(), "mm-rift__portal");
    art.append(portal);
    stageInner.append(art);
    stage.append(stageInner);

    const pullBtn = buildButtonElement({
      label: copy["rift.pull"],
      className: "mm-btn mm-btn--primary mm-btn--big",
      spriteImage: assetUrls.button.primary,
      dataAction: "pull",
      onClick: () => {
        // Summoning beat: the portal flares for a moment before the card lands.
        revealDelayUntil = Date.now() + REVEAL_DELAY_MS;
        if (controller.pull()) {
          const rarity = controller.snapshot().pending?.rarity ?? "common";
          portal.classList.add("mm-rift__portal--summoning");
          window.setTimeout(() => portal.classList.remove("mm-rift__portal--summoning"), REVEAL_DELAY_MS + 200);
          window.setTimeout(() => {
            sfx.play(["legendary", "mythic", "immortal", "astral", "celestial", "ultimate"].includes(rarity) ? "rare" : "pull");
            reconcileOverlay(controller.snapshot());
          }, REVEAL_DELAY_MS);
        } else {
          revealDelayUntil = 0;
          toaster.show(copy["rift.needCrystals"]);
        }
      },
    });
    const pullCost = el("span", "mm-btn__cost");
    pullCost.append(img(currencyIcon("crystal"), "mm-inline-icon"), el("span", undefined, String(PULL_COST_CRYSTALS)));
    pullBtn.append(pullCost);
    stageInner.append(pullBtn);

    const upgrade = el("section", "mm-rift__upgrade");
    const tier = riftTier(snap.riftTier);
    if (tier.upgradeGold !== undefined && tier.upgradeSeconds !== undefined) {
      const upgradeBtn = buildButtonElement({
        label: copy["rift.upgrade"],
        className: "mm-btn mm-btn--secondary",
        spriteImage: assetUrls.button.secondary,
        dataAction: "upgrade-rift",
        onClick: () => {
          if (controller.upgradeRift()) {
            sfx.play("upgrade");
            toaster.show(copy["toast.upgradeStarted"]);
          }
          else toaster.show(copy["rift.needGold"]);
        },
      });
      const upgradeLabel = el("span", "mm-rift__upgrade-label", fill("rift.upgradeCost", { gold: tier.upgradeGold, time: formatTime(tier.upgradeSeconds) }));
      const skipBtn = buildButtonElement({
        label: "",
        className: "mm-btn mm-btn--secondary",
        spriteImage: assetUrls.button.secondary,
        dataAction: "skip-upgrade",
        onClick: () => {
          if (!controller.skipUpgrade()) toaster.show(copy["rift.needGems"]);
        },
      });
      live.set("rift-upgrade-btn", upgradeBtn);
      live.set("rift-upgrade-label", upgradeLabel);
      live.set("rift-skip-btn", skipBtn);
      upgrade.append(upgradeBtn, upgradeLabel, skipBtn);
    }

    const odds = el("section", "mm-odds");
    const oddsHead = el("div", "mm-odds__head");
    oddsHead.append(el("span", undefined, copy["rift.odds"]), el("span", undefined, copy["rift.nowOdds"]), el("span", undefined, snap.riftTier < MAX_RIFT_TIER ? copy["rift.nextOdds"] : ""));
    odds.append(oddsHead);
    const now = oddsFor(snap.riftTier);
    const next = snap.riftTier < MAX_RIFT_TIER ? oddsFor(snap.riftTier + 1) : null;
    now.forEach((row, i) => {
      const nextRow = next?.[i];
      if (row.percent <= 0 && (nextRow?.percent ?? 0) <= 0) return;
      const line = el("div", `mm-odds__row mm-rarity--${row.rarity}`);
      const name = el("span", "mm-odds__name", copy[`rarity.${row.rarity}`]);
      const bar = el("span", "mm-odds__bar");
      const fillEl = el("span", "mm-odds__fill");
      fillEl.style.width = `${Math.max(2, row.percent)}%`;
      bar.append(fillEl);
      const pct = el("span", "mm-odds__pct", `${row.percent}%`);
      const nextPct = el("span", "mm-odds__next", nextRow ? `${nextRow.percent}%` : "");
      line.append(name, bar, pct, nextPct);
      odds.append(line);
    });
    rift.append(head, stage);
    if (upgrade.childElementCount > 0) rift.append(upgrade);
    rift.append(odds);
    return rift;
  };

  const itemCard = (item: Item, compare?: Item): HTMLElement => {
    const card = el("div", `mm-item mm-rarity--${item.rarity}`);
    const frame = el("div", "mm-item__frame");
    frame.append(img(item.weapon ? weaponIcon(item.weapon.element) : armorIcon(item.cls), "mm-item__icon", itemName(item)));
    const title = el("h3", "mm-item__name", itemName(item));
    const owner = el("p", "mm-item__owner", fill("reveal.for", { mage: mageName(item.cls) }));
    card.append(frame, title, owner);
    if (item.weapon) {
      const traits = el("p", "mm-item__traits");
      traits.textContent = `${copy[`range.${item.weapon.range}`]} · ${copy[`pattern.${item.weapon.pattern}`]} · ${copy[`element.${item.weapon.element}`]}`;
      const effect = el("p", "mm-item__effect", copy[`element.${item.weapon.element}.effect`]);
      card.append(traits, effect);
    }
    const stats = el("dl", "mm-item__stats");
    const compareStats = compare ? itemStats(compare) : null;
    const addRow = (key: StatKey, value: number, primary: boolean): void => {
      const row = el("div", `mm-item__stat${primary ? " mm-item__stat--primary" : ""}`);
      row.append(el("dt", undefined, copy[`stat.${key}`]), el("dd", undefined, formatStat(key, value)));
      if (compareStats) {
        const delta = value - (compareStats[key] ?? 0);
        const d = el("span", `mm-item__delta ${delta >= 0 ? "mm-item__delta--up" : "mm-item__delta--down"}`);
        d.textContent = `${delta >= 0 ? "+" : ""}${formatStat(key, delta)}`;
        row.append(d);
      }
      stats.append(row);
    };
    addRow(item.primary.stat, item.primary.value, true);
    for (const s of item.substats) addRow(s.stat, s.value, false);
    card.append(stats);
    const power = el("p", "mm-item__power", `${copy["mages.power"]} ${itemPower(item)}${compare ? ` (${itemPower(compare)})` : ""}`);
    card.append(power);
    return card;
  };

  /** The reveal: one hero item with its power verdict, who gets it, and old → new per stat. */
  const revealCard = (snap: MageMasterSnapshot, item: Item, current: Item): HTMLElement => {
    const wrap = el("div", `mm-reveal-card mm-rarity--${item.rarity}`);
    const powerDelta = itemPower(item) - itemPower(current);
    const trend = powerDelta > 0 ? "up" : powerDelta < 0 ? "down" : "same";

    const owner = el("div", "mm-reveal-card__owner");
    owner.append(
      mageImage(lookFor(snap, item.cls), "mm-reveal-card__portrait", mageName(item.cls)),
      el("span", undefined, `${mageName(item.cls)} · ${copy[item.slot === "weapon" ? "mages.weapon" : "mages.armor"]}`),
    );

    const hero = el("div", "mm-reveal-card__hero");
    hero.append(img(item.weapon ? weaponIcon(item.weapon.element) : armorIcon(item.cls), "mm-reveal-card__icon", itemName(item)));
    const badge = el("span", `mm-reveal-card__badge mm-reveal-card__badge--${trend}`);
    badge.append(el("b", undefined, `${powerDelta > 0 ? "+" : ""}${powerDelta}`), el("small", undefined, copy["compare.power"]));
    hero.append(badge);

    const name = el("h3", "mm-reveal-card__name", itemName(item));
    const meta = el("p", "mm-reveal-card__meta");
    meta.textContent = item.weapon
      ? `${copy[`range.${item.weapon.range}`]} · ${copy[`pattern.${item.weapon.pattern}`]} · ${copy[`element.${item.weapon.element}.effect`]}`
      : fill("reveal.replaces", { name: itemName(current) });

    const before = itemStats(current);
    const after = itemStats(item);
    const rows = el("dl", "mm-reveal-card__stats");
    for (const key of STAT_KEYS) {
      const a = before[key] ?? 0;
      const b = after[key] ?? 0;
      if (a === 0 && b === 0) continue;
      const delta = b - a;
      const rowTrend = delta > 0 ? "up" : delta < 0 ? "down" : "same";
      const row = el("div", "mm-reveal-card__row");
      row.append(
        el("dt", undefined, copy[`stat.${key}`]),
        el("dd", "mm-reveal-card__old", formatStat(key, a)),
        el("dd", "mm-reveal-card__new", formatStat(key, b)),
        el("span", `mm-reveal-card__delta mm-reveal-card__delta--${rowTrend}`, delta === 0 ? "" : `${delta > 0 ? "+" : ""}${formatStat(key, delta)}`),
      );
      rows.append(row);
    }
    wrap.append(owner, hero, name, meta, rows);
    return wrap;
  };

  const renderMages = (snap: MageMasterSnapshot): HTMLElement => {
    const mages = el("main", "mm-mages");
    const head = el("header", "mm-page__head");
    head.append(el("h1", "mm-page__title", copy["mages.title"]));
    mages.append(head);
    for (const cls of MAGE_CLASSES) {
      const loadout = snap.loadout[cls];
      const stats = mageStats(cls, loadout);
      const card = el("section", `mm-mage mm-mage--${cls}`);
      const top = el("div", "mm-mage__top");
      top.append(framedPortrait(lookFor(snap, cls), "mm-mage__sprite", mageName(cls), artFrame("portrait")));
      const ident = el("div", "mm-mage__ident");
      ident.append(el("h2", "mm-mage__name", mageName(cls)), el("p", "mm-mage__role", copy[`mage.${cls}.role`]));
      ident.append(el("p", "mm-mage__power", `${copy["mages.power"]} ${itemPower(loadout.weapon) + itemPower(loadout.armor)}`));
      top.append(ident);
      const slots = el("div", "mm-mage__slots");
      for (const item of [loadout.weapon, loadout.armor]) {
        const slot = buildButtonElement({
          label: itemName(item),
          ariaLabel: itemName(item),
          className: `mm-slot mm-rarity--${item.rarity}`,
          dataAction: `slot-${cls}-${item.slot}`,
          onClick: () => {
            itemDetail = item;
            reconcileOverlay(controller.snapshot());
          },
        });
        slot.replaceChildren(
          img(item.weapon ? weaponIcon(item.weapon.element) : armorIcon(cls), "mm-slot__icon"),
          el("span", "mm-slot__label", copy[item.slot === "weapon" ? "mages.weapon" : "mages.armor"]),
          el("span", "mm-slot__rarity", copy[`rarity.${item.rarity}`]),
        );
        slots.append(slot);
      }
      top.append(slots);
      card.append(top);
      const grid = el("dl", "mm-mage__stats");
      for (const key of STAT_KEYS) {
        const row = el("div", "mm-mage__stat");
        row.append(el("dt", undefined, copy[`stat.${key}`]), el("dd", undefined, formatStat(key, stats[key])));
        grid.append(row);
      }
      card.append(grid);
      mages.append(card);
    }
    return mages;
  };

  const renderShop = (): HTMLElement => {
    const shopPage = el("main", "mm-shop");
    const head = el("header", "mm-page__head");
    head.append(el("h1", "mm-page__title", copy["shop.title"]));
    shopPage.append(head);
    const host = el("div", "mm-shop__host");
    shopPage.append(host);
    shop = mountShopPage<GemGrant>({
      mountInto: host,
      id: "mm-shop",
      iap: controller.iap,
      sections: [{ group: GEM_GROUP, layout: "featured" }],
      copy: SHOP_COPY,
      badges: { best: copy["shop.badge.best"] },
      resolveIcon: (product) => shopIcon(product.id),
      onPurchase: (result) => {
        // A user cancel is not a failure; every other non-purchase is.
        if (result.status === "cancelled") return;
        if (result.status !== "purchased") {
          toaster.show(copy["shop.failed"]);
          return;
        }
        const gems = gemsForProductId(result.productId);
        controller.purchaseGems(gems, result.productId);
        sfx.play("coin");
        toaster.show(fill("shop.purchased", { gems }));
      },
    });
    // Store init is async and has no clock of its own: refresh once it settles.
    void controller.iap.init().then(() => shop?.refresh());
    return shopPage;
  };

  const renderBattle = (snap: MageMasterSnapshot): HTMLElement => {
    const battle = el("main", "mm-battle");
    battle.dataset.mmTheme = ARENA_THEME[levelSpec(snap.level).family];
    const top = el("header", "mm-battle__top");
    const title = el("div", "mm-battle__title");
    const levelLabel = el("span", "mm-battle__level", fill("battle.level", { level: snap.level }));
    const stageLabel = el("span", "mm-battle__stage", fill("battle.stage", { stage: snap.stage, count: snap.stageCount }));
    live.set("battle-stage", stageLabel);
    title.append(levelLabel, stageLabel);
    const pauseBtn = buildButtonElement({
      label: copy["battle.pause"],
      ariaLabel: copy["battle.pause"],
      className: "mm-icon-btn",
      dataAction: "pause",
      onClick: () => controller.pause(),
    });
    pauseBtn.replaceChildren(img(chromeIcon("pause"), "mm-icon-btn__icon"));
    const speedBtn = buildButtonElement({
      label: snap.speed === 2 ? copy["battle.speed2"] : copy["battle.speed1"],
      ariaLabel: copy["battle.speed"],
      className: "mm-icon-btn mm-icon-btn--speed",
      dataAction: "speed",
      onClick: () => controller.toggleSpeed(),
    });
    live.set("speed-btn", speedBtn);
    top.append(speedBtn, title, pauseBtn);

    const arena = el("div", "mm-battle__arena");
    const canvasHost = el("div", "mm-battle__canvas");
    arena.append(canvasHost);
    // Boss health lives in the DOM over the arena, where the strip and the
    // camera can never hide it; onBattleFrame drives it from the sim view.
    const bossBar = el("div", "mm-bossbar");
    bossBar.hidden = true;
    const bossName = el("span", "mm-bossbar__name");
    const bossTrack = el("div", "mm-bossbar__track");
    const bossFill = el("span", "mm-bossbar__fill");
    bossTrack.append(bossFill);
    bossBar.append(bossName, bossTrack);
    live.set("boss-bar", bossBar);
    live.set("boss-name", bossName);
    live.set("boss-fill", bossFill);
    arena.append(bossBar);
    const track = el("div", "mm-track");
    track.setAttribute("aria-hidden", "true");
    stageDots.length = 0;
    for (let i = 0; i < snap.stageCount; i += 1) {
      const dot = el("span", "mm-track__dot");
      stageDots.push(dot);
      track.append(dot);
    }
    arena.append(track);

    const hud = el("footer", "mm-hud");
    hudBars.clear();
    for (const cls of MAGE_CLASSES) {
      const loadout = snap.loadout[cls];
      const card = el("div", `mm-hud__mage mm-hud__mage--${cls}`);
      const head = el("div", "mm-hud__head");
      head.append(framedPortrait(lookFor(snap, cls), "mm-hud__portrait", mageName(cls), artFrame("portrait")), el("span", "mm-hud__name", mageName(cls)));
      card.append(head);
      const bar = el("div", "mm-hud__bar");
      const fillEl = el("span", "mm-hud__fill");
      bar.append(fillEl);
      const value = el("span", "mm-hud__hp", "");
      card.append(bar, value);
      const slots = el("div", "mm-hud__slots");
      slots.append(
        img(weaponIcon(loadout.weapon.weapon?.element ?? "fire"), `mm-hud__slot mm-rarity--${loadout.weapon.rarity}`),
        img(armorIcon(cls), `mm-hud__slot mm-rarity--${loadout.armor.rarity}`),
      );
      card.append(slots);
      hud.append(card);
      hudBars.set(cls, { fill: fillEl, value, card });
    }
    battle.append(top, arena, hud);
    battleCanvasHost = canvasHost;
    return battle;
  };

  let battleCanvasHost: HTMLElement | null = null;
  let rendererToken = 0;

  /** Create the Phaser renderer once the page is attached (FIT needs a laid-out parent) and the party looks are drawn. */
  const startRenderer = (snap: MageMasterSnapshot): void => {
    const host = battleCanvasHost;
    if (!host) return;
    const token = ++rendererToken;
    const looks = MAGE_CLASSES.map((cls) => lookFor(snap, cls));
    void Promise.all(looks.map((look) => composeMage(look).catch(() => null))).then(() => {
      if (token !== rendererToken || !host.isConnected) return;
      renderer?.destroy();
      const partyLooks = Object.fromEntries(looks.map((look) => [look.cls, look])) as Record<MageClass, MageLook>;
      renderer = createBattleRenderer({ container: host, controller, onFrame: onBattleFrame, partyLooks, sfx, minimal: isMinimal() });
    });
  };

  const onBattleFrame = (view: BattleView): void => {
    for (const unit of view.units) {
      if (unit.side !== "party") continue;
      const bar = hudBars.get(unit.kind as MageClass);
      if (!bar) continue;
      const ratio = unit.alive ? unit.hp / unit.maxHp : 0;
      bar.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio)).toFixed(3)})`;
      bar.value.textContent = `${Math.max(0, Math.round(unit.hp))} / ${unit.maxHp}`;
      bar.card.classList.toggle("mm-hud__mage--dead", !unit.alive);
      bar.card.classList.toggle("mm-hud__mage--low", unit.alive && ratio < 0.3);
      bar.fill.dataset.mmHp = ratio >= 0.6 ? "high" : ratio >= 0.3 ? "mid" : "low";
    }
    const bossBar = live.get("boss-bar");
    if (bossBar) {
      const boss = view.units.find((unit) => unit.side === "enemy" && unit.boss && unit.alive);
      bossBar.hidden = !boss;
      if (boss) {
        const name = copy[enemyDefinition(boss.kind as EnemyKind).nameKey];
        const nameEl = live.get("boss-name");
        if (nameEl && nameEl.textContent !== name) nameEl.textContent = name;
        const ratio = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
        const fillEl = live.get("boss-fill");
        if (fillEl) {
          fillEl.style.transform = `scaleX(${ratio.toFixed(3)})`;
          fillEl.dataset.mmHp = ratio >= 0.6 ? "high" : ratio >= 0.3 ? "mid" : "low";
        }
      }
    }
    const stageLabel = live.get("battle-stage");
    if (stageLabel) {
      const text = fill("battle.stage", { stage: view.stage, count: view.stageCount });
      if (stageLabel.textContent !== text) stageLabel.textContent = text;
    }
    stageDots.forEach((dot, i) => {
      dot.classList.toggle("mm-track__dot--done", i + 1 < view.stage);
      dot.classList.toggle("mm-track__dot--current", i + 1 === view.stage);
      dot.classList.toggle("mm-track__dot--boss", i + 1 === view.stageCount);
    });
  };

  // ---------- overlays ----------
  const lootRow = (gold: number, crystals: number, gems: number): HTMLElement => {
    const row = el("div", "mm-loot");
    const cell = (key: Currency, value: number): HTMLElement => {
      const c = el("span", "mm-loot__cell");
      c.dataset.mmLoot = key;
      c.append(img(currencyIcon(key), "mm-inline-icon"), el("span", undefined, `+${value}`));
      return c;
    };
    row.append(cell("gold", gold), cell("crystal", crystals));
    if (gems > 0) row.append(cell("gem", gems));
    return row;
  };

  const spriteAction = (label: string, dataAction: string, primary: boolean, onClick: () => void): HTMLButtonElement =>
    buildButtonElement({
      label,
      dataAction,
      spriteImage: primary ? assetUrls.button.primary : assetUrls.button.secondary,
      className: `mm-btn ${primary ? "mm-btn--primary" : "mm-btn--secondary"}`,
      onClick,
    });

  /** A quiet secondary action: plain text, no plate, for the option nobody should tap by reflex. */
  const textAction = (label: string, dataAction: string, onClick: () => void): HTMLButtonElement =>
    buildButtonElement({ label, dataAction, className: "mm-btn mm-btn--text", onClick });

  const mountOverlay = (kind: Overlay, snap: MageMasterSnapshot): UiHandle | null => {
    switch (kind) {
      case "pause": {
        const pause = mountPauseOverlay({
          mountInto: root,
          id: "mm-pause",
          labels: { title: copy["pause.title"], resume: copy["pause.resume"], settings: copy["pause.settings"], quit: copy["pause.quit"] },
          actions: {
            onResume: () => controller.resume(),
            onSettings: () => controller.openSettings(),
            onQuit: () => controller.quitBattle(),
          },
        });
        // The kit pause card takes no sprites; dress it like the other modals.
        const card = pause.el.querySelector<HTMLElement>(".fab-modal-card");
        if (card) {
          card.classList.add("mm-modal", "mm-modal--pause");
          if (!isMinimal()) {
            card.classList.add("fab-modal-card--image");
            card.style.setProperty("--fab-modal-card-image", `url(${assetUrls.panel})`);
            card.style.backgroundImage = `url(${assetUrls.panel})`;
          }
        }
        for (const button of pause.el.querySelectorAll<HTMLButtonElement>(".fab-btn")) {
          const primary = button.dataset.fabAction === "pause-resume";
          button.classList.add("mm-btn", primary ? "mm-btn--primary" : "mm-btn--secondary");
          button.style.setProperty("--fab-btn-sprite-image", `url(${primary ? assetUrls.button.primary : assetUrls.button.secondary})`);
        }
        return pause;
      }
      case "settings": {
        const title = el("h1", undefined, copy["settings.title"]);
        return mountSettingsPage({
          mountInto: root,
          id: "mm-settings",
          header: title,
          backIcon: chromeIcon("back"),
          backLabel: copy["settings.back"],
          instant: true,
          settings: {
            ...snap.settings,
            labels: { music: copy["settings.music"], sfx: copy["settings.sfx"], haptics: copy["settings.haptics"] },
          },
          onToggle: (key, next) => controller.setSetting(key, next),
          legalLinks: [
            { label: isMinimal() ? copy["settings.uiToClassic"] : copy["settings.uiToMinimal"], url: "toggle-ui" },
            { label: copy["settings.reset"], url: "reset-save" },
          ],
          onOpenLink: (url) => {
            if (url === "toggle-ui") {
              controller.setSetting("minimalUi", !isMinimal());
              // Remount the page so the row reads the new state.
              overlayKey = null;
              reconcileOverlay(controller.snapshot());
              return;
            }
            if (url !== "reset-save") return;
            // Two taps within 4 s: an accidental tap must not wipe a session.
            if (resetArmedAt !== null && Date.now() - resetArmedAt < 4000) {
              resetArmedAt = null;
              controller.resetSave();
              return;
            }
            resetArmedAt = Date.now();
            toaster.show(copy["settings.resetConfirm"]);
          },
          onDismiss: () => {
            if (controller.snapshot().surface === "settings") controller.closeSettings();
          },
        });
      }
      case "win":
      case "fail": {
        const win = kind === "win";
        const actions = el("div", "fab-modal-actions mm-result__actions");
        // The grant already landed in the save; the pills hold the old totals until the
        // player taps an action, when the loot flies to the counters and counts down.
        const grant = { gold: snap.loot?.gold ?? 0, crystal: snap.loot?.crystals ?? 0, gem: snap.reward?.gems ?? 0 };
        const totals = { gold: snap.gold, crystal: snap.crystals, gem: snap.gems };
        const from = { ...totalsBefore };
        for (const key of ["gold", "crystal", "gem"] as const) {
          const pillValue = live.get(`pill-${key}`);
          if (grant[key] > 0 && pillValue) {
            countingUntil[key] = Number.POSITIVE_INFINITY;
            pillValue.textContent = formatCount(from[key]);
          }
        }
        const collectThen = (proceed: () => void): void => {
          let launched = false;
          for (const key of ["gold", "crystal", "gem"] as const) {
            const cell = root.querySelector(`[data-mm-loot="${key}"]`);
            if (flyCurrency(key, grant[key], cell, from[key], totals[key])) {
              launched = true;
              countDown(cell, grant[key]);
            } else {
              countingUntil[key] = 0;
            }
          }
          if (!launched) {
            proceed();
            return;
          }
          for (const button of actions.querySelectorAll("button")) button.disabled = true;
          window.setTimeout(proceed, RESULT_COLLECT_MS);
        };
        if (win) {
          actions.append(
            spriteAction(copy["win.next"], "result-next", true, () => collectThen(() => controller.next())),
            spriteAction(copy["win.home"], "result-menu", false, () =>
              collectThen(() => {
                controller.next();
                controller.home();
              }),
            ),
          );
        } else {
          actions.append(
            spriteAction(copy["fail.retry"], "result-retry", true, () => collectThen(() => controller.retry())),
            spriteAction(copy["fail.home"], "result-menu", false, () =>
              collectThen(() => {
                controller.retry();
                controller.home();
              }),
            ),
          );
        }
        const reward = el("div", "mm-result__reward");
        reward.append(el("p", "mm-result__loot-label", copy["result.loot"]), lootRow(snap.loot?.gold ?? 0, snap.loot?.crystals ?? 0, snap.reward?.gems ?? 0));
        if (snap.reward?.firstClear) reward.append(el("p", "mm-result__first", fill("win.firstClear", { gems: snap.reward.gems })));
        const letter = artLettering(win ? "victory" : "defeat");
        const resultCard = mountResultCard({
          mountInto: root,
          id: win ? "mm-win" : "mm-fail",
          variant: win ? "win" : "lose",
          title: win ? copy["win.title"] : copy["fail.title"],
          ribbonImage: letter ?? (win ? assetUrls.ribbon.win : assetUrls.ribbon.fail),
          cardImage: skinned(assetUrls.panel),
          messages: [win ? fill("win.eyebrow", { level: snap.level }) : fill("fail.eyebrow", { level: snap.level }), win ? copy["win.message"] : copy["fail.message"]],
          rewardDisplay: reward,
          actions,
        });
        if (letter) resultCard.el.classList.add("mm-modal--lettered");
        if (win) {
          // Confetti burst behind the card: 24 tinted chips with staggered falls.
          const burst = el("div", "mm-confetti");
          burst.setAttribute("aria-hidden", "true");
          for (let i = 0; i < 24; i += 1) {
            const chip = el("span", `mm-confetti__chip mm-confetti__chip--${i % 4}`);
            chip.style.left = `${4 + ((i * 37) % 92)}%`;
            chip.style.animationDelay = `${(i % 6) * 90}ms`;
            chip.style.animationDuration = `${1400 + (i % 5) * 180}ms`;
            burst.append(chip);
          }
          resultCard.el.prepend(burst);
        }
        return resultCard;
      }
      case "reveal": {
        const item = snap.pending;
        if (!item) return null;
        const current = item.slot === "weapon" ? snap.loadout[item.cls].weapon : snap.loadout[item.cls].armor;
        const body = el("div", "mm-reveal");
        body.append(revealCard(snap, item, current));
        const actions = el("div", "fab-modal-actions mm-reveal__actions");
        actions.append(
          spriteAction(copy["reveal.use"], "reveal-use", true, () => {
            if (controller.useItem()) {
              sfx.play("equip");
              toaster.show(fill("toast.equipped", { name: itemName(item), mage: mageName(item.cls) }));
            }
          }),
          textAction(fill("reveal.discard", { gold: discardValue(item) }), "reveal-discard", () => {
            const gold = discardValue(item);
            const before = controller.snapshot().gold;
            flyCurrency("gold", gold, body.querySelector(".mm-item__frame"), before, before + gold);
            if (controller.discardItem()) {
              sfx.play("coin");
              toaster.show(fill("toast.discarded", { gold }));
            }
          }),
        );
        const summonedArt = artLettering("summoned");
        const handle = mountModalShell({
          mountInto: root,
          id: "mm-reveal",
          ribbon: { title: copy["reveal.title"], image: summonedArt ?? assetUrls.ribbon.neutral },
          body,
          actions,
          cardImage: skinned(assetUrls.panel),
          cardClassName: `mm-modal mm-modal--reveal mm-rarity--${item.rarity}`,
        });
        handle.el.classList.add(`mm-reveal-glow--${item.rarity}`);
        if (summonedArt) handle.el.classList.add("mm-modal--lettered");
        return handle;
      }
      case "item": {
        const item = itemDetail;
        if (!item) return null;
        const actions = el("div", "fab-modal-actions");
        actions.append(
          spriteAction(copy["item.close"], "item-close", true, () => {
            itemDetail = null;
            reconcileOverlay(controller.snapshot());
          }),
        );
        return mountModalShell({
          mountInto: root,
          id: "mm-item",
          ribbon: { title: itemName(item), image: assetUrls.ribbon.neutral },
          body: itemCard(item),
          actions,
          cardImage: skinned(assetUrls.panel),
          cardClassName: `mm-modal mm-rarity--${item.rarity}`,
          backdropDismiss: true,
          onDismiss: () => {
            itemDetail = null;
          },
        });
      }
      case "offline": {
        const grant = snap.offline;
        if (!grant) return null;
        const body = el("div", "mm-offline");
        body.append(el("p", "mm-offline__message", fill("offline.message", { time: formatTime(grant.seconds) })), lootRow(grant.gold, grant.crystals, 0));
        const actions = el("div", "fab-modal-actions");
        actions.append(
          spriteAction(copy["offline.claim"], "offline-claim", true, () => {
            const before = controller.snapshot();
            flyCurrency("gold", grant.gold, body.querySelector('[data-mm-loot="gold"]'), before.gold, before.gold + grant.gold);
            flyCurrency("crystal", grant.crystals, body.querySelector('[data-mm-loot="crystal"]'), before.crystals, before.crystals + grant.crystals);
            controller.claimOffline();
          }),
        );
        const welcomeArt = artLettering("welcome");
        const offlineCard = mountModalShell({
          mountInto: root,
          id: "mm-offline",
          ribbon: { title: copy["offline.title"], image: welcomeArt ?? assetUrls.ribbon.win },
          body,
          actions,
          cardImage: skinned(assetUrls.panel),
          cardClassName: "mm-modal",
        });
        if (welcomeArt) offlineCard.el.classList.add("mm-modal--lettered");
        return offlineCard;
      }
      default:
        return null;
    }
  };

  const targetOverlay = (snap: MageMasterSnapshot): Overlay => {
    if (snap.offline && pageFor(snap.surface) !== "battle") return "offline";
    if (snap.surface === "settings") return "settings";
    if (snap.surface === "pause") return "pause";
    if (snap.surface === "win") return "win";
    if (snap.surface === "fail") return "fail";
    // A pending pull always needs a decision; deriving from the save means a
    // restart mid-reveal brings the card back instead of stranding the item.
    if (snap.pending && snap.surface === "rift") return Date.now() < revealDelayUntil ? null : "reveal";
    if (itemDetail) return "item";
    return null;
  };

  const reconcileOverlay = (snap: MageMasterSnapshot): void => {
    const next = targetOverlay(snap);
    const nextKey = next === "reveal" ? `reveal-${snap.pending?.id}` : next === "item" ? `item-${itemDetail?.id}` : next;
    if (nextKey === overlayKey) return;
    overlayKey = nextKey;
    const old = overlayHandle;

    overlayHandle = null;
    old?.dismiss();
    for (const key of ["gold", "crystal", "gem"] as const) {
      if (countingUntil[key] === Number.POSITIVE_INFINITY) countingUntil[key] = 0;
    }
    if (next) overlayHandle = mountOverlay(next, snap);
  };
  let overlayKey: string | null = null;

  // ---------- live values ----------
  const refreshLive = (snap: MageMasterSnapshot): void => {
    live.get("pill-energy")!.textContent = `${snap.energy}/${ENERGY.cap}`;
    const energySub = live.get("pill-energy-sub");
    if (energySub) energySub.textContent = snap.energy >= ENERGY.cap ? "" : formatTime(snap.energyNextIn);
    const now = Date.now();
    const totals = { gold: snap.gold, crystal: snap.crystals, gem: snap.gems };
    for (const key of ["gold", "crystal", "gem"] as const) {
      if (now < countingUntil[key]) continue;
      live.get(`pill-${key}`)!.textContent = formatCount(totals[key]);
      displayed[key] = totals[key];
    }
    const note = live.get("energy-note");
    if (note) note.textContent = snap.energy < ENERGY.levelCost ? fill("menu.noEnergy", { seconds: snap.energyNextIn }) : "";
    const play = root.querySelector<HTMLButtonElement>('[data-fab-action="play"]');
    if (play) play.disabled = snap.energy < ENERGY.levelCost;
    const upgradeBtn = live.get("rift-upgrade-btn") as HTMLButtonElement | undefined;
    const upgradeLabel = live.get("rift-upgrade-label");
    const skipBtn = live.get("rift-skip-btn") as HTMLButtonElement | undefined;
    if (upgradeBtn && upgradeLabel && skipBtn) {
      const upgrading = snap.riftUpgradeRemaining !== null;
      upgradeBtn.hidden = upgrading;
      skipBtn.hidden = !upgrading;
      if (upgrading) {
        upgradeLabel.textContent = fill("rift.upgrading", { time: formatTime(snap.riftUpgradeRemaining ?? 0) });
        const gems = skipCost({ rift: { tier: snap.riftTier, upgradeEndsAt: Date.now() + (snap.riftUpgradeRemaining ?? 0) * 1000 } } as never, Date.now());
        skipBtn.textContent = gems === 1 ? copy["rift.skipOne"] : fill("rift.skip", { gems });
      } else {
        const tier = riftTier(snap.riftTier);
        if (tier.upgradeGold !== undefined && tier.upgradeSeconds !== undefined) {
          upgradeLabel.textContent = fill("rift.upgradeCost", { gold: tier.upgradeGold, time: formatTime(tier.upgradeSeconds) });
        }
      }
    }
    const speedBtn = live.get("speed-btn");
    if (speedBtn) {
      speedBtn.textContent = snap.speed === 2 ? copy["battle.speed2"] : copy["battle.speed1"];
      speedBtn.classList.toggle("mm-icon-btn--active", snap.speed === 2);
    }
    const pullBtn = root.querySelector<HTMLButtonElement>('[data-fab-action="pull"]');
    if (pullBtn) pullBtn.disabled = snap.crystals < PULL_COST_CRYSTALS || snap.pending !== null;
    for (const btn of nav.querySelectorAll<HTMLButtonElement>(".mm-nav__btn")) {
      const action = btn.dataset.fabAction;
      const active = (action === "nav-home" && snap.surface === "menu") || (action === "nav-rift" && snap.surface === "rift") || (action === "nav-mages" && snap.surface === "mages") || (action === "nav-shop" && snap.surface === "shop");
      btn.classList.toggle("mm-nav__btn--active", active);
    }
  };

  const structureKey = (snap: MageMasterSnapshot): string =>
    [
      pageFor(snap.surface),
      snap.settings.minimalUi ? "minimal" : "classic",
      // Art availability: a page rendered before a late-resolving asset re-renders once it lands.
      [artFrame("panel"), artFrame("button"), artScene("home"), artScene("rift"), artNode("current"), artLettering("title")].filter(Boolean).length,
      snap.unlockedLevel,
      snap.riftTier,
      snap.level,
      MAGE_CLASSES.map((c) => `${snap.loadout[c].weapon.id}:${snap.loadout[c].armor.id}`).join(","),
    ].join("|");

  const refresh = (): void => {
    const snap = controller.snapshot();
    totalsBefore = { ...displayed };
    applyFrames();
    const nextPage = pageFor(snap.surface);
    const key = structureKey(snap);
    if (nextPage !== page || key !== pageKey) {
      live.forEach((_v, k) => {
        if (!k.startsWith("pill-")) live.delete(k);
      });
      if (page === "battle" && nextPage !== "battle") {
        rendererToken += 1;
        renderer?.destroy();
        renderer = null;
      }
      // The shop page owns a live purchase flow; drop it before its host element goes.
      shop?.dismiss();
      shop = null;
      page = nextPage;
      pageKey = key;
      const content =
        nextPage === "menu"
          ? renderMenu(snap)
          : nextPage === "rift"
            ? renderRift(snap)
            : nextPage === "mages"
              ? renderMages(snap)
              : nextPage === "shop"
                ? renderShop()
                : renderBattle(snap);
      body.replaceChildren(content);
      root.dataset.fabState = snap.surface;
      root.classList.toggle("mm-root--battle", nextPage === "battle");
      nav.hidden = nextPage === "battle";
      if (nextPage === "battle") startRenderer(snap);
    }
    root.dataset.fabState = snap.surface;
    sfx.setEnabled(snap.settings.sfx);
    sfx.setMusicEnabled(snap.settings.music);
    sfx.music(nextPage === "battle" ? "battle" : "menu");
    if (snap.surface !== previousSurface) {
      if (snap.surface === "win") sfx.play("win");
      if (snap.surface === "fail") sfx.play("lose");
      // First time home after the first clear: point at the Rift once.
      if (snap.surface === "menu" && snap.highestCleared === 1 && snap.pulls === 0 && previousSurface === "win") {
        toaster.show(copy["hint.rift"]);
      }
      previousSurface = snap.surface;
    }
    if (snap.riftTier !== previousTier) {
      // Only an increase is an upgrade; a reset lowers the tier silently.
      if (snap.riftTier > previousTier) toaster.show(fill("toast.upgradeDone", { tier: snap.riftTier + 1 }));
      previousTier = snap.riftTier;
    }
    refreshLive(snap);
    shop?.refresh();
    reconcileOverlay(snap);
  };

  const unsubscribe = controller.subscribe(refresh);
  const onVisibility = (): void => {
    if (document.visibilityState === "visible") {
      controller.wake();
      sfx.resume();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  const timer = window.setInterval(() => {
    controller.tick();
    refreshLive(controller.snapshot());
  }, 1000);

  return {
    root,
    refresh,
    clientPoint(action) {
      const target = root.querySelector<HTMLElement>(`[data-fab-action="${action}"]`);
      if (!target) return null;
      const r = target.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    captureBattleFrames(count, everyMs) {
      return renderer ? renderer.captureFrames(count, everyMs) : Promise.resolve([]);
    },
    destroy() {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe();
      overlayHandle?.dismiss();
      shop?.dismiss();
      renderer?.destroy();
      toaster.dismiss();
      root.remove();
    },
  };
}

export type { CopyKey };
