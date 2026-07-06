import { describe, expect, it, vi } from 'vitest';
import { createFlowMachine } from '@fabrikav2/kernel/flow';
import { mountPauseOverlay, type UiHandle } from './index.ts';

function host(): HTMLElement {
  document.body.innerHTML = '<div id="host"></div>';
  return document.getElementById('host')!;
}

function actionByLabel(root: HTMLElement, label: string): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('.fab-modal-actions .fab-btn')).find(
    (b) => b.textContent === label,
  );
  if (!btn) throw new Error(`no action button labelled ${label}`);
  return btn;
}

describe('mountPauseOverlay', () => {
  it('renders resume/settings/quit from injected labels', () => {
    const handle = mountPauseOverlay({
      mountInto: host(),
      labels: { title: 'Paused', resume: 'Resume', settings: 'Settings', quit: 'Quit' },
      actions: { onResume: () => {}, onSettings: () => {}, onQuit: () => {} },
      id: 'pause',
    });
    expect(handle.el.querySelector('.fab-modal-title')?.textContent).toBe('Paused');
    const labels = Array.from(handle.el.querySelectorAll('.fab-modal-actions .fab-btn')).map((b) => b.textContent);
    expect(labels).toEqual(['Resume', 'Settings', 'Quit']);
  });

  it('omits the settings row when no onSettings is supplied', () => {
    const handle = mountPauseOverlay({
      mountInto: host(),
      labels: { resume: 'Resume', quit: 'Quit' },
      actions: { onResume: () => {}, onQuit: () => {} },
      id: 'pause',
    });
    const labels = Array.from(handle.el.querySelectorAll('.fab-modal-actions .fab-btn')).map((b) => b.textContent);
    expect(labels).toEqual(['Resume', 'Quit']);
  });

  it('throws if onSettings is supplied without a settings label', () => {
    expect(() =>
      mountPauseOverlay({
        mountInto: host(),
        labels: { resume: 'Resume', quit: 'Quit' },
        actions: { onResume: () => {}, onSettings: () => {}, onQuit: () => {} },
        id: 'pause',
      }),
    ).toThrow(/labels\.settings is required/);
  });

  it('mounts on Paused enter and unmounts on resume, driven by a real flow machine', () => {
    const h = host();
    const machine = createFlowMachine({ optionalStates: ['paused'] });
    const onSettings = vi.fn();
    let pause: UiHandle | null = null;

    const reconcile = (): void => {
      const shouldShow = machine.state === 'paused';
      if (shouldShow && pause === null) {
        pause = mountPauseOverlay({
          mountInto: h,
          labels: { title: 'Paused', resume: 'Resume', settings: 'Settings', quit: 'Quit' },
          actions: {
            onResume: () => dispatch(() => machine.resume()),
            onSettings, // push SettingsPage — orthogonal to the machine, no transition.
            onQuit: () => dispatch(() => machine.toMenu()),
          },
          id: 'pause',
        });
      } else if (!shouldShow && pause !== null) {
        pause.dismiss();
        pause = null;
      }
    };
    const dispatch = (fn: () => void): void => {
      fn();
      reconcile();
    };

    dispatch(() => machine.start('l1'));
    dispatch(() => machine.pause());
    expect(machine.state).toBe('paused');
    expect(h.querySelector('#pause')).not.toBeNull();

    // Settings does NOT change the flow state (it pushes a page).
    actionByLabel(h, 'Settings').click();
    expect(onSettings).toHaveBeenCalledOnce();
    expect(machine.state).toBe('paused');
    expect(h.querySelector('#pause')).not.toBeNull();

    // Resume → Playing: the overlay unmounts.
    actionByLabel(h, 'Resume').click();
    expect(machine.state).toBe('playing');
    expect(h.querySelector('#pause')).toBeNull();

    machine.dispose();
  });
});
