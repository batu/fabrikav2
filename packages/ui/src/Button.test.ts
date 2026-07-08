import { describe, expect, it, vi } from 'vitest';
import { mountButton, mountModalShell } from './index.ts';

function host(): HTMLElement {
  document.body.innerHTML = '<div id="host"></div>';
  return document.getElementById('host')!;
}

describe('mountButton', () => {
  it('renders a real button with label assigned as text', () => {
    const h = host();
    const handle = mountButton({ mountInto: h, label: '<b>Play</b>', spriteImage: 'button-src', onClick: () => {} });
    expect(handle.el.tagName).toBe('BUTTON');
    expect(handle.el.textContent).toBe('<b>Play</b>');
    expect(handle.el.querySelector('b')).toBeNull();
    expect(handle.el.classList.contains('fab-btn')).toBe(true);
    expect(handle.el.style.getPropertyValue('--fab-btn-sprite-image')).toContain('button-src');
    expect(h.contains(handle.el)).toBe(true);
  });

  it('fires onClick once when enabled', () => {
    const onClick = vi.fn();
    const handle = mountButton({ mountInto: host(), label: 'Play', onClick });
    handle.el.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('disabled at mount blocks onClick and sets DOM state', () => {
    const onClick = vi.fn();
    const handle = mountButton({ mountInto: host(), label: 'Play', onClick, disabled: true });
    handle.el.click();
    expect(onClick).not.toHaveBeenCalled();
    expect(handle.el.disabled).toBe(true);
    expect(handle.el.dataset.disabled).toBe('true');
  });

  it('setDisabled blocks later clicks and updates DOM state', () => {
    const onClick = vi.fn();
    const handle = mountButton({ mountInto: host(), label: 'Play', onClick });
    handle.setDisabled(true);
    handle.el.click();
    expect(onClick).not.toHaveBeenCalled();
    expect(handle.el.disabled).toBe(true);
    expect(handle.el.dataset.disabled).toBe('true');
  });

  it('setLabel changes text without replacing the button element', () => {
    const handle = mountButton({ mountInto: host(), label: 'Play', onClick: () => {} });
    const el = handle.el;
    handle.setLabel('Again');
    expect(handle.el).toBe(el);
    expect(handle.el.textContent).toBe('Again');
  });

  it('dismiss removes the button and resolves dismissed', async () => {
    const h = host();
    const handle = mountButton({ mountInto: h, label: 'Play', onClick: () => {}, id: 'play' });
    handle.dismiss();
    await handle.dismissed;
    expect(h.querySelector('#play')).toBeNull();
  });

  it('same-id mount returns the live handle without duplicate DOM', () => {
    const h = host();
    const a = mountButton({ mountInto: h, label: 'Play', onClick: () => {}, id: 'play' });
    const b = mountButton({ mountInto: h, label: 'Other', onClick: () => {}, id: 'play' });
    expect(h.querySelectorAll('#play')).toHaveLength(1);
    expect(b.el).toBe(a.el);
    b.setLabel('Again');
    expect(a.el.textContent).toBe('Again');
    b.dismiss();
    expect(h.querySelector('#play')).toBeNull();
  });

  it('same-id pre-existing button returns a complete ButtonHandle', () => {
    const h = host();
    const existing = document.createElement('button');
    existing.id = 'play';
    existing.textContent = 'Existing';
    h.appendChild(existing);

    const handle = mountButton({ mountInto: h, label: 'Play', onClick: () => {}, id: 'play' });
    handle.setLabel('Again');
    handle.setDisabled(true);

    expect(handle.el).toBe(existing);
    expect(existing.textContent).toBe('Again');
    expect(existing.disabled).toBe(true);
    expect(h.querySelectorAll('#play')).toHaveLength(1);
  });

  it('same-id non-button collision fails instead of returning an invalid ButtonHandle', () => {
    const h = host();
    mountModalShell({ mountInto: h, id: 'shared', title: 'Modal' });

    expect(() => {
      mountButton({ mountInto: h, label: 'Play', onClick: () => {}, id: 'shared' });
    }).toThrow(/id collision/);
  });

  it('allows icon-only callers to supply the accessible label without a variant branch', () => {
    const handle = mountButton({
      mountInto: host(),
      label: '',
      ariaLabel: 'Close',
      onClick: () => {},
    });
    expect(handle.el.classList.contains('fab-btn')).toBe(true);
    expect(handle.el.getAttribute('aria-label')).toBe('Close');
  });
});
