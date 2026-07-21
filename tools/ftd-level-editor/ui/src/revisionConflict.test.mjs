import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  discardPendingIntent,
  preserveRevisionConflict,
  reapplyPendingIntent,
} from './sessions/revisionConflict.ts';

describe('revision conflict resolution', () => {
  it('preserves pending intent and never automatically resubmits it', () => {
    const intent = { kind: 'setDogActiveVariant', dogId: 'dog-a', activeVariant: 0 };
    const conflict = preserveRevisionConflict(intent, {
      revision: 'sha256:current',
      session: { id: 'session-a', dogs: [] },
    });

    assert.deepEqual(conflict.pendingIntent, intent);
    assert.equal(conflict.requiresExplicitResolution, true);
    assert.equal(conflict.resubmission, null);
  });

  it('reapply uses the current revision and discard refreshes without mutation', () => {
    const intent = { kind: 'setDogActiveVariant', dogId: 'dog-a', activeVariant: null };
    const conflict = preserveRevisionConflict(intent, {
      revision: 'sha256:current',
      session: { id: 'session-a', dogs: [{ id: 'dog-a', activeVariant: 0 }] },
    });

    assert.deepEqual(reapplyPendingIntent(conflict), {
      intent,
      expectedRevision: 'sha256:current',
    });
    assert.deepEqual(discardPendingIntent(conflict), {
      revision: 'sha256:current',
      session: { id: 'session-a', dogs: [{ id: 'dog-a', activeVariant: 0 }] },
    });
  });
});
