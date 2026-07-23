type EconomyTransferKind = 'coin' | 'hint';

interface EconomyTransferOptions {
  kind: EconomyTransferKind;
  amount: number;
  source: Element | null;
  targets: readonly string[];
  owner?: Element | null;
  countElement?: HTMLElement | null;
  fromValue?: number;
  toValue?: number;
  countdownElement?: HTMLElement | null;
  countdownFromValue?: number;
  countdownToValue?: number;
  tokenMultiplier?: number;
  reducedMotion?: boolean;
}

const TOKEN_IMAGE_BY_KIND: Record<EconomyTransferKind, string> = {
  coin: '/ui/menu-icons/icon_coin.png',
  hint: '/ui/menu-icons/icon_hint_magnifier.png',
};

const FAST_E2E_UI = String(import.meta.env.VITE_FTD_FAST_E2E_UI) === 'true';
const TRANSFER_DURATION_MS = FAST_E2E_UI ? 80 : 760;
const STAGGER_MS = FAST_E2E_UI ? 0 : 42;
let nextCountToken = 0;

interface TransferController {
  cancelled: boolean;
  timeoutIds: Set<number>;
  frameIds: Set<number>;
  tokens: Set<HTMLElement>;
  cancelCallbacks: Set<() => void>;
  cancel: () => void;
}

function createTransferController(): TransferController {
  const controller: TransferController = {
    cancelled: false,
    timeoutIds: new Set<number>(),
    frameIds: new Set<number>(),
    tokens: new Set<HTMLElement>(),
    cancelCallbacks: new Set<() => void>(),
    cancel: (): void => {
      if (controller.cancelled) return;
      controller.cancelled = true;
      for (const id of controller.timeoutIds) window.clearTimeout(id);
      for (const id of controller.frameIds) window.cancelAnimationFrame(id);
      controller.timeoutIds.clear();
      controller.frameIds.clear();
      for (const callback of Array.from(controller.cancelCallbacks)) callback();
      for (const token of controller.tokens) token.remove();
      controller.tokens.clear();
    },
  };

  return controller;
}

function visibleCenter(element: Element | null): { x: number; y: number } | null {
  if (element === null) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function visibleTransferAnchor(element: Element | null, kind: EconomyTransferKind): { x: number; y: number } | null {
  if (element === null) return null;
  if (element instanceof HTMLImageElement) return visibleCenter(element);

  for (const selector of [`[data-economy-anchor="${kind}"]`, 'img']) {
    const anchor = element.querySelector(selector);
    const center = visibleCenter(anchor);
    if (center !== null) return center;
  }

  return visibleCenter(element);
}

function firstVisibleTarget(selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector);
    if (visibleCenter(element) !== null) return element;
  }
  return null;
}

function tokenCount(kind: EconomyTransferKind, amount: number, multiplier: number): number {
  if (amount <= 0) return 0;
  if (FAST_E2E_UI) return 1;
  if (kind === 'hint') return Math.min(8, Math.max(3, amount * 3));
  const baseCount = Math.min(12, Math.max(6, Math.ceil(amount / 6)));
  return Math.min(36, Math.max(baseCount, Math.round(baseCount * multiplier)));
}

