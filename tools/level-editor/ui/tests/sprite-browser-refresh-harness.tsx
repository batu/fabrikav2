import React, { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SpriteAnimationBrowser from '../src/components/SpriteAnimationBrowser';
import '../src/App.css';
import type { DogState, SpriteCandidate } from '../src/types';

const SESSION_ID = 'sprite_refresh_demo';

const baseDogs: DogState[] = [{
    index: 0,
    status: 'generating',
    activeVariant: null,
    promptOverride: null,
    variants: [],
  }];

function Harness() {
  const [dogs, setDogs] = useState<DogState[]>(baseDogs);
  const [inpainting, setInpainting] = useState(true);
  const [selectedAnimationSprite, setSelectedAnimationSprite] = useState<SpriteCandidate | null>(null);

  const handleSelectAnimationSprite = useCallback((candidate: SpriteCandidate | null): void => {
    setSelectedAnimationSprite(candidate);
  }, []);

  const settle = () => {
    setInpainting(false);
    setDogs([{
        index: 0,
        status: 'done',
        activeVariant: 0,
        promptOverride: null,
        variants: ['dogs/dog_00/variant_000.png'],
      }]);
  };

  const refreshCandidates = () => {
    setDogs((current) => (
      current.map((dog) => (
        dog.index === 0
          ? { ...dog, variants: [...dog.variants, 'dogs/dog_00/variant_001.png'] }
          : dog
      ))
    ));
  };

  return (
    <div className="app">
      <button id="settle" type="button" onClick={settle}>Settle Dogs</button>
      <button id="refresh-candidates" type="button" onClick={refreshCandidates}>Refresh Candidates</button>
      <SpriteAnimationBrowser
        sessionId={SESSION_ID}
        dogs={dogs}
        inpainting={inpainting}
        selectedAnimationSprite={selectedAnimationSprite}
        onSelectAnimationSprite={handleSelectAnimationSprite}
      />
    </div>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Missing root');
createRoot(root).render(<Harness />);
