import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { setDogActiveVariant, updateGalleryMetadata } from './features/gallery/actions.ts';

// AE12: the UI adapter must emit exactly the wire shape a direct HTTP client
// derives from the pinned OpenAPI document — same paths, same body fields.

function capture(result) {
  const calls = [];
  const fetchImpl = async (path, init) => {
    calls.push({ path, method: init.method, body: JSON.parse(init.body) });
    return {
      ok: true,
      async json() {
        return result;
      },
    };
  };
  return { calls, context: { fetchImpl, launchCredential: 'cred' } };
}

const SNAPSHOT = { sessionId: 's1', revision: 'rev-2', session: {}, provenance: {} };

describe('gallery unpaid stable-ID actions', () => {
  it('sets a dog active variant over the named stable-ID route', async () => {
    const { calls, context } = capture(SNAPSHOT);
    const snapshot = await setDogActiveVariant(context, {
      sessionId: 's1',
      dogId: 'dog-a',
      revision: 'rev-1',
      activeVariant: 2,
    });
    assert.deepEqual(calls, [
      {
        path: '/api/sessions/s1/dogs/dog-a/active-variant',
        method: 'POST',
        body: { revision: 'rev-1', activeVariant: 2 },
      },
    ]);
    assert.equal(snapshot.revision, 'rev-2');
  });

  it('updates gallery metadata with the revision-bound body', async () => {
    const { calls, context } = capture(SNAPSHOT);
    await updateGalleryMetadata(context, {
      sessionId: 's1',
      revision: 'rev-1',
      tags: ['ready'],
    });
    assert.deepEqual(calls, [
      {
        path: '/api/sessions/s1/gallery-metadata',
        method: 'POST',
        body: { revision: 'rev-1', tags: ['ready'], archived: null },
      },
    ]);
  });
});
