import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const previewCalls = vi.hoisted(() => ({ opens: [] as number[], restarts: 0, disposals: 0 }));
const reactTestEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
vi.mock('../preview/EditorGameplayPreview.ts', () => ({
  EditorGameplayPreview: class {
    open(board: { id: number }): void { previewCalls.opens.push(board.id); }
    restart(): boolean { previewCalls.restarts += 1; return true; }
    dispose(): void { previewCalls.disposals += 1; }
  },
}));

import { App } from '../App.tsx';
import { EditorWorkspace } from '../domain/workspace.ts';
import { WorkspaceOwner } from '../domain/workspaceOwner.ts';

describe('difficulty editor authoring surface', () => {
  let container: HTMLDivElement;
  let root: Root;
  let workspace: EditorWorkspace;

  beforeEach(async () => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    previewCalls.opens = [];
    previewCalls.restarts = 0;
    previewCalls.disposals = 0;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const owner = new WorkspaceOwner(() => {
      workspace = new EditorWorkspace({ storage: null, workerFactory: () => ({ onmessage: null, onerror: null, postMessage: () => undefined, terminate: () => undefined }) });
      return workspace;
    });
    await act(async () => root.render(<App workspaceOwner={owner} />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    container.remove();
  });

  const click = async (element: Element | null) => {
    expect(element).not.toBeNull();
    await act(async () => element!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  };

  const change = async (element: HTMLInputElement | HTMLSelectElement | null, value: string) => {
    expect(element).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')?.set;
      setter?.call(element, value);
      element!.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

  it('explains the journey in plain language and edits only the selected steps', async () => {
    const visibleCopy = container.textContent?.toLowerCase() ?? '';
    for (const jargon of ['spike', 'band', 'recover', 'climax', 'cycle', 'offset', 'maximum']) {
      expect(visibleCopy).not.toContain(jargon);
    }
    expect(container.textContent).toContain('Teach the basics');
    expect(container.textContent).toContain('Shape the journey');
    await click(Array.from(container.querySelectorAll('.step-chip')).find((button) => button.textContent?.includes('Blocked spaces')) ?? null);
    expect(container.textContent).toContain('Level 8');
    const beforeTeaching = workspace.store.getSnapshot().draft.authored.onboarding;
    await change(container.querySelector('select[aria-label="What players learn at level 8"]'), '');
    const afterTeaching = workspace.store.getSnapshot().draft.authored.onboarding;
    expect(afterTeaching[7]).toMatchObject({ mechanicDebut: null, spotlight: false });
    expect(afterTeaching.filter((_, index) => index !== 7)).toEqual(beforeTeaching.filter((_, index) => index !== 7));
    expect(container.textContent).not.toContain('Make the new idea the focus');
    await click(Array.from(container.querySelectorAll('.step-chip')).find((button) => button.textContent === '5Challenge') ?? null);
    expect(container.textContent).toContain('Step 5');
    expect(container.textContent).toContain('Create a noticeable test above the surrounding levels.');
    const beforeCycle = workspace.store.getSnapshot().draft.authored.baseCycle;
    await change(container.querySelector('select[aria-label="Pacing for repeating step 5"]'), 'relax');
    await change(container.querySelector('select[aria-label="Later behavior for repeating step 5"]'), 'fixed');
    const afterCycle = workspace.store.getSnapshot().draft.authored.baseCycle;
    expect(afterCycle[4]).toMatchObject({ role: 'relax', progression: 'fixed' });
    expect(afterCycle.filter((_, index) => index !== 4)).toEqual(beforeCycle.filter((_, index) => index !== 4));

    const advanced = container.querySelector<HTMLDetailsElement>('.progression-block')!;
    expect(advanced.open).toBe(false);
    await click(advanced.querySelector('summary'));
    expect(advanced.open).toBe(true);
    const offsetsBefore = workspace.store.getSnapshot().draft.authored.progression.difficultyOffsets;
    await change(container.querySelector('input[aria-label="Added difficulty for repeat 2"]'), '1.5');
    const offsetsAfter = workspace.store.getSnapshot().draft.authored.progression.difficultyOffsets;
    expect(offsetsAfter[1]).toBe(1.5);
    expect(offsetsAfter.filter((_, index) => index !== 1)).toEqual(offsetsBefore.filter((_, index) => index !== 1));
  });

  it('shows all ranges, exact selected values, and linked occurrence context', async () => {
    await click(container.querySelector('[data-view="ranges"]'));
    expect(container.querySelectorAll('[data-range-level]')).toHaveLength(110);
    await click(container.querySelector('[data-range-level="46"]'));
    expect(container.textContent).toContain('Level 46');
    expect(container.textContent).toContain('Linked occurrences');
    expect(container.textContent).toContain('Applied progression');
  });

  it('renders 110 real SVG boards without canvas or WebGL and exposes the play seam', async () => {
    await click(container.querySelector('[data-view="boards"]'));
    expect(container.querySelectorAll('[data-board-level]')).toHaveLength(110);
    expect(container.querySelectorAll('canvas')).toHaveLength(0);
    expect(container.querySelectorAll('[data-board-level] svg')).toHaveLength(110);
    const scroll = container.querySelector<HTMLElement>('[data-board-scroll]')!;
    scroll.scrollLeft = 220;
    await click(container.querySelector('[data-board-level="46"]'));
    expect(container.textContent).toContain('Play level 46');
    expect(previewCalls.opens).toEqual([46]);
    expect(scroll.scrollLeft).toBe(220);
    await click(container.querySelector('[data-action="restart"]'));
    expect(previewCalls.restarts).toBe(1);
    await click(container.querySelector('[data-action="regenerate"]'));
    expect(container.textContent).toContain('Generating');
    await click(container.querySelector('[data-action="close-play"]'));
    expect(container.querySelector('[data-play-level]')).toBeNull();
    expect(previewCalls.disposals).toBe(1);
    expect(scroll.scrollLeft).toBe(220);
  });

  it('defaults Level to 1 and supports override, reset, lock, and unlock', async () => {
    await click(container.querySelector('[data-primary-view="level"]'));
    expect(container.textContent).toContain('Level 1');
    expect(container.textContent).toContain('Default selection');
    await click(container.querySelector('[data-action="override"]'));
    expect(container.textContent).toContain('Detached from Journey');
    await click(container.querySelector('[data-action="reset"]'));
    expect(container.textContent).toContain('Inherited from onboarding');
    await click(container.querySelector('[data-action="lock"]'));
    expect(container.textContent).toContain('Locked board');
    await click(container.querySelector('[data-action="unlock"]'));
    expect(container.textContent).not.toContain('Locked board');
  });

  it('offers synchronized range and numeric mapping controls with an announcement', async () => {
    await click(container.querySelector('[data-action="model"]'));
    const range = container.querySelector<HTMLInputElement>('[data-anchor-range="marbleCount-0"]')!;
    range.value = '7';
    await act(async () => range.dispatchEvent(new Event('input', { bubbles: true })));
    expect(container.querySelector<HTMLInputElement>('[data-anchor-number="marbleCount-0"]')!.value).toBe('7');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Marble count');
  });

  it('keeps help in one guide rather than repeating instructional copy', async () => {
    await click(container.querySelector('[data-action="guide"]'));
    expect(container.querySelectorAll('[data-difficulty-guide]')).toHaveLength(1);
    expect(container.textContent).toContain('Difficulty guide');
  });
});
