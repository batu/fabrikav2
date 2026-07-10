import { buildButtonElement } from './Button.ts';
import { mountSagaMap, type LevelMapState, type LevelMapActions } from './SagaMap.ts';
import { createUiRoot, type ThemeTokens, type UiHandle } from './internal.ts';

/**
 * HomeMenu — the `Menu`-state surface. In BOTH v1 consumers the menu surface
 * *is* the level map (FTD `HomeScene` mounts `mountLevelMap`; marble
 * `App.showMenu` mounts it), so HomeMenu is deliberately a THIN container that
 * composes {@link mountSagaMap} as its primary content — not a re-implemented
 * god-menu (brainstorm S5). It adds an injected header slot and optional
 * top-level actions (e.g. a "Levels" button that fires the machine's
 * `selectLevel()` edge, a settings entry, or a direct-play button).
 *
 * HomeMenu owns no flow-machine coupling: action `onClick`s are injected, and
 * the consumer wires them to `machine.selectLevel()` / `machine.start(id)` etc.
 */

export interface HomeMenuAction {
  label: string;
  onClick: (event: MouseEvent) => void;
  /** Optional game-owned button sprite. When supplied, it is the button surface. */
  spriteImage?: string;
  ariaLabel?: string;
  /** Extra class(es) for game-local theming (e.g. a green LEVEL-start CTA). */
  className?: string;
  /** Stable hook (→ data-fab-action) for real-click e2e / analytics. */
  dataAction?: string;
}

export interface HomeMenuSagaConfig {
  state: LevelMapState;
  actions: LevelMapActions;
  /** Injected accessible name for the empty-state loading rail. */
  loadingLabel: string;
  /** Opt out when game-provided node art already includes its own backing. */
  suppressDefaultNodeDisc?: boolean;
  id?: string;
}

export interface HomeMenuOptions {
  mountInto: HTMLElement;
  /** Composed SagaMap — the menu's primary content. */
  saga: HomeMenuSagaConfig;
  /** Optional injected header slot (title / logo). Must be a fresh element. */
  header?: HTMLElement;
  /** Optional top-level menu buttons (Levels / Settings / Play). */
  actions?: readonly HomeMenuAction[];
  theme?: ThemeTokens;
  id?: string;
}

let nextHomeMenuId = 0;

function assertFreshSlot(el: HTMLElement): void {
  if (el.parentNode) {
    throw new Error('mountHomeMenu header slot must be a fresh element without an existing parent.');
  }
}

export function mountHomeMenu(opts: HomeMenuOptions): UiHandle {
  const root = createUiRoot({
    mountInto: opts.mountInto,
    id: opts.id ?? `fab-home-menu-${++nextHomeMenuId}`,
    className: 'fab-ui fab-home-menu',
    theme: opts.theme,
    kind: 'home-menu',
  });
  if (root.reentrant) return root.handle;

  const { el } = root;

  if (opts.header) {
    assertFreshSlot(opts.header);
    opts.header.classList.add('fab-home-menu-header');
    el.appendChild(opts.header);
  }

  const content = document.createElement('div');
  content.className = 'fab-home-menu-content';
  el.appendChild(content);
  // Compose SagaMap into the menu's content region. Its handle is disposed with
  // the menu so unmounting HomeMenu tears down the whole surface.
  const saga = mountSagaMap({
    mountInto: content,
    state: opts.saga.state,
    actions: opts.saga.actions,
    loadingLabel: opts.saga.loadingLabel,
    suppressDefaultNodeDisc: opts.saga.suppressDefaultNodeDisc,
    id: opts.saga.id,
  });
  root.registerCleanup(() => saga.dismiss());

  if (opts.actions && opts.actions.length > 0) {
    const actionRow = document.createElement('div');
    actionRow.className = 'fab-home-menu-actions';
    for (const action of opts.actions) {
      actionRow.appendChild(
        buildButtonElement({
          label: action.label,
          onClick: action.onClick,
          spriteImage: action.spriteImage,
          ariaLabel: action.ariaLabel,
          className: action.className,
          dataAction: action.dataAction,
        }),
      );
    }
    el.appendChild(actionRow);
  }

  return root.finalize();
}
