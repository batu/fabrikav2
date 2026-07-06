import { prefersReducedMotion, retriggerCssAnimation } from './motion.ts';

/**
 * Economy-transfer coin-fly, ported from FTD
 * `games/find_the_dog/src/ui/EconomyTransfer.ts` (301 lines — the canonical copy;
 * marble_run's `animateCoinToken` is a stripped duplicate that "dies", research
 * 04 claim 8). rAF-driven quadratic-Bézier flight of N tokens from a source
 * anchor to a target anchor, staggered, with a synchronized count-up and
 * MutationObserver cancellation when either endpoint leaves the DOM.
 *
 * De-hardcoded vs v1 for the DOM-only `ui` package (brainstorm D1/D2, S3):
 *  - the token glyph URL is injected as `tokenImage` — no `TOKEN_IMAGE_BY_KIND`
 *    asset-path map;
 *  - the landing-target selector list is injected as `targets` — the v1
 *    convenience wrappers (`animateCoinsToBalance`/`animateHintsToBalance`) with
 *    their literal `#coin-pill`/`#hint-btn` arrays stay with the consumer;
 *  - the two anchor data-attributes are namespaced under `fab-`:
 *      `data-fab-economy-target="<kind>"` marks a container eligible as a landing
 *        target; `data-fab-economy-anchor="<kind>"` marks the precise glyph within
 *        it to fly toward. Both roles are kept — collapsing them would lose the
 *        sub-element precision the Bézier endpoint needs;
 *  - the `FAST_E2E_UI` `import.meta.env` branch is replaced by optional
 *    `durationMs`/`staggerMs` motion overrides (also the unit-test fast path);
 *  - reduced-motion and the target-bump reflow reuse the shared `motion.ts` utils.
 */

export type EconomyTransferKind = 'coin' | 'hint';

export interface EconomyTransferOptions {
  /** Selects the token CSS modifier + the count heuristic; NOT asset resolution. */
  kind: EconomyTransferKind;
  amount: number;
  /** Injected glyph URL painted as the token's background image. */
  tokenImage: string;
  source: Element | null;
  /** Injected landing-target selector list, tried in order. */
  targets: readonly string[];
  owner?: Element | null;
  countElement?: HTMLElement | null;
  fromValue?: number;
  toValue?: number;
  tokenMultiplier?: number;
  reducedMotion?: boolean;
  /** Parent of the fixed-position flight layer. Defaults to `document.body`. */
  mountInto?: HTMLElement;
  /** Override the per-token flight duration (also the unit-test fast path). */
  durationMs?: number;
  /** Override the inter-token launch stagger. */
  staggerMs?: number;
}

// ---- Motion tuning constants (named, not magic literals — brainstorm §4). ----
const TRANSFER_DURATION_MS = 760;
const STAGGER_MS = 42;
const TARGET_BUMP_MS = 520;
/** Cubic ease-out exponent shared by the flight curve and the count-up. */
const EASE_EXPONENT = 3;
/** Horizontal wander of the Bézier control point, ± half this. */
const DRIFT_PX = 84;
/** Arc height of the control point above the higher endpoint. */
const LIFT_BASE_PX = 88;
const LIFT_JITTER_PX = 74;
/** Token scale envelope: pop in, then settle slightly smaller. */
const SCALE_START = 0.65;
const SCALE_POP_RATE = 2.2;
const SCALE_POP_UNTIL = 0.18;
const SCALE_SETTLE = 0.25;
const SPIN_DEGREES = 240;
/** Opacity holds full until this progress, then fades over the remainder. */
const FADE_START = 0.88;
// ---- Token-count heuristic bounds (v1 L89-95). ----
const HINT_TOKEN_MIN = 3;
const HINT_TOKEN_MAX = 8;
const HINT_TOKENS_PER_AMOUNT = 3;
const COIN_TOKEN_MIN = 6;
const COIN_TOKEN_MAX = 12;
const COIN_AMOUNT_PER_TOKEN = 6;
const COIN_TOKEN_HARD_MAX = 36;

const FLIGHT_LAYER_ID = 'fab-economy-transfer-layer';

let nextCountToken = 0;

interface Point {
  x: number;
  y: number;
}

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

