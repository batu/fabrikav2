import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FakePurchaseProvider,
  IapService,
  type CatalogProduct,
  type CustomerInfoLike,
  type IapServiceDependencies,
  type StoreProduct,
} from '@fabrikav2/sdk/iap';
import { mountShopPage, type ShopCopy, type ShopSection } from './index.ts';

interface Grant {
  entitlement: boolean;
}

function product(over: Partial<CatalogProduct<Grant>> & { id: string; productId: string }): CatalogProduct<Grant> {
  return {
    title: over.id,
    description: over.id,
    kind: 'consumable',
    group: 'hints',
    tier: 0,
    badges: [],
    displayPrice: '$0.99',
    visible: true,
    payload: { entitlement: false },
    ...over,
  };
}

const CATALOG: CatalogProduct<Grant>[] = [
  product({ id: 'no-ads', productId: 'sku.noads', title: 'No Ads', description: 'Removes the ads.', kind: 'entitlement', group: 'entitlements', tier: 0, badges: ['best-value'], displayPrice: '$7.99', payload: { entitlement: true } }),
  product({ id: 'hint-25', productId: 'sku.hint25', title: '25 Hints', group: 'hints', tier: 0, displayPrice: '$3.99' }),
  product({ id: 'hint-10', productId: 'sku.hint10', title: '10 Hints', group: 'hints', tier: 1, displayPrice: '$1.99' }),
  product({ id: 'hidden', productId: 'sku.hidden', title: 'Hidden', group: 'hints', tier: 2, visible: false }),
  product({ id: 'fail-offer', productId: 'sku.fail', title: 'Fail Offer', group: 'failOffer', tier: 0, displayPrice: '$4.99' }),
];

function storeProduct(productId: string, priceString: string): StoreProduct {
  return { productId, title: productId, description: productId, price: 1, priceString, currencyCode: 'USD' };
}

const STORE_PRODUCTS: StoreProduct[] = [
  storeProduct('sku.noads', '$7.99'),
  storeProduct('sku.hint25', '$3.99'),
  storeProduct('sku.hint10', '$1.99'),
];

const SECTIONS: ShopSection[] = [
  { group: 'entitlements', layout: 'featured' },
  { group: 'hints', layout: 'grid', title: 'Hint Packs' },
];

const COPY: ShopCopy = {
  purchase: { pending: 'Purchasing…', busy: 'Please wait', unavailable: 'Unavailable' },
  restore: {
    title: 'Restore Purchases',
    status: {
      idle: 'Restore your purchases here.',
      initializing: 'The store is still loading.',
      busy: 'A store operation is running.',
      unavailable: 'Not available on this build.',
      pending: 'Checking your purchases now.',
      restored: 'Your purchases were restored.',
      empty: 'Nothing was found to restore.',
      failed: 'The restore attempt failed.',
    },
    button: { rest: 'Restore', pending: 'Restoring…', restored: 'Restored' },
  },
};

const BADGES = { 'best-value': 'Best Value' };

function customerInfo(ownedProductIds: string[]): CustomerInfoLike {
  return {
    allPurchasedProductIdentifiers: ownedProductIds,
    nonSubscriptionTransactions: [],
  };
}

function host(): HTMLElement {
  document.body.innerHTML = '<div id="host"></div>';
  return document.getElementById('host')!;
}

function baseDeps(provider: FakePurchaseProvider): IapServiceDependencies<Grant> {
  return {
    isNativePlatform: () => true,
    platform: () => 'android',
    apiKey: () => 'test_key',
    catalogProducts: () => CATALOG,
    provider: () => provider,
    operationTimeoutMs: () => 1000,
  };
}

async function readyService(
  config: ConstructorParameters<typeof FakePurchaseProvider>[0] = {},
): Promise<{ iap: IapService<Grant>; provider: FakePurchaseProvider }> {
  const provider = new FakePurchaseProvider({ products: STORE_PRODUCTS, ...config });
  const iap = new IapService<Grant>(baseDeps(provider));
  await iap.init();
  return { iap, provider };
}

function buttonFor(el: HTMLElement, catalogId: string): HTMLButtonElement {
  return el.querySelector<HTMLButtonElement>(`.fab-shop-purchase-btn[data-catalog-id="${catalogId}"]`)!;
}

