import { createUiRoot, type ThemeTokens, type UiHandle } from './internal.ts';

/**
 * SagaMap — the level-select rail, ported near-verbatim from v1 core
 * `mountLevelMap` (`packages/core/src/ui/index.ts:123-229`), the only proven
 * ≥2-game shared UI component in v1 (consumed by FTD `HomeScene` and marble
 * `saga.ts`). Pure DOM — no game-state / env coupling.
 *
 * Renders a vertical single-path rail of `.fab-levelmap-node` buttons (states
 * `current | locked | completed`), depth-fade ahead of current, an empty-state
 * loading placeholder, and a single delegated click listener that fires
 * `onSelectLevel(node.id)` for EVERY node (gating a locked tap is the consumer's
 * job — the primitive never blocks a click). Themed via `--fab-levelmap-*`.
 *
 * One change vs the v1 port: the loading placeholder's accessible name is the
 * sole baked copy string in the seed (`aria-label="Loading levels"`), so it is
 * injected here as `loadingLabel` — the audit no-literals linter would otherwise
 * flag it. Everything else is data set via setAttribute/textContent, never
 * interpolated into markup.
 */

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

export interface SagaMapOptions {
  mountInto: HTMLElement;
  state: LevelMapState;
  actions: LevelMapActions;
  /** Injected accessible name for the empty-state loading rail (no baked copy). */
  loadingLabel: string;
  theme?: ThemeTokens;
  /** Root element id (re-entrancy key). Defaults to 'fab-saga-map'. */
  id?: string;
}

// far at distance >= 3, distant at >= 4 from the current node (matches the
// v1 rail's depth thresholds).
const DEPTH_FAR = 3;
const DEPTH_DISTANT = 4;

// Build the rail as DOM (not an innerHTML template): node `name`/`id`/`label`
// are consumer-supplied data, set via setAttribute/textContent — never
// interpolated into markup, so injected level names carrying quotes/`<` are
// injection-safe. `state` and the computed depth are typed/derived, so the
// className is safe.
function buildRail(state: LevelMapState, loadingLabel: string): HTMLElement {
  const path = document.createElement('div');
  path.className = 'fab-levelmap-path';

  if (state.nodes.length === 0) {
    // Loading placeholder rail (mirrors the v1 3-dot loading state).
    path.dataset.loading = 'true';
    path.setAttribute('aria-label', loadingLabel);
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
 * Mount the saga level-map rail. Returns a {@link UiHandle}. Clicking any node
 * fires `onSelectLevel(node.id)` — including locked nodes (gating is the
 * consumer's concern). Re-entrant by `id`.
 */
export function mountSagaMap(opts: SagaMapOptions): UiHandle {
  const root = createUiRoot({
    mountInto: opts.mountInto,
    id: opts.id ?? 'fab-saga-map',
    className: 'fab-ui fab-levelmap',
    theme: opts.theme,
  });
  if (root.reentrant) return root.handle;
  const { el } = root;

  el.appendChild(buildRail(opts.state, opts.loadingLabel));

  el.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLElement>('.fab-levelmap-node');
    if (!btn) return;
    const i = Number(btn.dataset.fabNodeIndex);
    const node = Number.isInteger(i) ? opts.state.nodes[i] : undefined;
    if (node) opts.actions.onSelectLevel(node.id);
  });

  return root.finalize();
}
