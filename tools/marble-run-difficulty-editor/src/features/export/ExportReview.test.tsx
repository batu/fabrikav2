import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultDifficultyDraft } from '../../../../../games/marble_run/src/levels/difficulty-contract.ts';
import { LEVELS } from '../../../../../games/marble_run/src/levels/levels.generated.ts';
import type { EditorWorkspaceState } from '../../domain/draftStore.ts';
import type { ExportReview as ExportReviewResult } from './exportCandidate.ts';

const calls = vi.hoisted(() => ({ current: true, downloads: 0 }));
const readyReview = {
  reviewedDraftFingerprint: 'a'.repeat(64), candidateFingerprint: 'b'.repeat(64), json: '{}', canExport: true, issues: [], candidate: {},
  summary: { changedLevelIds: [3, 9], overriddenLevelIds: [9], lockedLevelIds: [4], failedLevelIds: [], validatedLevelIds: Array.from({ length: 110 }, (_, index) => index + 1) },
} as unknown as ExportReviewResult;

vi.mock('./exportCandidate.ts', () => ({
  createExportReview: vi.fn(async () => readyReview),
  reviewIsCurrent: vi.fn(async () => calls.current),
  prepareCandidateDownload: vi.fn(async () => ({ filename: 'candidate.json', mimeType: 'application/json', bytes: new Uint8Array([123, 125]), fingerprint: 'b'.repeat(64) })),
  triggerCandidateDownload: vi.fn(() => { calls.downloads += 1; }),
}));

import { ExportReview } from './ExportReview.tsx';

function state(): EditorWorkspaceState {
  const draft = createDefaultDifficultyDraft();
  return { phase: 'Draft', draft, selectedLevelId: 1, revision: 1, accepted: {}, boards: Object.fromEntries(LEVELS.map((level) => [level.id, level])), levelStates: {}, failures: {}, lastWriteDurationMs: null, persistedBytes: 0 };
}

describe('ExportReview UI', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { calls.current = true; calls.downloads = 0; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  const click = async (selector: string) => act(async () => { container.querySelector<HTMLElement>(selector)!.click(); await Promise.resolve(); });

  it('reviews, inventories, explicitly confirms, and downloads the reviewed candidate', async () => {
    await act(async () => root.render(<ExportReview state={state()} onClose={() => undefined} />));
    await click('[data-action="begin-review"]');
    expect(container.textContent).toContain('Ready to confirm');
    expect(container.textContent).toContain('Candidate fingerprint');
    expect(container.textContent).toContain('110 / 110');
    const download = container.querySelector<HTMLButtonElement>('[data-action="download-candidate"]')!;
    expect(download.disabled).toBe(true);
    await click('[data-action="confirm-export"]');
    expect(download.disabled).toBe(false);
    await click('[data-action="download-candidate"]');
    expect(calls.downloads).toBe(1);
  });

  it('marks an existing review stale after the draft changes and requires review again', async () => {
    const initial = state();
    await act(async () => root.render(<ExportReview state={initial} onClose={() => undefined} />));
    await click('[data-action="begin-review"]');
    calls.current = false;
    const edited = { ...initial, revision: 2, draft: { ...initial.draft, locks: [{ levelId: 4, reason: 'accepted' }] } };
    await act(async () => { root.render(<ExportReview state={edited} onClose={() => undefined} />); await Promise.resolve(); });
    expect(container.textContent).toContain('Review is stale');
    expect(container.textContent).toContain('Review the current draft again');
    expect(container.querySelector<HTMLButtonElement>('[data-action="download-candidate"]')!.disabled).toBe(true);
  });
});