function visibleCenter(element: Element | null): Point | null {
  if (element === null) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function visibleTransferAnchor(element: Element | null, kind: EconomyTransferKind): Point | null {
  if (element === null) return null;
  if (element instanceof HTMLImageElement) return visibleCenter(element);

  for (const selector of [`[data-fab-economy-anchor="${kind}"]`, 'img']) {
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
  if (kind === 'hint') {
    return Math.min(HINT_TOKEN_MAX, Math.max(HINT_TOKEN_MIN, amount * HINT_TOKENS_PER_AMOUNT));
  }
  const baseCount = Math.min(
    COIN_TOKEN_MAX,
    Math.max(COIN_TOKEN_MIN, Math.ceil(amount / COIN_AMOUNT_PER_TOKEN)),
  );
  return Math.min(COIN_TOKEN_HARD_MAX, Math.max(baseCount, Math.round(baseCount * multiplier)));
}

function animateCount(element: HTMLElement, from: number, to: number, durationMs: number): void {
  nextCountToken += 1;
  const token = String(nextCountToken);
  element.dataset.fabEconomyCountToken = token;

  if (from === to || durationMs <= 0) {
    element.textContent = String(to);
    return;
  }

  const startedAt = performance.now();
  const step = (now: number): void => {
    if (!element.isConnected || element.dataset.fabEconomyCountToken !== token) return;
    const progress = Math.min(1, (now - startedAt) / durationMs);
    const eased = 1 - Math.pow(1 - progress, EASE_EXPONENT);
    element.textContent = String(Math.round(from + (to - from) * eased));
    if (progress < 1) window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
}

function ensureLayer(parent: HTMLElement): HTMLElement {
  const existing = document.getElementById(FLIGHT_LAYER_ID);
  if (existing instanceof HTMLElement) return existing;

  const layer = document.createElement('div');
  layer.id = FLIGHT_LAYER_ID;
  layer.className = 'fab-ui fab-economy-layer';
  parent.appendChild(layer);
  return layer;
}

function animateToken(
  controller: TransferController,
  layer: HTMLElement,
  kind: EconomyTransferKind,
  tokenImage: string,
  durationMs: number,
  start: Point,
  end: Point,
  delayMs: number,
  isLive: () => boolean,
): Promise<void> {
  const drift = (Math.random() - 0.5) * DRIFT_PX;
  const lift = LIFT_BASE_PX + Math.random() * LIFT_JITTER_PX;
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
        token.className = `fab-economy-token fab-economy-token--${kind}`;
        token.style.backgroundImage = `url("${tokenImage}")`;
        token.style.transform = `translate3d(${start.x}px, ${start.y}px, 0) translate(-50%, -50%) scale(${SCALE_START})`;
        layer.appendChild(token);
        controller.tokens.add(token);
        startedAt = now;
      }

      if (!token.isConnected) {
        finish();
        return;
      }

      const raw = Math.min(1, (now - startedAt) / durationMs);
      const t = 1 - Math.pow(1 - raw, EASE_EXPONENT);
      const inv = 1 - t;
      const x = inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x;
      const y = inv * inv * start.y + 2 * inv * t * control.y + t * t * end.y;
      const scale = raw < SCALE_POP_UNTIL ? SCALE_START + raw * SCALE_POP_RATE : 1 - t * SCALE_SETTLE;
      token.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${scale}) rotate(${Math.round(t * SPIN_DEGREES)}deg)`;
      token.style.opacity = raw < FADE_START ? '1' : String(Math.max(0, (1 - raw) / (1 - FADE_START)));

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
  retriggerCssAnimation(target, 'fab-economy-target-bump');
  window.setTimeout(() => target.classList.remove('fab-economy-target-bump'), TARGET_BUMP_MS);
}

export function animateEconomyTransfer(options: EconomyTransferOptions): Promise<void> {
  const amount = Math.max(0, Math.floor(options.amount));
  const target = firstVisibleTarget(options.targets);
  if (amount === 0 || target === null) return Promise.resolve();

  const targetCenter = visibleTransferAnchor(target, options.kind);
  if (targetCenter === null) return Promise.resolve();

  const sourceCenter = visibleTransferAnchor(options.source, options.kind) ?? {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  };
  const durationMs = options.durationMs ?? TRANSFER_DURATION_MS;
  const staggerMs = options.staggerMs ?? STAGGER_MS;
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion();

  if (options.countElement && options.fromValue !== undefined && options.toValue !== undefined) {
    animateCount(options.countElement, options.fromValue, options.toValue, reducedMotion ? 0 : durationMs);
  }

  if (reducedMotion) {
    return Promise.resolve();
  }

  const layer = ensureLayer(options.mountInto ?? document.body);
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
    tasks.push(
      animateToken(
        controller,
        layer,
        options.kind,
        options.tokenImage,
        durationMs,
        sourceCenter,
        targetCenter,
        index * staggerMs,
        isLive,
      ),
    );
  }

  return Promise.all(tasks).then(() => {
    observer.disconnect();
    controller.cancelCallbacks.clear();
    if (isLive()) bumpTarget(target);
  });
}
