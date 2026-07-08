import { buildButtonElement } from './Button.ts';
import { createUiRoot, type ThemeTokens, type UiHandle } from './internal.ts';
import {
  canStartRestore,
  restoreResultToState,
  restoreStateForSnapshot,
  type CatalogProduct,
  type IapPurchaseResult,
  type IapRestoreResult,
  type IapService,
  type IapSnapshot,
  type RestoreState,
  type StoreProduct,
} from '@fabrikav2/sdk/iap';

/**
 * ShopPage — the store surface, generalized from Find The Dog's shop DOM
 * (READ-ONLY v1 `games/find_the_dog/src/ui/HUD.ts`:620-832 body/cards,
 * 1148-1203 purchase-button state, 964-1147 restore UI). It renders the pixels;
 * the STATE MACHINE it consumes lives in `@fabrikav2/sdk/iap` (the service +
 * `restore-machine`) — this component never reimplements the algebra, it maps
 * state → DOM.
 *
 * Two v1 idioms are deliberately shed:
 *  1. The 4× 250ms poll loops (research 07 R24/R33/R39/R47:
 *     `scheduleShopNativeOperationRefresh`, `scheduleRestoreControlRefresh`,
 *     `scheduleLateRestoreResultPoll`, and the idle/init refresh) collapse to ONE
 *     mechanism: {@link ShopPageHandle.refresh}. The component owns NO timer. Its
 *     own purchase/restore flows call `refresh()` when their promises settle; the
 *     consumer calls `refresh()` for any change it drives (init completing, a
 *     customerInfo update, a late-settling native restore). No polling loop.
 *  2. All copy, colors, and asset paths. Section headings, badge labels, restore
 *     copy, and purchase-button state labels are injected (UI guardrail #2);
 *     product title/description/price come from the injected catalog + store
 *     snapshot; icons resolve through an injected {@link ShopPageOptions.resolveIcon}.
 *
 * Sections are catalog-driven: each {@link ShopSection} names a catalog `group`
 * and a layout; products are filtered on `visible`, matched by `group`, and
 * ordered by `tier` (v1 implied order by array position; the schema made it
 * explicit). "Which group is featured vs a grid" is a per-game decision, so it is
 * injected — not baked.
 */

/** How a section lays its products out. `featured` = large hero cards (v1
 *  `renderFeaturedCard`); `grid` = compact tiles (v1 `renderGridCard`). */
export type ShopSectionLayout = 'featured' | 'grid';

export interface ShopSection {
  /** Catalog `group` key this section renders (e.g. 'entitlements', 'hints'). */
  group: string;
  layout: ShopSectionLayout;
  /** Injected heading copy. Omit for a heading-less section (v1 featured row). */
  title?: string;
}

/** Injected copy for the purchase button's non-purchasable states. The
 *  purchasable label is the live price string, so it is not injected here. */
export interface ShopPurchaseCopy {
  /** This product's purchase is the one in flight (v1 'Purchasing…'). */
  pending: string;
  /** A different native operation is in flight (v1 'Please wait'). */
  busy: string;
  /** Store not ready / product metadata missing (v1 'Unavailable'). */
  unavailable: string;
}

/** Injected copy the restore control maps its {@link RestoreState} to. */
export interface ShopRestoreCopy {
  /** Section heading for the restore panel (v1 'Restore Purchases'). */
  title: string;
  /** Status line per restore state — the SDK ships the state algebra, the UI
   *  supplies the words (restore-machine.ts deliberately omits copy). */
  status: Record<RestoreState, string>;
  /** Restore button label: resting (idle/most states), while pending, and once
   *  a restore has recovered something (v1 'Restore'/'Restoring…'/'Restored'). */
  button: { rest: string; pending: string; restored: string };
}

export interface ShopCopy {
  purchase: ShopPurchaseCopy;
  restore: ShopRestoreCopy;
}

