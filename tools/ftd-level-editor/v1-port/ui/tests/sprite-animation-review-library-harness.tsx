import { createRoot } from 'react-dom/client';
import SpriteAnimationReviewLibrary from '../src/components/SpriteAnimationReviewLibrary';
import '../src/App.css';
import type { SpriteCandidate } from '../src/types';

const selectedCandidate: SpriteCandidate = {
  id: 'dog_00:sprite_000',
  dogIndex: 0,
  spriteIndex: 0,
  status: 'ready',
  reason: null,
  image: 'dogs/dog_00/sprite_000.png',
  metadataPath: 'dogs/dog_00/sprite_000.json',
  width: 64,
  height: 72,
  technique: 'test-cutout',
  quality: { pickupUsable: true },
};

const root = document.getElementById('root');
if (root === null) throw new Error('Missing root');
createRoot(root).render(
  <div className="app">
    <main className="pipeline">
      <SpriteAnimationReviewLibrary
        sessionId="review_library_demo"
        selectedCandidate={selectedCandidate}
        refreshKey={0}
      />
    </main>
  </div>,
);