function animateCount(
  element: HTMLElement,
  from: number,
  to: number,
  durationMs: number,
  formatValue: (value: number) => string = String,
): void {
  nextCountToken += 1;
  const token = String(nextCountToken);
  element.dataset.economyCountToken = token;

  if (from === to || durationMs <= 0) {
    element.textContent = formatValue(to);
    return;
  }

  const startedAt = performance.now();
  const step = (now: number): void => {
    if (!element.isConnected || element.dataset.economyCountToken !== token) return;
    const progress = Math.min(1, (now - startedAt) / durationMs);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = formatValue(Math.round(from + (to - from) * eased));
    if (progress < 1) window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
}

function ensureLayer(): HTMLElement {
  let layer = document.getElementById('economy-transfer-layer');
  if (layer instanceof HTMLElement) return layer;

  layer = document.createElement('div');
  layer.id = 'economy-transfer-layer';
  document.body.appendChild(layer);
  return layer;
}

function animateToken(
  controller: TransferController,
  layer: HTMLElement,
  kind: EconomyTransferKind,
  start: { x: number; y: number },
  end: { x: number; y: number },
  delayMs: number,
  isLive: () => boolean,
): Promise<void> {
  const drift = (Math.random() - 0.5) * 84;
  const lift = 88 + Math.random() * 74;
  const control = {
    x: (start.x + end.x) / 2 + drift,
    y: Math.min(start.y, end.y) - lift,
  };

  return new Promise((resolve) => {
    let token: HTMLElement | null = null;
    let timeoutId: number | null = null;
    let frameId: number | null = null;
    let startedAt = 0;
    let resolved = false;

    const finish = (): void => {
      if (resolved) return;
      resolved = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        controller.timeoutIds.delete(timeoutId);
        timeoutId = null;
      }
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        controller.frameIds.delete(frameId);
        frameId = null;
      }
      if (token !== null) {
        token.remove();
        controller.tokens.delete(token);
        token = null;
      }
      controller.cancelCallbacks.delete(finish);
      resolve();
    };

    const requestNextFrame = (): void => {
      frameId = window.requestAnimationFrame((now: number): void => {
        if (frameId !== null) controller.frameIds.delete(frameId);
        frameId = null;
        step(now);
      });
      controller.frameIds.add(frameId);
    };

    const step = (now: number): void => {
      if (controller.cancelled || !isLive()) {
        finish();
        return;
      }

      if (token === null) {
        token = document.createElement('span');
        token.className = `economy-transfer-token ${kind}`;
        token.style.backgroundImage = `url("${TOKEN_IMAGE_BY_KIND[kind]}")`;
        token.style.transform = `translate3d(${start.x}px, ${start.y}px, 0) translate(-50%, -50%) scale(0.65)`;
        layer.appendChild(token);
        controller.tokens.add(token);
        startedAt = now;
      }

      if (!token.isConnected) {
        finish();
        return;
      }

      const raw = Math.min(1, (now - startedAt) / TRANSFER_DURATION_MS);
      const t = 1 - Math.pow(1 - raw, 3);
      const inv = 1 - t;
      const x = inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x;
      const y = inv * inv * start.y + 2 * inv * t * control.y + t * t * end.y;
      const scale = raw < 0.18 ? 0.65 + raw * 2.2 : 1 - t * 0.25;
      token.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${scale}) rotate(${Math.round(t * 240)}deg)`;
      token.style.opacity = raw < 0.88 ? '1' : String(Math.max(0, (1 - raw) / 0.12));

      if (raw < 1) {
        requestNextFrame();
        return;
      }
      finish();
    };

    controller.cancelCallbacks.add(finish);
    timeoutId = window.setTimeout((): void => {
      if (timeoutId !== null) controller.timeoutIds.delete(timeoutId);
      timeoutId = null;
      if (controller.cancelled || !isLive()) {
        finish();
        return;
      }
      requestNextFrame();
    }, delayMs);
    controller.timeoutIds.add(timeoutId);
  });
}

function bumpTarget(target: HTMLElement): void {
  target.classList.remove('economy-transfer-target-bump');
  void target.offsetWidth;
  target.classList.add('economy-transfer-target-bump');
  window.setTimeout(() => target.classList.remove('economy-transfer-target-bump'), 520);
}

function animateFtdEconomyTransfer(options: EconomyTransferOptions): Promise<void> {
  const amount = Math.max(0, Math.floor(options.amount));
  const target = firstVisibleTarget(options.targets);
  if (amount === 0 || target === null) return Promise.resolve();

  const targetCenter = visibleTransferAnchor(target, options.kind);
  if (targetCenter === null) return Promise.resolve();

  const sourceCenter = visibleTransferAnchor(options.source, options.kind) ?? {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  };
  const reducedMotion = options.reducedMotion ?? (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

  if (options.countElement && options.fromValue !== undefined && options.toValue !== undefined) {
    animateCount(options.countElement, options.fromValue, options.toValue, reducedMotion ? 0 : TRANSFER_DURATION_MS);
  }
  if (
    options.countdownElement
    && options.countdownFromValue !== undefined
    && options.countdownToValue !== undefined
  ) {
    animateCount(
      options.countdownElement,
      options.countdownFromValue,
      options.countdownToValue,
      reducedMotion ? 0 : TRANSFER_DURATION_MS,
      (value) => value === 0 ? '0' : `+${value}`,
    );
  }

  if (reducedMotion) {
    return Promise.resolve();
  }

  const layer = ensureLayer();
  const count = tokenCount(options.kind, amount, Math.max(1, options.tokenMultiplier ?? 1));
  const owner = options.owner ?? options.source;
  const controller = createTransferController();
  const isLive = (): boolean => {
    return !controller.cancelled && target.isConnected && (owner === null || owner === undefined || owner.isConnected);
  };
  const observer = new MutationObserver((): void => {
    if (!isLive()) controller.cancel();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const tasks: Promise<void>[] = [];
  for (let index = 0; index < count; index += 1) {
    tasks.push(animateToken(controller, layer, options.kind, sourceCenter, targetCenter, index * STAGGER_MS, isLive));
  }

  return Promise.all(tasks).then(() => {
    observer.disconnect();
    controller.cancelCallbacks.clear();
    if (isLive()) bumpTarget(target);
  });
}

export function animateCoinsToBalance(options: Omit<EconomyTransferOptions, 'kind' | 'targets'>): Promise<void> {
  return animateFtdEconomyTransfer({
    ...options,
    kind: 'coin',
    targets: ['.fab-complete-balance', '#coin-pill', '#completion-coin-target', '#completion-coin-target-count', '.home-coin-pill'],
  });
}

export function animateHintsToBalance(options: Omit<EconomyTransferOptions, 'kind' | 'targets'>): Promise<void> {
  return animateFtdEconomyTransfer({
    ...options,
    kind: 'hint',
    targets: ['#hint-btn', '[data-economy-target="hints"]', '.home-hint-pill'],
  });
}
