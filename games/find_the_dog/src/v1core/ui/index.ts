/**
 * ../v1core/ui — vanilla-DOM UI component library (A-UI0 keystone).
 *
 * Components are framework-agnostic render functions: `(opts) => UiHandle`. They
 * take the slot-quartet — `theme` (CSS-variable tokens), `content` (copy + asset
 * URLs), `actions` (callbacks), and (when stateful) injected read-model state —
 * and never import game state, audio, platform, or `import.meta.env`. Theming is
 * CSS custom properties (`--fab-*`) scoped to a `.fab-ui` root; the base styles
 * ship in `./ui.css`. See packages/core/src/ui/README.md for the contract.
 *
 * Subpath export ONLY (`../v1core/ui`); never re-exported from the top-level
 * barrel, so logic-only tests don't drag DOM/CSS code into their graph.
 */

import { buildV1ButtonElement } from './Button';
import { mountV1Modal } from './Modal';
import { createUiRoot, type ThemeTokens, type UiHandle } from './internal';
export { type ThemeTokens, type UiHandle } from './internal';
export { mountV1Button, type ButtonHandle, type ButtonOptions, type ButtonVariant } from './Button';
export { mountV1Modal, type ModalAction, type ModalOptions } from './Modal';
export {
  mountTransitionCover,
  type TransitionCoverContent,
  type TransitionCoverHandle,
  type TransitionCoverOptions,
} from './TransitionCover';
export { mountHudFrame, type HudFrameOptions } from './HudFrame';

// --- RatePrompt --------------------------------------------------------------
// The slot-quartet specialized for the rate-me prompt. It is stateless beyond
// open/dismissed, so it uses theme + content + actions (no `state` slot).

export interface RatePromptContent {
  title: string;
  subtitle: string;
  acceptLabel: string;
  declineLabel: string;
}

export interface RatePromptActions {
  /** Player accepted — the consumer opens the store and records the decision. */
  onAccept: () => void;
  /** Player declined — the consumer records the decision. */
  onDecline: () => void;
  /** Optional feedback on any button press (e.g. a tap sound). */
  onInteract?: () => void;
}

export interface RatePromptOptions {
  /** Element to append the prompt into (e.g. the game's overlay root). */
  mountInto: HTMLElement;
  content: RatePromptContent;
  actions: RatePromptActions;
  /** Token overrides applied to the prompt root. */
  theme?: ThemeTokens;
  /** Root element id; also the re-entrancy key. Defaults to 'fab-rate-prompt'. */
  id?: string;
}

/**
 * Mount a one-shot rate-me prompt. Returns a {@link UiHandle}; `dismiss()` (and
 * either button) removes the DOM and resolves `dismissed`. Re-entrant: if a
 * prompt with the same `id` is already mounted, returns that live prompt's
 * handle (so `dismiss()` and `dismissed` act on the real instance), without
 * mounting a second one.
 *
 * Pure DOM — no game-state / audio / platform / env coupling; the consumer
 * supplies copy via `content`, side effects via `actions`, look via `theme`.
 */
export function mountRatePrompt(opts: RatePromptOptions): UiHandle {
  const subtitle = document.createElement('p');
  subtitle.className = 'fab-modal-subtitle';
  subtitle.textContent = opts.content.subtitle;

  const actions = document.createElement('div');
  actions.className = 'fab-modal-actions';
  actions.append(
    buildV1ButtonElement({
      label: opts.content.acceptLabel,
      onClick: () => {
        opts.actions.onInteract?.();
        opts.actions.onAccept();
        handle.dismiss();
      },
      variant: 'primary',
      dataAction: 'accept',
    }),
    buildV1ButtonElement({
      label: opts.content.declineLabel,
      onClick: () => {
        opts.actions.onInteract?.();
        opts.actions.onDecline();
        handle.dismiss();
      },
      variant: 'secondary',
      dataAction: 'decline',
    }),
  );

  const handle = mountV1Modal({
    mountInto: opts.mountInto,
    id: opts.id ?? 'fab-rate-prompt',
    title: opts.content.title,
    body: subtitle,
    actions,
    theme: opts.theme,
    cardClassName: 'fab-rate-card',
  });
  return handle;
}

