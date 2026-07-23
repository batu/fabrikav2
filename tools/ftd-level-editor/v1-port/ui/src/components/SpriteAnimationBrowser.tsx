import { useEffect, useMemo, useRef, useState } from 'react';
import { listSpriteCandidates } from '../api/editorApi';
import type { DogState, SpriteCandidate } from '../types';
import SpriteAnimationReviewLibrary from './SpriteAnimationReviewLibrary';
import SpriteAnimationWizard from './SpriteAnimationWizard';
import StepHeader from './StepHeader';

interface Props {
  sessionId: string | null;
  dogs: DogState[];
  inpainting: boolean;
  selectedAnimationSprite: SpriteCandidate | null;
  onSelectAnimationSprite: (candidate: SpriteCandidate | null) => void;
}

function spriteLabel(candidate: SpriteCandidate): string {
  return `dog #${candidate.dogIndex} · sprite ${String(candidate.spriteIndex).padStart(3, '0')}`;
}

function candidateImageUrl(sessionId: string, candidate: SpriteCandidate): string | null {
  if (candidate.image === null) return null;
  return `/levels/${sessionId}/${candidate.image}`;
}

function candidateSourceKey(sessionId: string, candidate: SpriteCandidate): string {
  return [
    sessionId,
    candidate.id,
    candidate.image ?? 'no-image',
    candidate.sourceVariant ?? 'no-source',
    candidate.metadataPath ?? 'no-metadata',
    candidate.width ?? 'unknown-width',
    candidate.height ?? 'unknown-height',
  ].join(':');
}

function statusLabel(candidate: SpriteCandidate): string {
  if (candidate.status === 'ready') return 'Ready';
  if (candidate.status === 'missing_image') return 'Missing image';
  if (candidate.status === 'invalid_image') return 'Invalid image';
  if (candidate.status === 'not_pickup_usable') return 'Not usable';
  return 'Invalid metadata';
}

export default function SpriteAnimationBrowser({
  sessionId,
  dogs,
  inpainting,
  selectedAnimationSprite,
  onSelectAnimationSprite,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<SpriteCandidate[]>([]);
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);
  const selectedAnimationSpriteRef = useRef<SpriteCandidate | null>(selectedAnimationSprite);
  const spritesReady =
    dogs.length > 0 &&
    !inpainting &&
    dogs.every(
      (dog) =>
        dog.status === 'done' ||
        dog.status === 'error' ||
        (dog.status === 'generating' && dog.variants.length > 0),
    );
  const candidateRefreshKey = useMemo(
    () => dogs.map((dog) => (
      `${dog.index}:${dog.status}:${dog.activeVariant ?? 'none'}:${dog.variants.length}`
    )).join('|'),
    [dogs],
  );

  useEffect(() => {
    selectedAnimationSpriteRef.current = selectedAnimationSprite;
  }, [selectedAnimationSprite]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (!sessionId || !spritesReady) {
      setCandidates([]);
      onSelectAnimationSprite(null);
      setLoading(false);
      return () => { cancelled = true; };
    }

    setLoading(true);
    listSpriteCandidates(sessionId)
      .then((response) => {
        if (cancelled) return;
        setCandidates(response.candidates);
        const selected = selectedAnimationSpriteRef.current;
        if (selected) {
          const refreshed = response.candidates.find((candidate) => candidate.id === selected.id && candidate.status === 'ready') ?? null;
          onSelectAnimationSprite(refreshed);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [candidateRefreshKey, onSelectAnimationSprite, sessionId, spritesReady]);

  const readyCount = useMemo(
    () => candidates.filter((candidate) => candidate.status === 'ready').length,
    [candidates],
  );
  const selectedId = selectedAnimationSprite?.id ?? null;

  return (
    <div className="step sprite-browser-step">
      <StepHeader
        stepNumber={5}
        title="Sprite Animation Source"
        collapsed={false}
        summary={selectedId ? `Selected ${selectedId}` : `${readyCount}/${candidates.length} ready`}
      />
      <div className="step-content">
        {!sessionId && (
          <div className="sprite-browser-empty">
            Open or generate a session before choosing a sprite to animate.
          </div>
        )}

        {sessionId && !spritesReady && (
          <div className="sprite-browser-empty">
            Finish generating dog sprites before choosing an animation source.
          </div>
        )}

        {sessionId && spritesReady && loading && (
          <div className="sprite-browser-empty">Loading sprite candidates…</div>
        )}

        {sessionId && spritesReady && error && (
          <div className="sprite-browser-error">
            <strong>Could not load sprite candidates.</strong> {error}
          </div>
        )}

        {sessionId && spritesReady && !loading && !error && candidates.length === 0 && (
          <div className="sprite-browser-empty">
            No pickup sprites found for this session yet. Generate dog sprites before starting animation.
          </div>
        )}

        {sessionId && spritesReady && !loading && !error && candidates.length > 0 && (
          <>
            <div className="sprite-browser-summary">
              {readyCount} of {candidates.length} sprite candidate{candidates.length === 1 ? '' : 's'} ready for animation.
            </div>
            <div className="sprite-candidate-grid">
              {candidates.map((candidate) => {
                const ready = candidate.status === 'ready';
                const selected = candidate.id === selectedId;
                const imageUrl = candidateImageUrl(sessionId, candidate);
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    className={`sprite-candidate-card ${selected ? 'selected' : ''} ${ready ? '' : 'disabled'}`}
                    disabled={!ready}
                    onClick={() => onSelectAnimationSprite(candidate)}
                    title={ready ? `Select ${spriteLabel(candidate)}` : candidate.reason ?? statusLabel(candidate)}
                  >
                    <div className="sprite-candidate-thumb">
                      {imageUrl ? (
                        <img src={imageUrl} alt={spriteLabel(candidate)} />
                      ) : (
                        <span>No image</span>
                      )}
                    </div>
                    <div className="sprite-candidate-meta">
                      <strong>{spriteLabel(candidate)}</strong>
                      <span className={`sprite-candidate-status ${ready ? 'ready' : 'invalid'}`}>
                        {statusLabel(candidate)}
                      </span>
                      {candidate.width && candidate.height && (
                        <span>{candidate.width} × {candidate.height}</span>
                      )}
                      {candidate.technique && (
                        <span>{candidate.technique}</span>
                      )}
                      {!ready && candidate.reason && (
                        <span className="sprite-candidate-reason">{candidate.reason}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            {selectedAnimationSprite && (
              <>
                <div className="sprite-browser-selection">
                  Selected {spriteLabel(selectedAnimationSprite)} for the animation wizard.
                </div>
                <SpriteAnimationWizard
                  key={candidateSourceKey(sessionId, selectedAnimationSprite)}
                  sessionId={sessionId}
                  candidate={selectedAnimationSprite}
                  onJobCreated={() => setLibraryRefreshKey((current) => current + 1)}
                />
              </>
            )}
            <SpriteAnimationReviewLibrary
              sessionId={sessionId}
              selectedCandidate={selectedAnimationSprite}
              refreshKey={libraryRefreshKey}
            />
          </>
        )}
      </div>
    </div>
  );
}
