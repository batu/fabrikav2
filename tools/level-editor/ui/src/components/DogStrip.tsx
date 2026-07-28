import { memo } from 'react';
import { dogVariantUrl } from '../api/editorApi';
import { hasActiveVariant } from '../lib/dogs';
import type { DogState } from '../types';

interface CellProps {
  sessionId: string;
  dog: DogState;
  selected: boolean;
  onSelect: (dogId: string | null) => void;
}

/**
 * One dog in the strip — its painted cutout (or a status placeholder), the human
 * "dog N" label (the stable creation ordinal, the label that replaces the canvas
 * hex), and a status color. Memoized: re-renders only when THIS dog's data or
 * selection changes, so a sibling completing (or a hitbox move that leaves the
 * dogs array referentially stable) doesn't re-render or re-fetch this cell
 * (spec -004 §5.2).
 */
const DogStripCell = memo(function DogStripCell({ sessionId, dog, selected, onSelect }: CellProps) {
  const variant = hasActiveVariant(dog) ? dog.variants[dog.activeVariant] : undefined;
  const thumbUrl = variant ? dogVariantUrl(sessionId, variant) : null;
  // "done but no active variant" = excluded from the level (a deliberate choice),
  // distinct from "pending/never painted" (has variants on disk but none active).
  const excluded = dog.status === 'done' && !hasActiveVariant(dog) && dog.variants.length > 0;
  const placeholder = excluded ? '∅' : dog.status === 'error' ? '⚠' : dog.status === 'generating' ? '…' : '·';
  return (
    <button
      type="button"
      className={`dog-strip-cell dog-status-${dog.status}${selected ? ' selected' : ''}${excluded ? ' excluded' : ''}`}
      // Legacy id-less dogs are NOT selectable (the rail addresses by id) — and
      // clicking one must NEVER clear an existing selection (re-review new P1):
      // guard so a null id can't reach setSelectedDogId(null).
      disabled={!dog.id}
      onClick={() => { if (dog.id) onSelect(dog.id); }}
      title={dog.id
        ? `dog ${dog.index} — ${excluded ? 'excluded from level' : dog.status}${dog.error ? `: ${dog.error}` : ''}`
        : `dog ${dog.index} — legacy (no stable id); backfill to edit`}
      data-testid={`dog-strip-cell-${dog.index}`}
    >
      <span className="dog-strip-thumb">
        {thumbUrl ? (
          <img src={thumbUrl} alt={`dog ${dog.index}`} loading="lazy" />
        ) : (
          <span className="dog-strip-placeholder">{placeholder}</span>
        )}
      </span>
      <span className="dog-strip-label">{excluded ? 'excluded' : `dog ${dog.index}`}</span>
    </button>
  );
});

interface Props {
  sessionId: string;
  dogs: DogState[];
  selectedDogId: string | null;
  onSelect: (dogId: string | null) => void;
}

/**
 * The streaming dog strip (spec -004 §1.2): one cell per dog, ordered by stable
 * creation index, keyed by stable id. SLICE 3 (read-only): renders each dog's
 * current status + cutout from the session query. The live run bar (fixed
 * denominator from job rows) and the active-run streaming-fill land with the
 * job-rows query in a later slice.
 */
export default function DogStrip({ sessionId, dogs, selectedDogId, onSelect }: Props) {
  if (dogs.length === 0) return null;
  const ordered = [...dogs].sort((a, b) => a.index - b.index);
  const done = dogs.filter((d) => d.status === 'done').length;
  return (
    <div className="dog-strip-wrap" data-testid="dog-strip">
      <div className="dog-strip-head">
        <span className="dog-strip-count">{done}/{dogs.length} painted</span>
      </div>
      <div className="dog-strip">
        {ordered.map((dog) => (
          <DogStripCell
            key={dog.id ?? dog.index}
            sessionId={sessionId}
            dog={dog}
            selected={selectedDogId != null && dog.id === selectedDogId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
