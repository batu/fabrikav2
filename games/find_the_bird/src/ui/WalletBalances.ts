import { gameState } from '../core/GameState';

export function refreshHomeWalletBalances(root: ParentNode = document): void {
  const wallet = gameState.walletSnapshot();
  const coin = root.querySelector<HTMLElement>('.home-coin-pill > span');
  const hint = root.querySelector<HTMLElement>('.home-hint-pill > span');
  if (coin) coin.textContent = String(wallet.coins);
  if (hint) hint.textContent = String(wallet.hints);
}