export interface ShopPageOptions<TPayload = unknown> {
  mountInto: HTMLElement;
  /** The live service — the single source of truth for catalog + store state. */
  iap: IapService<TPayload>;
  /** Ordered section layout. Products in groups not listed here are omitted
   *  (v1 dropped the `failOffer` group from the shop page the same way). */
  sections: readonly ShopSection[];
  copy: ShopCopy;
  /** Badge KEY (from `product.badges`) → injected label. Keys with no mapping
   *  render no badge (can't invent baked copy). */
  badges?: Record<string, string>;
  /** Injected icon resolver — the catalog carries no asset paths, so a game that
   *  wants product art supplies it here. Returns undefined for no icon. */
  resolveIcon?: (product: CatalogProduct<TPayload>) => string | undefined;
  /** Side-effect hook after a purchase settles (grant, toast, analytics). The
   *  purchase-button state itself is derived from the service snapshot. */
  onPurchase?: (result: IapPurchaseResult) => void;
  /** Side-effect hook after a restore settles (apply the recovered entitlement,
   *  hide ads, toast). Whether the restore *recovered* an entitlement is derived
   *  from the catalog schema (`kind: 'entitlement'`), not from this callback. */
  onRestore?: (result: IapRestoreResult) => void;
  theme?: ThemeTokens;
  id?: string;
}

export interface ShopPageHandle extends UiHandle {
  /** The single refresh mechanism. Re-derives every button + the restore control
   *  from a fresh service snapshot (consuming any late-settled restore result).
   *  Idempotent; a no-op after dismissal. */
  refresh: () => void;
}

let nextShopId = 0;

function priceFor(product: CatalogProduct, storeProduct: StoreProduct | null): string {
  return storeProduct?.priceString ?? product.displayPrice;
}

/**
 * Purchase-button state — ported verbatim from v1 `applyShopPurchaseButtonState`
 * (HUD.ts:1148-1203), with the baked labels replaced by injected copy.
 */
function applyPurchaseButtonState(
  button: HTMLButtonElement,
  product: CatalogProduct,
  storeProduct: StoreProduct | null,
  snapshot: IapSnapshot,
  copy: ShopPurchaseCopy,
): void {
  const price = priceFor(product, storeProduct);
  const isPendingProduct = snapshot.pendingPurchaseProductIds.includes(product.productId);
  // v1 gated on `nativeOperationInProgress` (purchase OR restore), passed into the
  // `purchaseInProgress` slot of applyShopPurchaseButtonState — so any native op
  // locks every Buy button, not just a concurrent purchase.
  const canPurchase =
    snapshot.state === 'ready' && storeProduct !== null && !snapshot.nativeOperationInProgress;
  button.disabled = !canPurchase;
  button.dataset.canPurchase = String(canPurchase);
  const label = canPurchase
    ? price
    : isPendingProduct
      ? copy.pending
      : snapshot.nativeOperationInProgress
        ? copy.busy
        : copy.unavailable;
  button.textContent = label;
  button.setAttribute('aria-label', `${product.title} ${price} ${label}`);
}

