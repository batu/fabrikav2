import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { mountSdkVerifierPane, type SdkVerifierEntry } from './sdkVerifierPane.ts';

function makeDocument(): Document {
  return new Window().document as unknown as Document;
}

function makeEntry(overrides: Partial<SdkVerifierEntry> = {}): SdkVerifierEntry {
  return {
    name: 'applovin-max',
    configuredIds: { sdkKey: '<redacted:BUP>', rewardedUnitId: 'd516d39f20c54af0' },
    getStatus: () => 'initialized',
    actions: [],
    ...overrides,
  };
}

describe('mountSdkVerifierPane', (): void => {
  it('renders one section per entry with status and configured ids', (): void => {
    const doc = makeDocument();
    mountSdkVerifierPane({
      document: doc,
      entries: [
        makeEntry(),
        makeEntry({ name: 'meta', configuredIds: { appId: null }, getStatus: () => 'not configured: VITE_FB_ENABLED is not true' }),
      ],
    });

    const sections = doc.querySelectorAll('[data-sdk]');
    expect(sections).toHaveLength(2);
    expect(sections[1].querySelector('[data-role="status"]')?.textContent).toContain('not configured');
    expect(sections[1].querySelector('[data-role="configured-id"]')?.textContent).toBe('appId: (not set)');
    expect(sections[0].querySelector('[data-role="configured-id"]')?.textContent).toContain('<redacted:BUP>');
  });

  it('runs an action exactly once per click and logs start + result', async (): Promise<void> => {
    const doc = makeDocument();
    const run = vi.fn(async () => 'loaded=true');
    mountSdkVerifierPane({
      document: doc,
      now: () => new Date(2026, 6, 23, 12, 0, 0),
      entries: [makeEntry({ actions: [{ label: 'Load rewarded', run }] })],
    });

    const button = doc.querySelector('[data-sdk] button');
    (button as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(run).toHaveBeenCalledTimes(1);
    const logItems = [...doc.querySelectorAll('[data-role="callback-log"] li')].map((li) => li.textContent);
    expect(logItems[0]).toBe('12:00:00 [applovin-max] Load rewarded…');
    expect(logItems[1]).toBe('12:00:00 [applovin-max] Load rewarded: loaded=true');
  });

  it('logs action failures without throwing', async (): Promise<void> => {
    const doc = makeDocument();
    mountSdkVerifierPane({
      document: doc,
      entries: [makeEntry({ actions: [{ label: 'Send event', run: async () => { throw new Error('bridge down'); } }] })],
    });

    (doc.querySelector('[data-sdk] button') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    const logText = doc.querySelector('[data-role="callback-log"]')?.textContent ?? '';
    expect(logText).toContain('Send event FAILED: bridge down');
  });

  it('caps the callback log length', (): void => {
    const doc = makeDocument();
    const pane = mountSdkVerifierPane({ document: doc, maxLogEntries: 3, entries: [makeEntry()] });

    for (let i = 0; i < 5; i += 1) pane.log('meta', `event ${i}`);

    const items = doc.querySelectorAll('[data-role="callback-log"] li');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('event 2');
  });

  it('refreshStatuses re-reads live status and remove unmounts', (): void => {
    const doc = makeDocument();
    let status = 'idle';
    const pane = mountSdkVerifierPane({ document: doc, entries: [makeEntry({ getStatus: () => status })] });

    status = 'initialized';
    pane.refreshStatuses();
    expect(doc.querySelector('[data-role="status"]')?.textContent).toBe('initialized');

    expect(pane.remove()).toBe(true);
    expect(doc.querySelectorAll('[data-sdk]')).toHaveLength(0);
  });
});
