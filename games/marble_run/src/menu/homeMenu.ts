import { mountHomeMenu, type LevelMapNode, type UiHandle } from '@fabrikav2/ui';
import { MARBLE_LEVELMAP_THEME, assetUrls } from '../../design/theme';

/**
 * v1 sugar3d home menu on the kit HomeMenu + SagaMap: a game-owned header
 * (banner + coin pill + settings gear), the bottom-anchored gold-sun saga map,
 * and a green LEVEL action button. SagaMap fires onSelectLevel for EVERY node —
 * gating a locked tap (shake-reject) is the caller's job.
 */

export interface MountHomeShellOptions {
  mountInto: HTMLElement;
  coins: number;
  nodes: readonly LevelMapNode[];
  /** 1-based number shown on the LEVEL button. */
  currentLevelNumber: number;
  onSelectLevel: (id: string | number) => void;
  onStart: () => void;
  onOpenSettings: () => void;
}

const AMBIENT_SPRINKLE_COLORS = ['#ff4d6d', '#38a3ff', '#44d164', '#ffcc1f', '#b266ff'] as const;
const AMBIENT_SPRINKLE_COUNT = 8;

/** Port of v1 `Ui.ambientSprinkles`: eight independently falling candy dashes. */
function appendAmbientSprinkles(shell: HTMLElement): void {
  const layer = document.createElement('div');
  layer.className = 'marble-ambient-sprinkles';
  layer.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < AMBIENT_SPRINKLE_COUNT; index += 1) {
    const piece = document.createElement('i');
    piece.className = 'marble-ambient-sprinkle';
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.background = AMBIENT_SPRINKLE_COLORS[index % AMBIENT_SPRINKLE_COLORS.length];
    piece.style.animationDuration = `${9 + Math.random() * 8}s`;
    piece.style.animationDelay = `${-Math.random() * 12}s`;
    layer.appendChild(piece);
  }
  shell.appendChild(layer);
}

function buildHeader(opts: MountHomeShellOptions): HTMLElement {
  const header = document.createElement('div');
  header.className = 'marble-home-header';

  const banner = document.createElement('div');
  banner.className = 'marble-home-banner';
  const bannerImg = document.createElement('img');
  bannerImg.src = assetUrls.banner;
  bannerImg.alt = 'Marble Run';
  // The ported banner webp is the empty wooden plate; v1 renders the title text
  // inside it. No title-art asset exists in the ported tree, so the title is DOM
  // text in the v1 FredokaOne face (device-parity MRV2-7, defect 3).
  const bannerTitle = document.createElement('span');
  bannerTitle.className = 'marble-home-banner-title';
  bannerTitle.textContent = 'Marble Run';
  bannerTitle.setAttribute('aria-hidden', 'true');
  banner.append(bannerImg, bannerTitle);

  const coinPill = document.createElement('div');
  coinPill.className = 'marble-coin-pill';
  coinPill.dataset.economyTarget = 'coins';
  coinPill.setAttribute('aria-label', 'Coin balance');
  const coinCount = document.createElement('span');
  coinCount.className = 'marble-coin-count';
  coinCount.textContent = String(opts.coins);
  const coinIcon = document.createElement('img');
  coinIcon.src = assetUrls.coinIcon;
  coinIcon.alt = '';
  coinIcon.setAttribute('aria-hidden', 'true');
  coinIcon.dataset.economyAnchor = 'coin';
  // Device-parity MRV2-25 item 1: v1 renders the coin icon on the LEFT and the
  // value on the RIGHT (home-fresh ref). Kit DOM order = visual order here.
  coinPill.append(coinIcon, coinCount);

  const spacer = document.createElement('div');

  const gear = document.createElement('button');
  gear.type = 'button';
  gear.className = 'marble-gear-btn';
  gear.dataset.fabAction = 'settings';
  gear.setAttribute('aria-label', 'Settings');
  const gearIcon = document.createElement('img');
  gearIcon.src = assetUrls.settingsIcon;
  gearIcon.alt = '';
  gearIcon.setAttribute('aria-hidden', 'true');
  gear.appendChild(gearIcon);
  gear.addEventListener('click', () => opts.onOpenSettings());

  header.append(coinPill, spacer, gear, banner);
  return header;
}

export function mountHomeShell(opts: MountHomeShellOptions): UiHandle {
  const handle = mountHomeMenu({
    mountInto: opts.mountInto,
    id: 'home-shell',
    // Redundant with tokens.css (which authoritatively themes every .fab-ui saga
    // root); kept so the sugar levelmap values are also set on the menu root.
    theme: MARBLE_LEVELMAP_THEME,
    header: buildHeader(opts),
    saga: {
      state: { nodes: opts.nodes },
      actions: { onSelectLevel: (id) => opts.onSelectLevel(id) },
      loadingLabel: 'Loading levels',
      suppressDefaultNodeDisc: true,
      id: 'home-saga-map',
    },
    actions: [
      {
        // Device-parity MRV2-10 U7.8: v1 renders the play button label uppercase
        // (`LEVEL 110`, refs/level-map.png / home-fresh.png).
        label: `LEVEL ${opts.currentLevelNumber}`,
        ariaLabel: `Play Level ${opts.currentLevelNumber}`,
        dataAction: 'play',
        className: 'marble-level-button',
        spriteImage: assetUrls.levelButton,
        onClick: () => opts.onStart(),
      },
    ],
  });
  appendAmbientSprinkles(handle.el);
  return handle;
}
