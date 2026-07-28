import React, { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CutoutReviewPanel from '../src/components/CutoutReviewPanel';
import '../src/App.css';
import type { DogState, Hitbox } from '../src/types';

const HITBOXES: Hitbox[] = [
  { x: 80, y: 90, r: 30 },
  { x: 180, y: 120, r: 36 },
  { x: 280, y: 160, r: 28 },
];

const DOGS: DogState[] = [
  { index: 0, status: 'done', activeVariant: 0, promptOverride: null, variants: ['dogs/dog_00/variant_000.png'] },
  { index: 1, status: 'done', activeVariant: 0, promptOverride: null, variants: ['dogs/dog_01/variant_000.png'] },
  { index: 2, status: 'done', activeVariant: 0, promptOverride: null, variants: ['dogs/dog_02/variant_000.png'] },
];

function Harness() {
  const [lastAction, setLastAction] = useState<string>('none');
  const [sessionId, setSessionId] = useState('cutout_review_demo');
  const [dogs, setDogs] = useState<DogState[]>(DOGS);
  const handleDogComplete = useCallback((dogIndex: number, file: string, variantIndex: number) => {
    setLastAction(`dog ${dogIndex} regenerated as variant ${variantIndex}`);
    setDogs((prev) => prev.map((dog) => (
      dog.index === dogIndex
          ? {
              ...dog,
              status: 'done',
              activeVariant: variantIndex,
              variants: [...dog.variants, file],
            }
          : dog
    )));
  }, []);

  return (
    <main className="app" style={{ minHeight: '100vh', padding: 24 }}>
      <button id="switch-session" className="btn" type="button" onClick={() => setSessionId('cutout_review_demo_2')}>
        Switch session
      </button>
      <CutoutReviewPanel
        sessionId={sessionId}
        sharedPrompt="A cute dog, complete body, clean silhouette, no attached scenery."
        inpaintModel="demo-model"
        hitboxes={HITBOXES}
        dogs={dogs}
        onDogComplete={handleDogComplete}
      />
      <div id="last-action" style={{ color: '#888', marginTop: 12 }}>{lastAction}</div>
    </main>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Missing root');
createRoot(root).render(<Harness />);
