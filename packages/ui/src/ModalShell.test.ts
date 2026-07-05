import { describe, expect, it, vi } from 'vitest';
import { mountModalShell } from './index.ts';

function host(): HTMLElement {
  document.body.innerHTML = '<div id="host"></div>';
  return document.getElementById('host')!;
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('mountModalShell', () => {
  it('renders title, body, and action slots in a dialog card', () => {
    const body = document.createElement('p');
    body.textContent = 'Body';
    const onAction = vi.fn();
    const handle = mountModalShell({
      mountInto: host(),
      title: 'Hello',
      body,
      actions: [{ label: 'OK', onClick: onAction }],
      id: 'modal',
    });

    const card = handle.el.querySelector<HTMLElement>('.fab-modal-card')!;
    expect(card.getAttribute('role')).toBe('dialog');
    expect(card.getAttribute('aria-modal')).toBe('true');
    expect(handle.el.querySelector('.fab-modal-title')?.textContent).toBe('Hello');
    expect(handle.el.querySelector('p')?.textContent).toBe('Body');
    handle.el.querySelector<HTMLButtonElement>('.fab-btn')!.click();
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('renders body arrays and caller-provided action slots', () => {
    const first = document.createElement('p');
    first.textContent = 'First';
    const second = document.createElement('p');
    second.textContent = 'Second';
    const actions = document.createElement('div');
    actions.className = 'custom-actions';
    actions.textContent = 'Custom slot';

    const handle = mountModalShell({
      mountInto: host(),
      body: [first, second],
      actions,
      id: 'slots',
    });

    expect(Array.from(handle.el.querySelectorAll('p')).map((el) => el.textContent)).toEqual(['First', 'Second']);
    expect(handle.el.querySelector('.custom-actions')?.textContent).toBe('Custom slot');
  });

  it('sets aria-labelledby from generated title id or caller-provided id', () => {
    const generated = mountModalShell({ mountInto: host(), title: 'Generated', id: 'generated' });
    const generatedCard = generated.el.querySelector<HTMLElement>('.fab-modal-card')!;
    expect(generatedCard.getAttribute('aria-labelledby')).toBe('generated-title');

    const labelled = mountModalShell({
      mountInto: host(),
      title: 'Labelled',
      id: 'labelled',
      labelledById: 'custom-title',
    });
    const labelledCard = labelled.el.querySelector<HTMLElement>('.fab-modal-card')!;
    expect(labelledCard.getAttribute('aria-labelledby')).toBe('custom-title');
    expect(labelled.el.querySelector('.fab-modal-title')?.id).toBe('custom-title');
  });

  it('dismisses on backdrop click only when enabled', async () => {
    const h = host();
    const handle = mountModalShell({ mountInto: h, title: 'Dismiss', backdropDismiss: true, id: 'dismiss' });
    click(handle.el);
    await handle.dismissed;
    expect(h.querySelector('#dismiss')).toBeNull();
  });

  it('card click does not trigger backdrop dismissal', () => {
    const h = host();
    const handle = mountModalShell({ mountInto: h, title: 'Stay', backdropDismiss: true, id: 'stay' });
    click(handle.el.querySelector('.fab-modal-card')!);
    expect(h.querySelector('#stay')).not.toBeNull();
  });

  it('backdropDismiss false keeps the modal open on backdrop click', () => {
    const h = host();
    const handle = mountModalShell({ mountInto: h, title: 'Stay', backdropDismiss: false, id: 'modal' });
    click(handle.el);
    expect(h.querySelector('#modal')).not.toBeNull();
  });

  it('onDismiss fires once across repeated dismissal paths', async () => {
    const onDismiss = vi.fn();
    const h = host();
    const handle = mountModalShell({ mountInto: h, title: 'Close', backdropDismiss: true, onDismiss, id: 'close' });
    handle.dismiss();
    handle.dismiss();
    click(handle.el);
    await handle.dismissed;
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(h.querySelector('#close')).toBeNull();
  });

  it('onDismiss cannot strand teardown when it throws', async () => {
    const h = host();
    const handle = mountModalShell({
      mountInto: h,
      title: 'Close',
      onDismiss: () => {
        throw new Error('dismiss failed');
      },
      id: 'throwing',
    });

    expect(() => handle.dismiss()).toThrow(/dismiss failed/);
    await handle.dismissed;
    expect(h.querySelector('#throwing')).toBeNull();
  });

  it('onDismiss can synchronously remount the same id after teardown', () => {
    const h = host();
    const handle = mountModalShell({
      mountInto: h,
      title: 'Original',
      id: 'modal',
      onDismiss: () => {
        mountModalShell({ mountInto: h, title: 'Replacement', id: 'modal' });
      },
    });

    handle.dismiss();
    expect(h.querySelectorAll('#modal')).toHaveLength(1);
    expect(h.querySelector('#modal .fab-modal-title')?.textContent).toBe('Replacement');
  });

  it('rejects reused caller-provided slots instead of moving them between modals', () => {
    const h = host();
    const body = document.createElement('p');
    body.textContent = 'Body';
    const actions = document.createElement('div');
    actions.textContent = 'Actions';
    mountModalShell({ mountInto: h, body, actions, id: 'first' });

    expect(() => {
      mountModalShell({ mountInto: h, body, id: 'second' });
    }).toThrow(/fresh elements/);
    expect(() => {
      mountModalShell({ mountInto: h, actions, id: 'third' });
    }).toThrow(/fresh elements/);
  });

  it('same-id mount returns the live handle without duplicate DOM', () => {
    const h = host();
    const a = mountModalShell({ mountInto: h, title: 'One', id: 'modal' });
    const b = mountModalShell({ mountInto: h, title: 'Two', id: 'modal' });
    expect(h.querySelectorAll('#modal')).toHaveLength(1);
    expect(b.el).toBe(a.el);
    b.dismiss();
    expect(h.querySelector('#modal')).toBeNull();
  });
});