// --- LevelMap ----------------------------------------------------------------
// The level-map rail: a vertical, zig-zagging column of level nodes that fades
// into the distance, scales up the current node, and shows per-node state. The
// core owns PLACEMENT (zig-zag by position, depth-fade + scale by distance from
// current, current scale-up, state art, the path line, the loading variant) and
// click dispatch. The game owns windowing policy + level data + state mapping —
// it hands core an already-windowed node list. First component using the `state`
// slot. (In-place `update()` is intentionally NOT here: the only consumer, FTD's
// HomeScene, rebuilds its whole overlay per render and re-mounts; granular
// patching is deferred to the first component that needs it.)

export type LevelNodeState = 'current' | 'locked' | 'completed';

export interface LevelMapNode {
  /** Opaque game id echoed back by onSelectLevel (e.g. a level index). */
  id: string | number;
  /** Short text shown in the node (e.g. the level number). */
  label: string;
  /** Accessible name for the node's button. */
  name: string;
  state: LevelNodeState;
}

/** Injected read-model: the already-windowed nodes in display order (top→bottom),
 *  with exactly one marked `current`. Empty → the loading placeholder rail. */
export interface LevelMapState {
  nodes: readonly LevelMapNode[];
}

export interface LevelMapActions {
  /** Fired on any node click with that node's `id`; the game gates/navigates. */
  onSelectLevel: (id: string | number) => void;
}

export interface LevelMapOptions {
  mountInto: HTMLElement;
  state: LevelMapState;
  actions: LevelMapActions;
  theme?: ThemeTokens;
  /** Root element id (re-entrancy key). Defaults to 'fab-level-map'. */
  id?: string;
}

// far at distance >= 3, distant at >= 4 from the current node (matches the
// source rail's depth thresholds).
const DEPTH_FAR = 3;
const DEPTH_DISTANT = 4;

// Build the rail as DOM (not an innerHTML template): node `name`/`id`/`label`
// are consumer-supplied data, set via setAttribute/textContent — never
// interpolated into markup (matches mountRatePrompt's "content is data" rule and
// is injection-safe even if a game's level names carry quotes/`<`). `state` and
// the computed depth are typed/derived, so the className is safe.
function buildRail(state: LevelMapState): HTMLElement {
  const path = document.createElement('div');
  path.className = 'fab-levelmap-path';

  if (state.nodes.length === 0) {
    // Loading placeholder rail (mirrors the source 3-dot loading state).
    path.dataset.loading = 'true';
    path.setAttribute('aria-label', 'Loading levels');
    for (let i = 0; i < 3; i += 1) {
      const dot = document.createElement('div');
      dot.className = i === 2 ? 'fab-levelmap-loading-node current' : 'fab-levelmap-loading-node';
      path.appendChild(dot);
    }
    return path;
  }

  const currentPos = state.nodes.findIndex((n) => n.state === 'current');
  state.nodes.forEach((node, i) => {
    const distance = currentPos < 0 ? 0 : currentPos - i; // positive = ahead of current
    const depth = distance >= DEPTH_DISTANT ? ' distant' : distance >= DEPTH_FAR ? ' far' : '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `fab-levelmap-node ${node.state}${depth}`;
    btn.dataset.fabNodeIndex = String(i);
    btn.dataset.fabNodeId = String(node.id);
    btn.setAttribute('aria-label', node.name);
    const dot = document.createElement('span');
    dot.className = 'fab-levelmap-node-dot';
    dot.textContent = node.label;
    btn.appendChild(dot);
    path.appendChild(btn);
  });
  return path;
}

/**
 * Mount the level-map rail. Returns a {@link UiHandle}. Renders the given
 * (pre-windowed) nodes with zig-zag placement, depth-fade by distance from the
 * current node, current scale-up, and per-node state art — all themeable via
 * `--fab-levelmap-*` tokens. Clicking a node fires `onSelectLevel(node.id)`.
 *
 * Pure DOM — no game-state / env coupling.
 */
export function mountLevelMap(opts: LevelMapOptions): UiHandle {
  const root = createUiRoot({
    mountInto: opts.mountInto,
    id: opts.id ?? 'fab-level-map',
    className: 'fab-ui fab-levelmap',
    theme: opts.theme,
  });
  if (root.reentrant) return root.handle;
  const { el } = root;

  el.appendChild(buildRail(opts.state));

  el.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLElement>('.fab-levelmap-node');
    if (!btn) return;
    const i = Number(btn.dataset.fabNodeIndex);
    const node = Number.isInteger(i) ? opts.state.nodes[i] : undefined;
    if (node) opts.actions.onSelectLevel(node.id);
  });

  return root.finalize();
}