export function mountShopPage<TPayload = unknown>(
  opts: ShopPageOptions<TPayload>,
): ShopPageHandle {
  const root = createUiRoot({
    mountInto: opts.mountInto,
    id: opts.id ?? `fab-shop-${++nextShopId}`,
    className: 'fab-ui fab-shop',
    theme: opts.theme,
  });
  if (root.reentrant) {
    const existing = root.handle;
    if ('refresh' in existing) return existing as ShopPageHandle;
    return { el: existing.el, dismiss: existing.dismiss, dismissed: existing.dismissed, refresh: () => {} };
  }

  const { el, signal } = root;
  const { iap } = opts;

  // Catalog-kind lookup for the restore "did it recover an entitlement?" derive —
  // schema-only (`kind`), never the opaque payload.
  const entitlementProductIds = new Set(
    iap.snapshot().products
      .filter((snap) => snap.product.kind === 'entitlement')
      .map((snap) => snap.product.productId),
  );

  // ---- Product sections (rebuilt each refresh, mirroring v1 replaceChildren) ----
  const productsRoot = document.createElement('div');
  productsRoot.className = 'fab-shop-products';
  el.appendChild(productsRoot);

  function buildBadges(product: CatalogProduct<TPayload>): HTMLElement[] {
    const badges: HTMLElement[] = [];
    for (const key of product.badges) {
      const label = opts.badges?.[key];
      if (label === undefined) continue;
      const badge = document.createElement('div');
      badge.className = 'fab-shop-badge';
      badge.dataset.badgeKey = key;
      badge.textContent = label;
      badges.push(badge);
    }
    return badges;
  }

  function buildIcon(product: CatalogProduct<TPayload>): HTMLElement | null {
    const src = opts.resolveIcon?.(product);
    if (src === undefined) return null;
    const iconEl = document.createElement('div');
    iconEl.className = 'fab-shop-card-icon';
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    iconEl.appendChild(img);
    return iconEl;
  }

  function buildPurchaseButton(
    product: CatalogProduct<TPayload>,
    storeProduct: StoreProduct | null,
    snapshot: IapSnapshot<TPayload>,
  ): HTMLButtonElement {
    const button = buildButtonElement({
      label: '',
      className: 'fab-shop-purchase-btn',
      onClick: () => {
        void runPurchase(product.productId);
      },
    });
    button.dataset.catalogId = product.id;
    applyPurchaseButtonState(button, product, storeProduct, snapshot, opts.copy.purchase);
    return button;
  }

  function buildCard(
    layout: ShopSectionLayout,
    product: CatalogProduct<TPayload>,
    storeProduct: StoreProduct | null,
    snapshot: IapSnapshot<TPayload>,
  ): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = `fab-shop-card-wrapper fab-shop-card-wrapper--${layout}`;

    const card = document.createElement('div');
    card.className = `fab-shop-card fab-shop-card--${layout}`;
    card.dataset.catalogId = product.id;
    card.dataset.group = product.group;

    const icon = buildIcon(product);
    if (icon !== null) card.appendChild(icon);

    const title = document.createElement('div');
    title.className = 'fab-shop-card-title';
    title.textContent = product.title;
    card.appendChild(title);

    const desc = document.createElement('div');
    desc.className = 'fab-shop-card-desc';
    desc.textContent = product.description;
    card.appendChild(desc);

    for (const badge of buildBadges(product)) wrapper.appendChild(badge);
    wrapper.appendChild(card);
    wrapper.appendChild(buildPurchaseButton(product, storeProduct, snapshot));
    return wrapper;
  }

  function renderProducts(snapshot: IapSnapshot<TPayload>): void {
    const storeByProductId = new Map(
      snapshot.products.map((snap) => [snap.product.productId, snap.storeProduct]),
    );
    const visibleByGroup = new Map<string, CatalogProduct<TPayload>[]>();
    for (const snap of snapshot.products) {
      if (!snap.product.visible) continue;
      const bucket = visibleByGroup.get(snap.product.group) ?? [];
      bucket.push(snap.product);
      visibleByGroup.set(snap.product.group, bucket);
    }

    const sectionEls: HTMLElement[] = [];
    for (const section of opts.sections) {
      const products = (visibleByGroup.get(section.group) ?? [])
        .slice()
        .sort((a, b) => a.tier - b.tier);
      if (products.length === 0) continue;

      const sectionEl = document.createElement('div');
      sectionEl.className = `fab-shop-section fab-shop-section--${section.layout}`;
      sectionEl.dataset.group = section.group;
      if (section.title !== undefined) {
        const heading = document.createElement('div');
        heading.className = 'fab-shop-section-title';
        heading.textContent = section.title;
        sectionEl.appendChild(heading);
      }
      const grid = document.createElement('div');
      grid.className = 'fab-shop-grid';
      for (const product of products) {
        grid.appendChild(
          buildCard(section.layout, product, storeByProductId.get(product.productId) ?? null, snapshot),
        );
      }
      sectionEl.appendChild(grid);
      sectionEls.push(sectionEl);
    }
    productsRoot.replaceChildren(...sectionEls);
  }

  // ---- Restore control (stable elements, updated in place) ----
  const restoreState = { current: 'idle' as RestoreState };
  let activeRestore: Promise<IapRestoreResult> | null = null;

  const restorePanel = document.createElement('div');
  restorePanel.className = 'fab-shop-restore';

  const restoreCopyBox = document.createElement('div');
  restoreCopyBox.className = 'fab-shop-restore-copy';
  const restoreTitle = document.createElement('strong');
  restoreTitle.className = 'fab-shop-restore-title';
  restoreTitle.textContent = opts.copy.restore.title;
  const restoreStatus = document.createElement('small');
  restoreStatus.className = 'fab-shop-restore-status';
  restoreCopyBox.appendChild(restoreTitle);
  restoreCopyBox.appendChild(restoreStatus);

  const restoreButton = buildButtonElement({
    label: opts.copy.restore.button.rest,
    className: 'fab-shop-restore-btn',
    // Stable hook so SharedShellDriver drives restore via a real click.
    dataAction: 'shop-restore',
    onClick: () => {
      void runRestore();
    },
  });

  restorePanel.appendChild(restoreCopyBox);
  restorePanel.appendChild(restoreButton);
  el.appendChild(restorePanel);

  function restoreButtonLabel(state: RestoreState): string {
    if (state === 'pending') return opts.copy.restore.button.pending;
    if (state === 'restored') return opts.copy.restore.button.restored;
    return opts.copy.restore.button.rest;
  }

  function renderRestore(snapshot: IapSnapshot<TPayload>): void {
    const state = restoreState.current;
    restoreStatus.textContent = opts.copy.restore.status[state];
    restoreStatus.dataset.restoreState = state;
    restoreButton.dataset.restoreState = state;
    restoreButton.textContent = restoreButtonLabel(state);
    restoreButton.disabled =
      snapshot.nativeOperationInProgress ||
      state === 'pending' ||
      state === 'restored' ||
      state === 'initializing' ||
      state === 'busy' ||
      state === 'unavailable';
  }

  function recoveredEntitlement(result: IapRestoreResult): boolean {
    if (result.status !== 'restored') return false;
    return result.ownedProductIds.some((productId) => entitlementProductIds.has(productId));
  }

  // ---- The one refresh mechanism ----
  function refresh(): void {
    if (signal.aborted) return;
    const snapshot = iap.snapshot();
    if (activeRestore !== null) {
      // A user-started restore is in flight → pending (sticky against a stray
      // `ready` snapshot). Do NOT consume a completed result mid-flight.
      restoreState.current = restoreStateForSnapshot(snapshot, restoreState.current, true);
    } else {
      // Late-settle path: a native restore that returned after the user-facing
      // timeout parks its result on the service. Pick it up here — no poll.
      const completed = iap.consumeCompletedRestoreResult();
      if (completed !== null) {
        restoreState.current = restoreResultToState({
          status: completed.status,
          grantedEntitlement: recoveredEntitlement(completed),
          nativeOperationInProgress: snapshot.nativeOperationInProgress,
        });
        opts.onRestore?.(completed);
      } else {
        restoreState.current = restoreStateForSnapshot(snapshot, restoreState.current, false);
      }
    }
    renderProducts(snapshot);
    renderRestore(snapshot);
  }

  async function runPurchase(productId: string): Promise<void> {
    if (signal.aborted) return;
    // `purchase()` sets its in-progress flag synchronously before awaiting the
    // provider, so refreshing on the returned promise (pre-await) reflects the
    // busy state without a timer.
    const pending = iap.purchase(productId);
    refresh();
    const result = await pending;
    if (signal.aborted) return;
    opts.onPurchase?.(result);
    refresh();
  }

  async function runRestore(): Promise<void> {
    if (signal.aborted) return;
    if (activeRestore !== null) return;
    if (!canStartRestore(iap.snapshot(), restoreState.current)) return;

    restoreState.current = 'pending';
    activeRestore = iap.restore();
    refresh();
    let result: IapRestoreResult;
    try {
      result = await activeRestore;
    } finally {
      activeRestore = null;
    }
    if (signal.aborted) return;
    opts.onRestore?.(result);
    restoreState.current = restoreResultToState({
      status: result.status,
      grantedEntitlement: recoveredEntitlement(result),
      nativeOperationInProgress: iap.snapshot().nativeOperationInProgress,
    });
    refresh();
  }

  const handle: ShopPageHandle = { el, dismiss: root.close, dismissed: root.dismissed, refresh };
  root.finalize(handle);
  refresh();
  return handle;
}