function restoreControls(el: HTMLElement): { button: HTMLButtonElement; status: HTMLElement } {
  return {
    button: el.querySelector<HTMLButtonElement>('.fab-shop-restore-btn')!,
    status: el.querySelector<HTMLElement>('.fab-shop-restore-status')!,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mountShopPage — catalog-driven rendering', () => {
  it('renders one section per configured group, tier-ordered, filtering invisible + unlisted groups', async () => {
    const { iap } = await readyService();
    const { el } = mountShopPage({ mountInto: host(), iap, sections: SECTIONS, copy: COPY, badges: BADGES, id: 'shop' });

    const sections = el.querySelectorAll<HTMLElement>('.fab-shop-section');
    expect(Array.from(sections).map((s) => s.dataset.group)).toEqual(['entitlements', 'hints']);

    // failOffer group is not in SECTIONS → absent; the invisible 'hidden' product is filtered.
    const cardIds = Array.from(el.querySelectorAll<HTMLElement>('.fab-shop-card')).map((c) => c.dataset.catalogId);
    expect(cardIds).toEqual(['no-ads', 'hint-25', 'hint-10']); // hints sorted by tier (25 → 10)
    expect(el.querySelector('[data-catalog-id="fail-offer"]')).toBeNull();
    expect(el.querySelector('[data-catalog-id="hidden"]')).toBeNull();

    // Section layout + injected title.
    expect(el.querySelector('.fab-shop-section--featured')!.getAttribute('data-group')).toBe('entitlements');
    expect(el.querySelector('.fab-shop-section--grid .fab-shop-section-title')!.textContent).toBe('Hint Packs');

    // Injected badge copy, keyed off the catalog badge key.
    const badge = el.querySelector<HTMLElement>('.fab-shop-badge');
    expect(badge!.textContent).toBe('Best Value');
    expect(badge!.dataset.badgeKey).toBe('best-value');
  });

  it('resolves icons only through the injected resolveIcon (no baked asset paths)', async () => {
    const { iap } = await readyService();
    const { el } = mountShopPage({
      mountInto: host(),
      iap,
      sections: SECTIONS,
      copy: COPY,
      resolveIcon: (p) => (p.id === 'no-ads' ? 'noads-icon-src' : undefined),
      id: 'shop',
    });
    const icons = el.querySelectorAll<HTMLImageElement>('.fab-shop-card-icon img');
    expect(icons).toHaveLength(1);
    expect(icons[0].getAttribute('src')).toBe('noads-icon-src');
  });
});

describe('mountShopPage — purchase-button state (vs sdk/iap Fake provider)', () => {
  it('shows the live store price and enables the button when ready', async () => {
    const { iap } = await readyService();
    const { el } = mountShopPage({ mountInto: host(), iap, sections: SECTIONS, copy: COPY, id: 'shop' });
    const btn = buttonFor(el, 'no-ads');
    expect(btn.textContent).toBe('$7.99');
    expect(btn.disabled).toBe(false);
  });

  it('renders "Unavailable" + disabled when a product lacks store metadata', async () => {
    // Only no-ads has a store product; the hint packs have none → unavailable.
    const { iap } = await readyService({ products: [storeProduct('sku.noads', '$7.99')] });
    const { el } = mountShopPage({ mountInto: host(), iap, sections: SECTIONS, copy: COPY, id: 'shop' });
    const btn = buttonFor(el, 'hint-25');
    expect(btn.textContent).toBe('Unavailable');
    expect(btn.disabled).toBe(true);
  });

  it('reflects an in-flight purchase: the buying product shows pending, others show busy', async () => {
    const { iap } = await readyService({ hangingPurchaseProductIds: ['sku.noads'] });
    const { el } = mountShopPage({ mountInto: host(), iap, sections: SECTIONS, copy: COPY, id: 'shop' });

    buttonFor(el, 'no-ads').click();
    await Promise.resolve();

    expect(buttonFor(el, 'no-ads').textContent).toBe('Purchasing…');
    expect(buttonFor(el, 'no-ads').disabled).toBe(true);
    expect(buttonFor(el, 'hint-25').textContent).toBe('Please wait');
    expect(buttonFor(el, 'hint-25').disabled).toBe(true);
  });

  it('fires onPurchase with the settled result and re-enables buttons after', async () => {
    const onPurchase = vi.fn();
    const { iap } = await readyService({
      purchaseResults: {
        'sku.noads': { productIdentifier: 'sku.noads', transactionId: 't1', purchaseToken: null, customerInfo: customerInfo(['sku.noads']) },
      },
    });
    const { el } = mountShopPage({ mountInto: host(), iap, sections: SECTIONS, copy: COPY, onPurchase, id: 'shop' });

    buttonFor(el, 'no-ads').click();
    await vi.waitFor(() => expect(onPurchase).toHaveBeenCalledOnce());
    expect(onPurchase.mock.calls[0][0]).toMatchObject({ status: 'purchased', productId: 'sku.noads' });
    expect(buttonFor(el, 'no-ads').disabled).toBe(false);
    expect(buttonFor(el, 'no-ads').textContent).toBe('$7.99');
  });
});