// --- LevelComplete -----------------------------------------------------------
// The "you won → here's your reward → continue" celebration. Core owns the
// PRESENTATION + SEQUENCING (entrance, side-confetti, reward-reveal lifecycle,
// reward-zone earned-counter drain, balance pill, button hierarchy + their
// reveal/disable/hide choreography, rotating messages, reduced-motion). The game
// injects MEANING via async callbacks: the coin-fly (`onClaim`), the rewarded-ad
// grant (`onClaimDouble`), the level advance (`onNext`), and tap feedback
// (`onInteract`). No `state` slot — like RatePrompt it is fire-once; counts are
// content fixed at open and the reveal progression is internal sequencing.
//
// The coin-fly DOM seam: core hands the game its own reward/balance DOM nodes via
// CoinTransfer so the game's economy animation lands on them without re-querying
// core's class names. Core never imports the economy.

export interface LevelCompleteContent {
  /** Rotating headline messages, cycled every --fab-complete-message-interval-ms. */
  messages: readonly string[];
  rewardLabel: string;
  rewardAmount: number;
  /** Balance pill starting value (balance − baseCoins). */
  balanceBefore: number;
  claimLabel: string;
  nextLabel: string;
  /** Shown on the Next button while onNext runs. */
  nextLoadingLabel: string;
  /** Presence => render the Claim-2x button + require actions.onClaimDouble. */
  claimDouble?: {
    label: string;
    sublabel: string;
    loadingLabel: string;
    loadingSublabel: string;
    unavailableLabel: string;
    unavailableSublabel: string;
    /** Reward label after a successful 2x grant. */
    doubledRewardLabel: string;
  };
}

/** Element refs + transfer data handed to the game's coin-fly. The fly animates
 *  coins FROM `source` to the balance text inside `root`, updating `balanceCountEl`.
 *  These are CORE-owned DOM nodes — the seam that keeps the coin-fly in the game
 *  while the celebration lives in core. */
export interface CoinTransfer {
  /** Coins flying this collect (baseCoins, or ×2). */
  amount: number;
  /** Balance pill end value. */
  targetBalance: number;
  /** 1 normal, 3 on 2x (the FTD animateCoinsToBalance arg). */
  tokenMultiplier: number;
  /** The reward element coins fly from. */
  source: HTMLElement;
  /** The balance pill count (the fly updates its text). */
  balanceCountEl: HTMLElement;
  /** Overlay root (the animateCoinsToBalance `owner`). */
  root: HTMLElement;
  /** Core-computed; the fly honors it. */
  reducedMotion: boolean;
  /** Aborts when the overlay is dismissed. The callback MUST check this before
   *  any work after an internal await (the raw `el.isConnected` guard the
   *  single-closure source design got for free is no longer free here). */
  signal: AbortSignal;
}

export interface LevelCompleteActions {
  /** The coin-fly. Core has already drained the earned counter in parallel; on
   *  resolve core reveals Next. Called for both Claim and (post-grant) Claim-2x.
   *  Core wraps the call in try/catch: on REJECT it re-enables the claim buttons
   *  + resets the collected flag (no dead-end modal); it never assumes this
   *  resolves (the in-repo coin-fly always resolved; a game callback may not). */
  onClaim: (transfer: CoinTransfer) => Promise<void>;
  /** Required iff content.claimDouble set. Game loads the rewarded ad + grants;
   *  returns whether granted + new balance. Core owns the button's loading /
   *  unavailable states and, on grant, re-collects at ×2. May throw → core treats
   *  as not-granted (restore buttons). NOTE: the grant commits inside this
   *  callback when the ad is watched; if the overlay is dismissed before it
   *  resolves, core's post-await guard skips the UI re-collect but CANNOT
   *  un-grant — coins are real and surface via HUD/next session. */
  onClaimDouble?: (signal: AbortSignal) => Promise<{ granted: boolean; coinBalance: number }>;
  /** Game advances the level / maybe shows a rate prompt (awaited) / transitions.
   *  Receives `signal` so its tail (transition cover, etc.) short-circuits if the
   *  overlay was dismissed mid-await. Core closes + resolves `dismissed` after
   *  this resolves; may throw → core closes anyway (player not stranded on the
   *  loading label). */
  onNext: (signal: AbortSignal) => Promise<void>;
  /** Optional tap feedback on any button press (audio). */
  onInteract?: () => void;
}

