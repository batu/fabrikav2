import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createShellEvidenceProbe,
  readDomShellEvidenceActions,
  readDomShellEvidenceViewport,
} from "@fabrikav2/testkit/harness";
import { gameConfig } from "../../game.config.ts";
import { createTemplateShellController } from "../../src/core/TemplateShellController.ts";
import { createTemplateHarness } from "../../src/shell/harness.ts";
import { mountTemplateShell } from "../../src/shell/TemplateShell.ts";

function createController() {
  return createTemplateShellController({
    storageKey: "fabrikav2.shell-proof.shop-test",
    now: () => 123,
  });
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
    clear: () => storage.clear(),
  });
  document.body.innerHTML = '<div id="app"></div>';
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("seven-surface shop proof", () => {
  it("opens the Shop only from Home and Back always returns Home", async () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });

    // Only from Home.
    controller.startCurrent();
    expect(controller.openShop()).toBe(false);
    controller.home();
    shell.render();

    const shopButton = shell.root.querySelector<HTMLButtonElement>('[data-fab-action="shop"]');
    expect(shopButton).not.toBeNull();
    expect(shopButton!.dataset.fabInstance).toBe("menu.shop");
    // The Shop entry keeps the utility row's geometry but is visibly its own
    // door: the accent fill separates it from the quiet Settings control.
    expect(shopButton!.classList.contains("template-shell__icon-action--utility")).toBe(true);
    expect(shopButton!.classList.contains("template-shell__icon-action--shop")).toBe(true);
    const settingsButton = shell.root.querySelector<HTMLButtonElement>('[data-fab-action="settings"]');
    expect(settingsButton!.classList.contains("template-shell__icon-action--shop")).toBe(false);
    const css = readFileSync(resolve(process.cwd(), "src/shell/template-shell.css"), "utf8");
    expect(css).toMatch(
      /\.template-shell__icon-action--shop\s*\{[^}]*background-color:\s*var\(--fab-color-accent\);/s,
    );
    shopButton!.click();
    expect(controller.snapshot()).toMatchObject({ surface: "shop", shopOpen: true, scene: "menu" });
    expect(shell.root.dataset.fabState).toBe("shop");

    const back = shell.root.querySelector<HTMLButtonElement>('[data-fab-action="back"]');
    expect(back).not.toBeNull();
    expect(back!.dataset.fabInstance).toBe("shop.back");
    back!.click();
    expect(controller.snapshot()).toMatchObject({ surface: "menu", shopOpen: false });
  });

  it("renders the currency header with the synthetic second currency, read-only", async () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });
    expect(await controller.driveTo("shop")).toBe(true);
    shell.render();
    await flushMicrotasks();

    const primary = shell.root.querySelector<HTMLElement>('[data-fab-instance="shop.currency"]');
    const secondary = shell.root.querySelector<HTMLElement>(
      '[data-fab-instance="shop.currency.secondary"]',
    );
    expect(primary?.textContent).toContain(String(controller.snapshot().currency));
    expect(secondary?.textContent).toContain(String(controller.snapshot().secondaryCurrency));
    expect(controller.snapshot().secondaryCurrency).toBe(12);
    expect(secondary?.getAttribute("role")).toBe("status");

    // The two balances must be distinguishable: both show their unit label,
    // the secondary pill has its own fill, and the coin icon never stands in
    // for the gem balance.
    expect(primary?.querySelector(".template-shell__currency-label")?.textContent).not.toBe("");
    expect(secondary?.classList.contains("template-shell__currency--secondary")).toBe(true);
    expect(secondary?.querySelector(".template-shell__currency-label")?.textContent).not.toBe("");
    expect(secondary?.querySelector(".template-shell__currency-icon")).toBeNull();
  });

  it("renders three inert sample cards with available/owned/locked variants", async () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });
    const currencyBefore = controller.snapshot().currency;
    expect(await controller.driveTo("shop")).toBe(true);
    shell.render();
    await flushMicrotasks();

    const cards = Array.from(
      shell.root.querySelectorAll<HTMLElement>('[data-fab-instance^="shop.item."]'),
    );
    expect(cards.map((card) => [card.dataset.fabInstance, card.dataset.fabVariant])).toEqual([
      ["shop.item.available", "available"],
      ["shop.item.owned", "owned"],
      ["shop.item.locked", "locked"],
    ]);
    // Cards carry no action hook and taps never mutate shell state. Each
    // card's CTA/status chip renders inside the annotated card element, not
    // detached below it.
    for (const card of cards) {
      expect(card.dataset.fabAction).toBeUndefined();
      expect(card.querySelector(".fab-shop-purchase-btn")).not.toBeNull();
      card.click();
    }
    expect(controller.snapshot()).toMatchObject({ surface: "shop", currency: currencyBefore });

    // The locked sample ships no store metadata: its purchase button is inert.
    const lockedButton = shell.root
      .querySelector<HTMLElement>('[data-catalog-id="item_gamma"]')!
      .parentElement!.querySelector<HTMLButtonElement>("button");
    expect(lockedButton?.disabled).toBe(true);

    // The owned sample never sells again: its live price CTA is replaced by
    // an inert disabled OWNED state, never an active price.
    const ownedCta = shell.root
      .querySelector<HTMLElement>('[data-fab-instance="shop.item.owned"]')!
      .querySelector<HTMLButtonElement>(".fab-shop-purchase-btn");
    expect(ownedCta?.disabled).toBe(true);
    expect(ownedCta?.textContent).toBe("Owned");
    expect(ownedCta?.textContent).not.toContain("$");
    expect(ownedCta?.getAttribute("aria-label")).toContain("Owned");
  });

  it("exposes a deterministic restore action through the fake provider seam", async () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });
    const currencyBefore = controller.snapshot().currency;
    expect(await controller.driveTo("shop")).toBe(true);
    shell.render();
    await flushMicrotasks();

    const restore = shell.root.querySelector<HTMLButtonElement>('[data-fab-action="shop-restore"]');
    expect(restore).not.toBeNull();
    expect(restore!.dataset.fabInstance).toBe("shop.restore");
    expect(restore!.disabled).toBe(false);
    restore!.click();
    await flushMicrotasks();

    const result = await controller.sdk.iap.restore();
    expect(result.status).toBe("restored");
    expect(result.ownedProductIds).toEqual(["com.fabrika.shellproof.item_beta"]);
    // Restore never mutates the shell's currency or progression.
    expect(controller.snapshot()).toMatchObject({ surface: "shop", currency: currencyBefore });
  });

  it("keeps the Shop catalog region the single scrollable area", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/shell/template-shell.css"),
      "utf8",
    );
    const catalogRule = css.slice(css.indexOf(".template-shell__shop-catalog"));
    expect(catalogRule).toContain("overflow-y: auto");
  });

  it("grounds every catalog card with explicit fills instead of opacity washes", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/shell/template-shell.css"),
      "utf8",
    );
    // The wrapper is the visual card: bounded surface with the CTA inside.
    expect(css).toMatch(
      /\.template-shell__shop \.fab-shop-card-wrapper\s*\{[^}]*border:[^;]*;[^}]*background-color:\s*var\(--fab-seed-color-shop-card-surface\);/s,
    );
    // Enabled CTAs are accent-on-accent; disabled CTAs are legible muted
    // chips at full opacity, never the kit's faded ghost.
    expect(css).toMatch(
      /\.template-shell__shop \.fab-shop-purchase-btn\s*\{[^}]*background-color:\s*var\(--fab-color-accent\);[^}]*color:\s*var\(--fab-color-on-accent\);/s,
    );
    expect(css).toMatch(
      /\.template-shell__shop \.fab-shop-purchase-btn:disabled,[\s\S]*?\{[^}]*opacity:\s*1;[^}]*background-color:\s*var\(--fab-color-secondary-surface\);[^}]*color:\s*var\(--fab-color-text-muted\);/s,
    );
    // Locked is grounded by a muted dashed fill, not dimmed away.
    expect(css).toMatch(
      /\.template-shell__shop \[data-fab-variant="locked"\]\s*\{[^}]*background-color:\s*var\(--fab-color-secondary-surface\);[^}]*border-style:\s*dashed;/s,
    );
    expect(css).not.toMatch(/\[data-fab-variant="locked"\]\s*\{[^}]*opacity:/s);
    // Restore is a real filled action over a bounded panel.
    expect(css).toMatch(
      /\.template-shell__shop \.fab-shop-restore-btn\s*\{[^}]*background-color:\s*var\(--fab-color-accent\);/s,
    );
    // The owned chip has its own explicit fill: soft accent surface with a
    // dark label — apart from both the live price and the muted locked chip.
    expect(css).toMatch(
      /\.template-shell__shop \[data-fab-variant="owned"\] \.fab-shop-purchase-btn:disabled\s*\{[^}]*background-color:\s*var\(--fab-seed-color-socket-surface\);[^}]*color:\s*var\(--fab-color-text\);/s,
    );
    // The lone locked sample spans the grid's second row — no orphaned cell.
    expect(css).toMatch(
      /\.template-shell__shop \.fab-shop-grid > \[data-fab-variant="locked"\]:last-child\s*\{[^}]*grid-column:\s*1 \/ -1;/s,
    );
  });
});