describe('mountShopPage — restore flow (vs sdk/iap restore state machine)', () => {
  it('idle → restored when a restore recovers an entitlement', async () => {
    const onRestore = vi.fn();
    const { iap } = await readyService({ restoreCustomerInfo: customerInfo(['sku.noads']) });
    const { el } = mountShopPage({ mountInto: host(), iap, sections: SECTIONS, copy: COPY, onRestore, id: 'shop' });
    const { button, status } = restoreControls(el);

    expect(button.dataset.restoreState).toBe('idle');
    expect(status.textContent).toBe('Restore your purchases here.');

    button.click();
    await vi.waitFor(() => expect(button.dataset.restoreState).toBe('restored'));
    expect(status.textContent).toBe('Your purchases were restored.');
    expect(button.textContent).toBe('Restored');
    expect(button.disabled).toBe(true);
    expect(onRestore).toHaveBeenCalledOnce();
    expect(onRestore.mock.calls[0][0]).toMatchObject({ status: 'restored' });
  });

  it('idle → empty when a restore recovers nothing restorable', async () => {
    // Owns only a consumable SKU → no entitlement recovered.
    const { iap } = await readyService({ restoreCustomerInfo: customerInfo(['sku.hint10']) });
    const { el } = mountShopPage({ mountInto: host(), iap, sections: SECTIONS, copy: COPY, id: 'shop' });
    const { button, status } = restoreControls(el);

    button.click();
    await vi.waitFor(() => expect(button.dataset.restoreState).toBe('empty'));
    expect(status.textContent).toBe('Nothing was found to restore.');
    // 'empty' is terminal-but-retryable: the button is not permanently disabled.
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Restore');
  });

  it('idle → failed when the restore errors', async () => {
    const { iap } = await readyService({ restoreError: new Error('network down') });
    const { el } = mountShopPage({ mountInto: host(), iap, sections: SECTIONS, copy: COPY, id: 'shop' });
    const { button, status } = restoreControls(el);

    button.click();
    await vi.waitFor(() => expect(button.dataset.restoreState).toBe('failed'));
    expect(status.textContent).toBe('The restore attempt failed.');
    expect(button.disabled).toBe(false);
  });

  it('shows pending while the restore is in flight', async () => {
    const { iap } = await readyService({ hangRestore: true });
    const { el } = mountShopPage({ mountInto: host(), iap, sections: SECTIONS, copy: COPY, id: 'shop' });
    const { button, status } = restoreControls(el);

    button.click();
    await Promise.resolve();
    expect(button.dataset.restoreState).toBe('pending');
    expect(status.textContent).toBe('Checking your purchases now.');
    expect(button.textContent).toBe('Restoring…');
    expect(button.disabled).toBe(true);
    // Purchase buttons are locked during the native operation.
    expect(buttonFor(el, 'no-ads').disabled).toBe(true);
  });

  it('renders unavailable + blocks restore when the service is not ready', async () => {
    const provider = new FakePurchaseProvider({ products: STORE_PRODUCTS });
    const iap = new IapService<Grant>({ ...baseDeps(provider), platform: () => 'web' });
    await iap.init(); // → unsupported-platform, never ready

    const { el } = mountShopPage({ mountInto: host(), iap, sections: SECTIONS, copy: COPY, id: 'shop' });
    const { button, status } = restoreControls(el);
    expect(button.dataset.restoreState).toBe('unavailable');
    expect(status.textContent).toBe('Not available on this build.');
    expect(button.disabled).toBe(true);

    button.click();
    await Promise.resolve();
    expect(provider.restoreCalls).toBe(0); // guarded — no native restore attempted
  });

  it('picks up a late-settled restore result on the next refresh — no polling loop', async () => {
    // A restore that never settles within operationTimeoutMs returns unavailable/busy;
    // the native result lands later and is consumed on a consumer-driven refresh.
    const provider = new FakePurchaseProvider({ products: STORE_PRODUCTS, hangRestore: true });
    const iap = new IapService<Grant>({ ...baseDeps(provider), operationTimeoutMs: () => 5 });
    await iap.init();

    const handle = mountShopPage({ mountInto: host(), iap, sections: SECTIONS, copy: COPY, id: 'shop' });
    const { button } = restoreControls(handle.el);

    // Make the (now non-hanging) provider resolve to a restorable entitlement.
    provider.setConfig({ hangRestore: false, restoreCustomerInfo: customerInfo(['sku.noads']) });
    button.click();
    // The user-facing restore times out → busy while the native op settles.
    await vi.waitFor(() => expect(['busy', 'restored']).toContain(button.dataset.restoreState));

    // A consumer-driven refresh consumes the late result — no timer inside the component.
    await vi.waitFor(() => {
      handle.refresh();
      expect(button.dataset.restoreState).toBe('restored');
    });
  });
});

describe('mountShopPage — no polling loops remain (AC guardrail)', () => {
  it('the component source contains no setTimeout/setInterval timers', () => {
    // vitest runs with cwd = packages/ui (npm workspace).
    const src = readFileSync(resolve('src/ShopPage.ts'), 'utf8');
    expect(src).not.toMatch(/set(Timeout|Interval)/);
    expect(src).not.toMatch(/requestAnimationFrame/);
  });
});
