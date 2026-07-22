import assert from 'node:assert/strict';
import { Blob } from 'node:buffer';
import { describe, it } from 'node:test';

import {
  captureCurrentSessionImage,
  setDogActiveVariant,
  updateGalleryMetadata,
} from './features/gallery/actions.ts';

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

  it('captures the current image with the same revision-bound binary contract', async () => {
    const calls = [];
    const fetchImpl = async (path, init) => {
      calls.push({ path, method: init.method, body: JSON.parse(init.body) });
      return {
        ok: true,
        headers: new Headers({
          'Content-Type': 'image/png',
          'X-FTD-Session-Id': 's1',
          'X-FTD-Session-Revision': 'rev-2',
          'X-FTD-Image-Source': 'color.png',
          'X-FTD-Image-SHA256': 'sha256:image',
        }),
        async blob() {
          return new Blob(['image-bytes'], { type: 'image/png' });
        },
      };
    };

    const captured = await captureCurrentSessionImage(
      { fetchImpl, launchCredential: 'cred' },
      { sessionId: 's1', revision: 'rev-2', variant: 'gemini' },
    );

    assert.deepEqual(calls, [
      {
        path: '/api/sessions/s1/capture',
        method: 'POST',
        body: { revision: 'rev-2', variant: 'gemini' },
      },
    ]);
    assert.deepEqual(
      {
        sessionId: captured.sessionId,
        revision: captured.revision,
        source: captured.source,
        sha256: captured.sha256,
        mediaType: captured.mediaType,
        size: captured.image.size,
      },
      {
        sessionId: 's1',
        revision: 'rev-2',
        source: 'color.png',
        sha256: 'sha256:image',
        mediaType: 'image/png',
        size: 11,
      },
    );
  });

  it('rejects a capture whose media type drifts from the generated contract', async () => {
    const fetchImpl = async () => ({
      ok: true,
      headers: new Headers({
        'Content-Type': 'text/plain',
        'X-FTD-Session-Id': 's1',
        'X-FTD-Session-Revision': 'rev-2',
        'X-FTD-Image-Source': 'color.png',
        'X-FTD-Image-SHA256': 'sha256:image',
      }),
      async blob() {
        return new Blob(['not-an-image'], { type: 'text/plain' });
      },
    });

    await assert.rejects(
      () =>
        captureCurrentSessionImage(
          { fetchImpl, launchCredential: 'cred' },
          { sessionId: 's1', revision: 'rev-2', variant: 'gemini' },
        ),
      /not image\/png/,
    );
  });

  it('uses the shared bounded request path for a stalled mutation', async () => {
    const fetchImpl = (_path, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    await assert.rejects(
      () =>
        updateGalleryMetadata(
          { fetchImpl, launchCredential: 'cred', timeoutMs: 10 },
          { sessionId: 's1', revision: 'rev-1' },
        ),
      /aborted/,
    );
  });
});