describe("settings page versus pause modal", () => {
  it("renders Settings as a non-modal full page with a header back action", async () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });
    expect(await controller.driveTo("settings")).toBe(true);
    shell.render();

    const page = shell.root.querySelector<HTMLElement>('[data-fab-instance="settings.page"]');
    expect(page).not.toBeNull();
    expect(page!.getAttribute("role")).toBe("region");
    expect(shell.root.querySelector("[aria-modal]")).toBeNull();
    expect(shell.root.querySelector(".fab-modal-scrim")).toBeNull();
    // The Settings title speaks the shared page-title grammar: the same
    // display-face centered title Shop uses, over the same header grid.
    const title = shell.root.querySelector<HTMLElement>('[data-fab-instance="settings.title"]');
    expect(title).not.toBeNull();
    expect(title!.classList.contains("template-shell__title")).toBe(true);
    expect(title!.classList.contains("template-shell__page-title")).toBe(true);
    const css = readFileSync(resolve(process.cwd(), "src/shell/template-shell.css"), "utf8");
    expect(css).toMatch(
      /\.template-shell__shop-header,\s*\.template-shell \.fab-page-header\s*\{[^}]*grid-template-columns:\s*var\(--fab-btn-min-size\) minmax\(0, 1fr\) var\(--fab-btn-min-size\);/s,
    );
    expect(
      shell.root.querySelector<HTMLElement>('[data-fab-instance="settings.back"]'),
    ).not.toBeNull();
    expect(shell.root.querySelectorAll("[data-fab-toggle-key]").length).toBe(3);
  });

  it("keeps Pause a compact modal dialog over visibly frozen gameplay", async () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });
    expect(await controller.driveTo("pause")).toBe(true);
    shell.render();

    const panel = shell.root.querySelector<HTMLElement>('[data-fab-instance="pause.panel"]');
    expect(panel).not.toBeNull();
    expect(panel!.closest(".fab-modal-card") ?? panel).toBe(panel);
    expect(shell.root.querySelector(".fab-modal-scrim")).not.toBeNull();
    expect(shell.root.querySelector('[data-template-backdrop="pause-level"]')).not.toBeNull();
    expect(shell.root.querySelector("[data-fab-toggle-key]")).toBeNull();
    const dialog = shell.root.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();

    // The quiet Home exit keeps a full-size hit target: the design-unit
    // minimum is pinned at 48px and explicitly encoded on the Home row.
    const home = shell.root.querySelector<HTMLButtonElement>('[data-fab-action="pause-quit"]');
    expect(home).not.toBeNull();
    expect(home!.classList.contains("fab-btn")).toBe(true);
    const tokens = readFileSync(resolve(process.cwd(), "design/tokens.css"), "utf8");
    expect(tokens).toMatch(/--fab-btn-min-size:\s*48px;/);
    const css = readFileSync(resolve(process.cwd(), "src/shell/template-shell.css"), "utf8");
    expect(css).toMatch(
      /\.template-shell \.fab-pause-card \[data-fab-action="pause-quit"\],\s*\.template-shell__overlay-action--tertiary\s*\{[^}]*min-height:\s*var\(--fab-btn-min-size\);/s,
    );
  });
});

