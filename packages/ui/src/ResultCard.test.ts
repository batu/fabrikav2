import { describe, expect, it } from 'vitest';
import { createFlowMachine } from '@fabrikav2/kernel/flow';
import { mountResultCard, type UiHandle } from './index.ts';

function host(): HTMLElement {
  document.body.innerHTML = '<div id="host"></div>';
  return document.getElementById('host')!;
}

describe('mountResultCard', () => {
  it('renders the win variant with reward-display slot and injected copy', () => {
    const reward = document.createElement('div');
    reward.textContent = '+50';
    const handle = mountResultCard({
      mountInto: host(),
      variant: 'win',
      title: 'You win!',
      messages: 'All marbles sorted',
      rewardDisplay: reward,
      actions: [{ label: 'Next', onClick: () => {} }],
      id: 'result',
    });
    const card = handle.el.querySelector<HTMLElement>('.fab-modal-card')!;
    expect(card.classList.contains('fab-result-card--win')).toBe(true);
    expect(handle.el.querySelector('.fab-modal-title')?.textContent).toBe('You win!');
    expect(handle.el.querySelector('.fab-result-message')?.textContent).toBe('All marbles sorted');
    expect(handle.el.querySelector('.fab-result-reward')?.textContent).toBe('+50');
    expect(handle.el.querySelector('.fab-result-continue')).toBeNull();
  });

  it('renders the lose variant with the continue-offer slot', () => {
    const offer = document.createElement('div');
    offer.textContent = 'Watch ad';
    const handle = mountResultCard({
      mountInto: host(),
      variant: 'lose',
      messages: ['No hearts left'],
      continueOffer: offer,
      actions: [{ label: 'Retry', onClick: () => {} }],
      id: 'result',
    });
    expect(handle.el.querySelector('.fab-modal-card')?.classList.contains('fab-result-card--lose')).toBe(true);
    expect(handle.el.querySelector('.fab-result-continue')?.textContent).toBe('Watch ad');
    expect(handle.el.querySelector('.fab-result-reward')).toBeNull();
  });

  it('mounts on Complete enter and unmounts on leave via a real flow machine', () => {
    const h = host();
    const machine = createFlowMachine();
    let result: UiHandle | null = null;

    const reconcile = (): void => {
      const isResult = machine.state === 'complete' || machine.state === 'failed';
      if (isResult && result === null) {
        const isWin = machine.state === 'complete';
        result = mountResultCard({
          mountInto: h,
          variant: isWin ? 'win' : 'lose',
          actions: isWin
            ? [
                // Next needs the id up front (S2); guard the double-fire (S4).
                { label: 'Next', onClick: () => dispatch(() => machine.can('next') && machine.next('l2')) },
              ]
            : [{ label: 'Retry', onClick: () => dispatch(() => machine.can('retry') && machine.retry()) }],
          id: 'result',
        });
      } else if (!isResult && result !== null) {
        result.dismiss();
        result = null;
      }
    };
    const dispatch = (fn: () => void): void => {
      fn();
      reconcile();
    };

    dispatch(() => machine.start('l1'));
    expect(h.querySelector('#result')).toBeNull();
    dispatch(() => machine.complete());
    expect(machine.state).toBe('complete');
    expect(h.querySelector('.fab-result-card--win')).not.toBeNull();

    // "Next" advances → Playing: the win card unmounts.
    h.querySelector<HTMLButtonElement>('.fab-modal-actions .fab-btn')!.click();
    expect(machine.state).toBe('playing');
    expect(machine.currentLevelId).toBe('l2');
    expect(h.querySelector('#result')).toBeNull();

    machine.dispose();
  });

  it('the can() guard makes a double-fire click a no-op instead of throwing', () => {
    const h = host();
    const machine = createFlowMachine();
    machine.start('l1');
    machine.fail();
    const handle = mountResultCard({
      mountInto: h,
      variant: 'lose',
      actions: [{ label: 'Retry', onClick: () => machine.can('retry') && machine.retry() }],
      id: 'result',
    });
    const retry = handle.el.querySelector<HTMLButtonElement>('.fab-modal-actions .fab-btn')!;
    retry.click(); // Failed→Playing
    expect(machine.state).toBe('playing');
    // Second click: retry is illegal from Playing, but can() short-circuits it.
    expect(() => retry.click()).not.toThrow();
    expect(machine.state).toBe('playing');
    machine.dispose();
  });
});
