import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import SpriteAnimationWizard from '../src/components/SpriteAnimationWizard';
import '../src/App.css';
import type { AnimationJob, SpriteCandidate } from '../src/types';

const candidate: SpriteCandidate = {
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

function Harness() {
  const [lastJob, setLastJob] = useState<AnimationJob | null>(null);
  return (
    <div className="app">
      <main className="pipeline">
        <SpriteAnimationWizard sessionId="wizard_demo" candidate={candidate} onJobCreated={setLastJob} />
        <div data-testid="created-job-state">{lastJob ? `${lastJob.id}:${lastJob.status}` : 'none'}</div>
      </main>
    </div>
  );
}

createRoot(root).render(
  <Harness />,
);