describe("renderer-neutral evidence probe over the DOM shell", () => {
  it("reports state, action identity, revision, and readiness for the Shop", async () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });
    const probe = createShellEvidenceProbe({
      gameId: gameConfig.id,
      contractId: "shell-presentation-v2",
      rendererProfile: "dom-css",
      readers: {
        state: () => controller.snapshot().surface,
        revision: () => null,
        ready: () => shell.root.dataset.fabState === controller.snapshot().surface,
        viewport: () => readDomShellEvidenceViewport(window),
        actions: () => readDomShellEvidenceActions(shell.root),
      },
    });

    expect(await controller.driveTo("shop")).toBe(true);
    shell.render();
    await flushMicrotasks();

    const snapshot = probe.snapshot();
    expect(snapshot.state).toBe("shop");
    expect(snapshot.ready).toBe(true);
    expect(snapshot.revision).toBeNull();
    expect(snapshot.rendererProfile).toBe("dom-css");
    expect(snapshot.actions.map((action) => action.actionId)).toEqual(["back", "shop-restore"]);
    expect(snapshot.actions.map((action) => action.instanceId)).toEqual([
      "shop.back",
      "shop.restore",
    ]);
  });

  it("drives all seven declared states through the harness", async () => {
    const harness = createTemplateHarness({
      buildVersion: "test",
      packageId: `com.fabrikav2.${gameConfig.id}`,
    });
    for (const state of gameConfig.screens) {
      expect(await harness.driveTo!(state), state).toBe(true);
    }
  });
});