export interface LevelCompleteOptions {
  mountInto: HTMLElement;
  content: LevelCompleteContent;
  actions: LevelCompleteActions;
  theme?: ThemeTokens;
  /** Root element id + re-entrancy key. Defaults to 'fab-level-complete'. */
  id?: string;
}

// Default beat timings (brand-neutral values). Used as the readMsToken fallback
// when getComputedStyle yields nothing (e.g. a no-theme mount where the token
// only exists as a ui.css @layer default jsdom won't compute). A game injects
// production / fast-E2E values via the matching theme tokens.
const COMPLETE_TIMING_DEFAULTS = {
  // (entrance-ms is consumed only by the CSS animation, which carries its own
  // inline fallback; it's never read via readMsToken, so it's not listed here.)
  '--fab-complete-reward-reveal-delay-ms': 1200,
  '--fab-complete-reward-reveal-ms': 860,
  '--fab-complete-actions-delay-ms': 260,
  '--fab-complete-coin-count-ms': 760,
  '--fab-complete-message-interval-ms': 1600,
} as const;

// Hide-claim-buttons delay after the next button reveals (matches the source's
// fixed 280ms; not a token — purely internal choreography).
const COMPLETE_HIDE_CLAIM_MS = 280;

// Per-element count-up token guard so a re-collect's animation can't fight an
// earlier one writing the same element (matches the source's module counter).
let nextCountupToken = 0;

/** Parse a `--fab-complete-*-ms` token off `root` (e.g. "1200ms" / "1200") to a
 *  number. Falls back to `fallback` when the token is absent/unparseable — which
 *  is the no-theme case in jsdom, where the ui.css @layer default isn't computed. */
