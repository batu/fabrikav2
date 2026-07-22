import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import {
  grantAcknowledgement,
  isUnfinishedSagaStatus,
  publishingAnnouncement,
  publishingStatusCopy,
  retainedCandidates,
} from './features/publishing/model.ts';


const candidate = {
  candidateId: 'seq-1-abc',
  sequenceVersion: 'seq-1',
  levelIds: ['starter', 'later'],
  catalogRevision: 'catalog-1',
  changelog: 'Ship safely',
  actor: 'human:batu',
  sourceRevision: 'catalog-1',
  digest: 'abc123',
};


describe('publishing human surface contracts', () => {
  it('names every durable saga state without flattening ambiguity', () => {
    const states = [
      'pending_remote',
      'reconciling',
      'remote_committed',
      'finalizing',
      'succeeded',
      'failed',
    ];
    assert.deepEqual(
      states.map((status) => publishingStatusCopy(status).label),
      [
        'Pending remote response',
        'Reconciling by readback',
        'Remote hash confirmed',
        'Finalizing local selection',
        'Sequence selected',
        'Publication failed',
      ],
    );
    assert.match(publishingAnnouncement({ status: 'reconciling', action: 'publish' }), /not republish/i);
  });

  it('binds confirmation copy to the exact action and digest', () => {
    assert.equal(
      grantAcknowledgement('publish_sequence', candidate.digest),
      'I approve publish_sequence for abc123',
    );
    assert.equal(
      grantAcknowledgement('rollback_sequence', candidate.digest),
      'I approve rollback_sequence for abc123',
    );
  });

  it('treats every recoverable pre-terminal state as unfinished', () => {
    assert.deepEqual(
      ['pending_remote', 'reconciling', 'remote_committed', 'finalizing', 'succeeded', 'failed']
        .map((status) => isUnfinishedSagaStatus(status)),
      [true, true, true, true, false, false],
    );
  });

  it('offers retained immutable versions except the current selection', () => {
    const old = { ...candidate, candidateId: 'seq-0-def', sequenceVersion: 'seq-0', digest: 'def456' };
    assert.deepEqual(
      retainedCandidates(
        [old, candidate],
        candidate,
        [old.candidateId],
      ).map((entry) => entry.sequenceVersion),
      ['seq-0'],
    );
  });

  it('keeps status announcements and keyboard focus behavior explicit in the component', async () => {
    const source = await readFile(
      new URL('./features/publishing/PublishingPanel.tsx', import.meta.url),
      'utf8',
    );
    assert.match(source, /aria-live="polite"/);
    assert.match(source, /aria-describedby=/);
    assert.match(source, /tabIndex=\{-1\}/);
    assert.match(source, /\.focus\(\)/);
    assert.match(source, /type="button"/);
  });

});
