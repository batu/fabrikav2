import { dogVariantUrl } from '../api/editorApi';
import { hasActiveVariant } from '../lib/dogs';
import type { DogState } from '../types';

interface Props {
  sessionId: string;
  dog: DogState;
  /** variantIndex to make active, or null to EXCLUDE the dog from the level. */
  onPick: (variantIndex: number | null) => void;
  /** Re-inpaint THIS dog (paid). */
  onRegen: () => void;
  /** True while this dog's regen is in flight (~30s). */
  regenerating: boolean;
}

/**
 * Per-dog control rail (spec -004 §1.4) — the keyless half: shown for the
 * selected dog, it picks which painted variant is active or EXCLUDES the dog
 * from the level (a first-class exclude = activeVariant null, not a delete).
 * Both go through the by-id active route + server recomposite. Regen (paid) and
 * the full rail land with Slice 5/6.
 */
export default function DogRail({ sessionId, dog, onPick, onRegen, regenerating }: Props) {
  const excluded = !hasActiveVariant(dog);
  return (
    <div className="dog-rail" data-testid="dog-rail">
      <div className="dog-rail-head">
        <strong>dog {dog.index}</strong>
        <span className={`dog-status dog-status-${dog.status}`}>{dog.status}</span>
        {excluded && dog.variants.length > 0 && (
          <span className="dog-rail-excluded" data-testid="dog-rail-excluded">excluded from level</span>
        )}
        <button
          type="button"
          className="dog-rail-regen"
          onClick={onRegen}
          disabled={regenerating}
          title="Re-inpaint this dog (paid)"
          data-testid="dog-rail-regen"
        >
          {regenerating ? 'Regenerating…' : '↻ Regen'}
        </button>
      </div>
      {dog.variants.length === 0 ? (
        <span className="dog-rail-novariant">No painted variant yet.</span>
      ) : (
        <div className="dog-rail-variants">
          {dog.variants.map((variant, i) => (
            <button
              key={variant}
              type="button"
              className={`dog-rail-variant${dog.activeVariant === i ? ' active' : ''}`}
              onClick={() => onPick(i)}
              title={`Use variant ${i}`}
              data-testid={`dog-rail-variant-${i}`}
            >
              <img src={dogVariantUrl(sessionId, variant)} alt={`variant ${i}`} loading="lazy" />
            </button>
          ))}
          <button
            type="button"
            className={`dog-rail-exclude${excluded ? ' active' : ''}`}
            onClick={() => onPick(null)}
            title="Exclude this dog from the level"
            data-testid="dog-rail-exclude"
          >
            ✕ exclude
          </button>
        </div>
      )}
    </div>
  );
}