function readMsToken(root: HTMLElement, name: string, fallback: number): number {
  const raw = getComputedStyle(root).getPropertyValue(name).trim();
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Parse a CSS `url("x")` / `url(x)` token value to a bare URL; null for none/empty. */
function cssUrlToSrc(raw: string): string | null {
  const v = raw.trim();
  if (!v || v === 'none') return null;
  const m = v.match(/^url\((['"]?)([^'")]*)\1\)$/);
  return m ? m[2] : null;
}

/** Set an <img>'s `src` from a `--fab-*-url` token on `root`. Native <img src>
 *  rendering resolves `height:auto` against the image's intrinsic ratio exactly
 *  like a hand-authored <img src> — CSS `content: url()` does NOT (its
 *  content-replaced sizing drifts a few px), which would break the visual golden.
 *  Reads the INLINE token (applyTheme's `style.setProperty`, the active theming
 *  mechanism) so it works while the root is still detached (art is set during the
 *  build, before finalize() appends). Leaves `src` unset (empty, alt='') when the
 *  token is none/absent → graceful no-art mount with no broken-image icon. */
function applyArtSrc(root: HTMLElement, img: HTMLImageElement, token: string): void {
  const src = cssUrlToSrc(root.style.getPropertyValue(token));
  if (src) img.src = src;
}

/** Cubic-ease integer count between `from`→`to` over `durationMs` (drives the
 *  earned-counter drain). A per-element token guard makes a later call cancel an
 *  in-flight earlier one. Zero/equal → set immediately (covers reduced-motion). */
function animateIntegerText(element: HTMLElement, from: number, to: number, durationMs: number): void {
  nextCountupToken += 1;
  const token = String(nextCountupToken);
  element.dataset.countupToken = token;

  if (durationMs <= 0 || from === to) {
    element.textContent = String(to);
    return;
  }

  const startedAt = performance.now();
  const step = (now: number): void => {
    if (!element.isConnected || element.dataset.countupToken !== token) return;
    const progress = Math.min(1, (now - startedAt) / durationMs);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = String(Math.round(from + (to - from) * eased));
    if (progress < 1) window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
}

/** Drive the reward-reveal lifecycle on `overlay.dataset.rewardReveal`:
 *  pending → revealing → complete. Seeds the earned counter to `rewardAmount` on
 *  reveal. The complete transition is scheduled via the caller's `scheduleTimeout`
 *  so dismiss cancels it; `onComplete` is chained off the SAME callback (so
 *  "actions clickable" is structurally gated on "reveal complete"). */
function revealCompletionReward(
  overlay: HTMLElement,
  rewardEl: HTMLElement | null,
  earnedEl: HTMLElement | null,
  rewardAmount: number,
  revealMs: number,
  scheduleTimeout: (cb: () => void, ms: number) => void,
  onComplete: () => void,
): void {
  overlay.dataset.rewardReveal = 'revealing';
  rewardEl?.classList.add('is-revealing');
  if (earnedEl) earnedEl.textContent = String(rewardAmount);

  scheduleTimeout(() => {
    if (!overlay.isConnected) return;
    overlay.dataset.rewardReveal = 'complete';
    rewardEl?.classList.remove('is-revealing');
    rewardEl?.classList.add('is-complete');
    onComplete();
  }, revealMs);
}

/** Build + prepend the JS-driven side-confetti layer from the confetti art
 *  tokens, then schedule its self-removal. Plain `<img src>` (the decode-clone
 *  micro-opt is dropped; a game warms the HTTP cache before mount). */
function addCompletionSideConfetti(
  overlay: HTMLElement,
  reducedMotion: boolean,
  scheduleTimeout: (cb: () => void, ms: number) => void,
): void {
  const layer = document.createElement('div');
  layer.className = 'fab-complete-side-confetti';
  layer.setAttribute('aria-hidden', 'true');

  const fall = document.createElement('img');
  fall.className = 'fab-complete-confetti-fall';
  fall.alt = '';
  fall.loading = 'eager';
  fall.decoding = 'async';
  fall.style.setProperty('--fab-confetti-delay', reducedMotion ? '0ms' : '500ms');
  applyArtSrc(overlay, fall, '--fab-complete-confetti-fall-url');
  layer.appendChild(fall);

  const bursts = reducedMotion
    ? [{ side: 'left', delayMs: 0 }, { side: 'right', delayMs: 0 }]
    : [{ side: 'left', delayMs: 0 }, { side: 'right', delayMs: 250 }];
  const durationMs = reducedMotion ? 900 : 5200;
  const maxDelayMs = reducedMotion ? 0 : 500;

  for (const burst of bursts) {
    const img = document.createElement('img');
    img.className = `fab-complete-confetti-burst ${burst.side}`;
    img.alt = '';
    img.loading = 'eager';
    img.decoding = 'async';
    img.style.setProperty('--fab-confetti-delay', `${burst.delayMs}ms`);
    applyArtSrc(overlay, img, '--fab-complete-confetti-burst-url');
    layer.appendChild(img);
  }

  overlay.prepend(layer);
  scheduleTimeout(() => layer.remove(), durationMs + maxDelayMs + 260);
}

/** Build the 2x-button copy (label + sublabel) via createElement — never
 *  innerHTML, so a relabel (loading/unavailable) preserves injection-safety and
 *  doesn't tear out the token-driven ad icon's event/animation state. */
function setClaimX2Copy(copyEl: HTMLElement, label: string, sublabel: string): void {
  copyEl.textContent = '';
  const strong = document.createElement('strong');
  strong.textContent = label;
  const small = document.createElement('small');
  small.textContent = sublabel;
  copyEl.append(strong, small);
}

/**
 * Mount the level-complete celebration. Returns a {@link UiHandle};
 * `dismissed` resolves on any close (Next-close or external `dismiss()`).
 *
 * Sequencing (core-internal, mirrors the source state machine):
 *  1. Build DOM, start rotating-message interval, prepend confetti.
 *  2. After `reward-reveal-delay` → reveal reward → after `reward-reveal-ms`
 *     mark `rewardReveal='complete'` AND chain showActions off that callback
 *     (after `actions-delay`) so "clickable" is structurally gated on "complete".
 *  3. Claim → collect(rewardAmount, targetBalance, 1).
 *  4. Claim-2x → sync-disable both + await onClaimDouble → granted: relabel +
 *     collect(×2, …, 3); else restore buttons (unavailable labels).
 *  5. collect: synchronous guard + flag flip + both-buttons-disabled BEFORE any
 *     await; onInteract; drain earned counter; await onClaim (catch → re-enable +
 *     reset); if !aborted: enable + reveal Next, then hide claim buttons.
 *  6. Next → synchronous disable + nextInvoked guard + loading label BEFORE
 *     await; onInteract; await onNext (try/finally) → close.
 *
 * Pure DOM — no game-state / audio / platform / env coupling.
 */
export function mountLevelComplete(opts: LevelCompleteOptions): UiHandle {
  const root = createUiRoot({
    mountInto: opts.mountInto,
    id: opts.id ?? 'fab-level-complete',
    className: 'fab-ui fab-complete',
    theme: opts.theme,
  });
  if (root.reentrant) return root.handle;
  const { el, close, signal, scheduleTimeout, registerCleanup } = root;

  const { content, actions } = opts;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  el.dataset.motion = reducedMotion ? 'reduced' : 'full';
  el.dataset.rewardReveal = 'pending';

  // Read JS-driven beat timings from theme tokens (parsed off the root), falling
  // back to the FTD NORMAL defaults when absent. Reduced-motion collapses the
  // sequencing delays to 0 (matching the source).
  const t = (name: keyof typeof COMPLETE_TIMING_DEFAULTS): number =>
    readMsToken(el, name, COMPLETE_TIMING_DEFAULTS[name]);
  const revealDelayMs = reducedMotion ? 0 : t('--fab-complete-reward-reveal-delay-ms');
  const revealMs = reducedMotion ? 0 : t('--fab-complete-reward-reveal-ms');
  const actionsDelayMs = reducedMotion ? 0 : t('--fab-complete-actions-delay-ms');
  const coinCountMs = reducedMotion ? 0 : t('--fab-complete-coin-count-ms');
  const messageIntervalMs = t('--fab-complete-message-interval-ms');

  // --- DOM build (createElement/append; all copy via textContent) ----------
  // Balance pill (the coin-fly target). The coin icon carries
  // data-economy-anchor="coin" so the game's fly lands on the right element.
  const balancePill = document.createElement('div');
  balancePill.className = 'fab-complete-balance';
  balancePill.setAttribute('aria-label', 'Coin balance');
  const balanceIcon = document.createElement('img');
  balanceIcon.className = 'fab-complete-balance-icon';
  balanceIcon.alt = '';
  balanceIcon.setAttribute('aria-hidden', 'true');
  balanceIcon.dataset.economyAnchor = 'coin';
  const balanceCount = document.createElement('span');
  balanceCount.className = 'fab-complete-balance-count';
  balanceCount.textContent = String(content.balanceBefore);
  balancePill.append(balanceIcon, balanceCount);

  const stage = document.createElement('div');
  stage.className = 'fab-complete-stage';

  const title = document.createElement('img');
  title.className = 'fab-complete-title';
  title.alt = '';
  title.setAttribute('aria-hidden', 'true');

  const card = document.createElement('section');
  card.className = 'fab-complete-card';
  card.setAttribute('aria-live', 'polite');

  const mascot = document.createElement('img');
  mascot.className = 'fab-complete-mascot';
  mascot.alt = '';
  mascot.setAttribute('aria-hidden', 'true');

  const rewardZone = document.createElement('div');
  rewardZone.className = 'fab-complete-reward-zone';

  const message = document.createElement('h1');
  message.className = 'fab-complete-message';
  message.textContent = content.messages[0] ?? '';

  const reward = document.createElement('div');
  reward.className = 'fab-complete-reward';
  reward.setAttribute('aria-live', 'polite');

  const rewardLabel = document.createElement('span');
  rewardLabel.className = 'fab-complete-reward-label';
  rewardLabel.textContent = content.rewardLabel;

  const rewardCoins = document.createElement('span');
  rewardCoins.className = 'fab-complete-reward-coins';
  const rewardIcon = document.createElement('img');
  rewardIcon.className = 'fab-complete-reward-icon';
  rewardIcon.alt = '';
  rewardIcon.setAttribute('aria-hidden', 'true');
  rewardIcon.dataset.economyAnchor = 'coin';
  const earned = document.createElement('strong');
  earned.className = 'fab-complete-earned';
  earned.textContent = '0';
  rewardCoins.append(rewardIcon, earned);
  reward.append(rewardLabel, rewardCoins);
  rewardZone.append(message);
  rewardZone.append(reward);

  const actionsEl = document.createElement('div');
  actionsEl.className = 'fab-complete-actions';
  actionsEl.dataset.visible = 'false';
  actionsEl.setAttribute('aria-hidden', 'true');

  const claimActions = document.createElement('div');
  claimActions.className = 'fab-complete-claim-actions';

  const claimBtn = document.createElement('button');
  claimBtn.type = 'button';
  claimBtn.className = 'fab-btn fab-complete-claim-btn';
  claimBtn.textContent = content.claimLabel;
  claimActions.appendChild(claimBtn);

  // The Claim-2x button renders only when BOTH the copy (content.claimDouble) and
  // the handler (actions.onClaimDouble) are supplied — otherwise it would be a
  // visible-but-inert button. Its ad icon is a token-driven <img> (NOT innerHTML
  // markup) — keeps injection-safety.
  let claimX2Btn: HTMLButtonElement | null = null;
  let claimX2Copy: HTMLElement | null = null;
  if (content.claimDouble && actions.onClaimDouble) {
    claimX2Btn = document.createElement('button');
    claimX2Btn.type = 'button';
    claimX2Btn.className = 'fab-btn fab-complete-claim-x2-btn';
    const adIcon = document.createElement('img');
    adIcon.className = 'fab-complete-claim-x2-icon';
    adIcon.alt = '';
    adIcon.setAttribute('aria-hidden', 'true');
    claimX2Copy = document.createElement('span');
    claimX2Copy.className = 'fab-complete-claim-x2-copy';
    setClaimX2Copy(claimX2Copy, content.claimDouble.label, content.claimDouble.sublabel);
    applyArtSrc(el, adIcon, '--fab-complete-adicon-url');
    claimX2Btn.append(adIcon, claimX2Copy);
    claimActions.appendChild(claimX2Btn);
  }

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'fab-btn fab-btn-primary fab-complete-next-btn';
  nextBtn.disabled = true;
  nextBtn.textContent = content.nextLabel;

  actionsEl.append(claimActions, nextBtn);
  card.append(mascot, rewardZone, actionsEl);
  stage.append(title, card);
  el.append(balancePill, stage);

  // Art via native <img src> (read from the inline theme tokens) — pixel-matches
  // a hand-authored <img src>, unlike CSS content:url() whose sizing drifts.
  applyArtSrc(el, title, '--fab-complete-title-url');
  applyArtSrc(el, mascot, '--fab-complete-mascot-url');
  applyArtSrc(el, balanceIcon, '--fab-complete-coin-icon-url');
  applyArtSrc(el, rewardIcon, '--fab-complete-coin-icon-url');

  // --- Rotating messages ---------------------------------------------------
  // Only rotate when there's something to rotate. Guards the modulo against an
  // empty array (length 0 → NaN index → blanked headline) and skips a pointless
  // interval for a single message.
  if (content.messages.length > 1) {
    let messageIndex = 0;
    const messageTimer = window.setInterval(() => {
      if (!message.isConnected) {
        window.clearInterval(messageTimer);
        return;
      }
      messageIndex = (messageIndex + 1) % content.messages.length;
      message.textContent = content.messages[messageIndex] ?? '';
    }, messageIntervalMs);
    registerCleanup(() => window.clearInterval(messageTimer));
  }

  // --- Sequencing ----------------------------------------------------------
  addCompletionSideConfetti(el, reducedMotion, scheduleTimeout);

  const showActions = (): void => {
    if (signal.aborted) return;
    actionsEl.dataset.visible = 'true';
    actionsEl.removeAttribute('aria-hidden');
  };

  scheduleTimeout(() => {
    if (signal.aborted) return;
    revealCompletionReward(el, reward, earned, content.rewardAmount, revealMs, scheduleTimeout, () => {
      // Chain showActions off the reveal-complete callback (not an independent
      // timeout) so "clickable" is structurally gated on "complete".
      scheduleTimeout(showActions, actionsDelayMs);
    });
  }, revealDelayMs);

  let collected = false;
  // A Claim-2x ad is loading: blocks a concurrent plain Claim from collecting
  // during the await window (defense beyond the synchronous button-disable, in
  // case a click is dispatched programmatically at a disabled button). Cleared
  // once the ad settles — the granted path then runs collect() normally.
  let twoXPending = false;

  // Drain the earned counter + run the game's coin-fly, then reveal Next. The
  // synchronous guard + flag flip + both-buttons-disabled happens BEFORE any
  // await so a rapid Claim + Claim-2x can't double-fire.
  const collect = async (amount: number, targetBalance: number, tokenMultiplier: number): Promise<void> => {
    if (collected || twoXPending || el.dataset.rewardReveal !== 'complete') return;
    collected = true;
    claimBtn.disabled = true;
    if (claimX2Btn) claimX2Btn.disabled = true;

    actions.onInteract?.();
    reward.classList.add('is-collecting');
    earned.textContent = String(amount);
    animateIntegerText(earned, amount, 0, coinCountMs);

    try {
      await actions.onClaim({
        amount,
        targetBalance,
        tokenMultiplier,
        source: reward,
        balanceCountEl: balanceCount,
        root: el,
        reducedMotion,
        signal,
      });
    } catch {
      // Coin-fly rejected → re-enable claim buttons + reset so no dead-end modal.
      // Cancel the in-flight earned drain (it would otherwise land on 0) and
      // restore the amount so the retry state is consistent.
      animateIntegerText(earned, amount, amount, 0);
      reward.classList.remove('is-collecting');
      claimBtn.disabled = false;
      if (claimX2Btn) claimX2Btn.disabled = false;
      collected = false;
      return;
    }

    if (signal.aborted) return;
    reward.classList.remove('is-collecting');
    reward.classList.add('is-collected');
    nextBtn.disabled = false;
    actionsEl.classList.add('show-next');
    scheduleTimeout(() => {
      claimBtn.hidden = true;
      if (claimX2Btn) claimX2Btn.hidden = true;
    }, reducedMotion ? 0 : COMPLETE_HIDE_CLAIM_MS);
  };

  claimBtn.addEventListener('click', () => {
    void collect(content.rewardAmount, content.balanceBefore + content.rewardAmount, 1);
  });

  if (claimX2Btn && content.claimDouble && actions.onClaimDouble) {
    const double = content.claimDouble;
    const onClaimDouble = actions.onClaimDouble;
    const btn = claimX2Btn;
    const copy = claimX2Copy!;
    btn.addEventListener('click', async () => {
      if (collected || twoXPending || el.dataset.rewardReveal !== 'complete') return;
      // Synchronously mark the 2x in flight + lock both claim buttons + show
      // loading BEFORE the await, so a concurrent plain Claim can't collect.
      twoXPending = true;
      claimBtn.disabled = true;
      btn.disabled = true;
      actions.onInteract?.();
      setClaimX2Copy(copy, double.loadingLabel, double.loadingSublabel);

      let result: { granted: boolean; coinBalance: number };
      try {
        result = await onClaimDouble(signal);
      } catch {
        result = { granted: false, coinBalance: 0 };
      }
      // Ad settled → release the block so the granted path's collect() can run.
      twoXPending = false;

      // Dismissed mid-load → skip the UI re-collect (the grant, if any, committed
      // inside onClaimDouble and surfaces via the game's own state).
      if (signal.aborted) return;

      if (result.granted) {
        rewardLabel.textContent = double.doubledRewardLabel;
        earned.textContent = String(content.rewardAmount * 2);
        await collect(content.rewardAmount * 2, result.coinBalance, 3);
        return;
      }
      // Not granted (or threw) → restore both buttons with unavailable labels.
      setClaimX2Copy(copy, double.unavailableLabel, double.unavailableSublabel);
      btn.disabled = false;
      claimBtn.disabled = false;
    });
  }

  let nextInvoked = false;
  nextBtn.addEventListener('click', async () => {
    if (nextInvoked) return;
    nextInvoked = true;
    nextBtn.disabled = true;
    nextBtn.textContent = content.nextLoadingLabel;
    actions.onInteract?.();
    // try/catch (not try/finally): swallow a rejected onNext so the player isn't
    // stranded on the loading label — and so the rejection isn't unhandled.
    try {
      await actions.onNext(signal);
    } catch {
      // intentionally ignored — close anyway below.
    }
    close();
  });

  return root.finalize();
}
