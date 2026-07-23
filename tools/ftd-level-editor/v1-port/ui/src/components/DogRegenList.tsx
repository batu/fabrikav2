import { useCallback, useMemo, useState } from 'react';
import type { DogState, Hitbox } from '../types';
import { regenDog, recompositeSession, setActiveVariant as apiSetActiveVariant, dogVariantUrl, recompositePreviewUrl } from '../api/editorApi';
import { hasActiveVariant } from '../lib/dogs';

/** Compact grid-style per-dog regeneration UI. Each cell shows the PADDED
 *  crop region that will be fed to the model on regen \u2014 the same
 *  region the backend crops at `padding * r` around the hitbox, rendered
 *  here by positioning the session's downscaled composite preview so the
 *  cell shows the crop 1:1 (scaled to cell size).
 *
 *  Selection model: click a cell to toggle it; then press the single
 *  shared "Regenerate selected" button. The prompt comes from the
 *  session recipe. Per-dog regen is always crop-based (padding toggle:
 *  2.75x default / 3x wide crop).
 */

const CELL_SIZE = 150;      // px; card width/height of the crop preview
const CROP_PADDING = 2.75;  // matches backend _crop_box default
const WIDE_CROP_PADDING = 3.0;

interface CellProps {
  sessionId: string;
  bgVersion: number;
  bgWidth: number;
  bgHeight: number;
  dog: DogState;
  hitbox: Hitbox;
  selected: boolean;
  regenerating: boolean;
  padding: number;
  onToggle: () => void;
}

/** Mirror of backend `_crop_box` (dog_pipeline/utils/image_ops.py). Clamps
 *  each axis independently \u2014 edge hitboxes produce non-square boxes
 *  that exactly match what Gemini receives. A prior square-then-shift
 *  implementation here misaligned the dashed overlay at image edges
 *  (todo 005). */
function cropBox(hb: Hitbox, w: number, h: number, padding: number): [number, number, number, number] {
  const halfSide = hb.r * padding;
  const x0 = Math.max(0, Math.floor(hb.x - halfSide));
  const y0 = Math.max(0, Math.floor(hb.y - halfSide));
  const x1 = Math.min(w, Math.ceil(hb.x + halfSide));
  const y1 = Math.min(h, Math.ceil(hb.y + halfSide));
  return [x0, y0, x1, y1];
}

function DogCell({
  sessionId, bgVersion, bgWidth, bgHeight,
  dog, hitbox, selected, regenerating, padding, onToggle,
}: CellProps) {
  const [x0, y0, x1, y1] = useMemo(
    () => (bgWidth > 0 && bgHeight > 0 ? cropBox(hitbox, bgWidth, bgHeight, padding) : [0, 0, 0, 0]),
    [hitbox, bgWidth, bgHeight, padding],
  );
  const boxW = Math.max(1, x1 - x0);
  const boxH = Math.max(1, y1 - y0);
  const scale = CELL_SIZE / Math.max(boxW, boxH);

  // Show the current composite cropped to the padded box through the downscaled
  // preview endpoint, avoiding repeated full-resolution color.png requests.
  const colorUrl = recompositePreviewUrl(sessionId, bgVersion);

  const hasError = dog.status === 'error';

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={regenerating}
      title={`#${dog.index} \u00b7 (${hitbox.x}, ${hitbox.y}) r=${hitbox.r}`}
      style={{
        position: 'relative',
        width: CELL_SIZE,
        height: CELL_SIZE + 24,
        padding: 0,
        border: selected ? '2px solid #6bd96b' : hasError ? '2px solid #c55' : '2px solid #2a2a2a',
        borderRadius: 6,
        background: '#0a0a0a',
        cursor: regenerating ? 'wait' : 'pointer',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          width: CELL_SIZE,
          height: CELL_SIZE,
          backgroundImage: `url("${colorUrl}")`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: `${bgWidth * scale}px ${bgHeight * scale}px`,
          backgroundPosition: `-${x0 * scale}px -${y0 * scale}px`,
          position: 'relative',
        }}
      >
        {/* Hitbox circle overlay (visual aid — shows the tight radius inside the padded crop). */}
        <div
          style={{
            position: 'absolute',
            left: (hitbox.x - hitbox.r - x0) * scale,
            top: (hitbox.y - hitbox.r - y0) * scale,
            width: hitbox.r * 2 * scale,
            height: hitbox.r * 2 * scale,
            borderRadius: '50%',
            border: '1px dashed rgba(255,255,255,0.55)',
            pointerEvents: 'none',
          }}
        />
        {regenerating && selected && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.55)',
            color: '#fff', fontSize: '0.7rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{'regenerating\u2026'}</div>
        )}
      </div>
      <div style={{
        fontSize: '0.65rem',
        color: hasError ? '#ff8080' : '#888',
        padding: '4px 6px',
        textAlign: 'left',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        #{dog.index} {'\u00b7'} v{dog.variants.length} {hasError && '\u00b7 err'}
      </div>
    </button>
  );
}

interface ListProps {
  sessionId: string;
  sharedPrompt: string;
  inpaintModel: string;
  bgWidth: number;
  bgHeight: number;
  dogs: DogState[];
  hitboxes: Hitbox[];
  onDogComplete: (dogIndex: number, file: string, variantIndex: number) => void;
  onActiveVariantChange: (dogIndex: number, variantIndex: number | null) => void;
}

export default function DogRegenList({
  sessionId,
  sharedPrompt,
  inpaintModel,
  bgWidth,
  bgHeight,
  dogs,
  hitboxes,
  onDogComplete,
  onActiveVariantChange,
}: ListProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [regenerating, setRegenerating] = useState(false);
  const [useWideCrop, setUseWideCrop] = useState(false);
  const [bgVersion, setBgVersion] = useState(0);
  const [errors, setErrors] = useState<Record<number, string>>({});

  // Join hitboxes BY STABLE ID, positional fallback for legacy id-less rows
  // (self-verified from the 2026-06-10 fresh review's unverified pool): after
  // a delete-by-id the hitbox array COMPACTS while dog.index keeps its
  // original value, so `hitboxes[d.index]` mis-associated coordinates and
  // dropped every post-gap dog from this review list entirely.
  const hitboxForDog = (d: (typeof dogs)[number]) =>
    (d.id ? hitboxes.find((h) => h.id === d.id) : undefined) ?? hitboxes[d.index];
  const visibleDogs = dogs.filter(
    (d) => (d.status === 'pending' || d.status === 'done' || d.status === 'error') && hitboxForDog(d) !== undefined,
  );

  const toggle = useCallback((idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(visibleDogs.map((d) => d.index)));
  }, [visibleDogs]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const handleRegen = useCallback(async () => {
    if (regenerating || selected.size === 0) return;
    setRegenerating(true);
    setErrors({});
    const padding = useWideCrop ? WIDE_CROP_PADDING : CROP_PADDING;
    try {
      const selectedIndices = [...selected];
      const results: Array<{ status: 'fulfilled'; value: number } | { status: 'rejected'; reason: unknown }> = [];
      for (const idx of selectedIndices) {
        try {
          const out = await regenDog(sessionId, idx, sharedPrompt, padding, inpaintModel, true);
          onDogComplete(idx, out.file, out.variantIndex);
          results.push({ status: 'fulfilled', value: idx });
        } catch (reason) {
          results.push({ status: 'rejected', reason });
        }
      }
      if (results.some((r) => r.status === 'fulfilled')) {
        await recompositeSession(sessionId);
      }
      const errMap: Record<number, string> = {};
      results.forEach((r, i) => {
        const idx = selectedIndices[i];
        if (r.status === 'rejected') {
          const e = r.reason as { detail?: { error?: string }; message?: string };
          errMap[idx] = e?.detail?.error ?? e?.message ?? String(r.reason);
        }
      });
      if (Object.keys(errMap).length) setErrors(errMap);
      setBgVersion((v) => v + 1);
      // Clear selections for the ones that succeeded.
      setSelected((prev) => {
        const next = new Set(prev);
        results.forEach((r) => {
          if (r.status === 'fulfilled') next.delete(r.value);
        });
        return next;
      });
    } finally {
      setRegenerating(false);
    }
  }, [selected, regenerating, useWideCrop, sessionId, sharedPrompt, inpaintModel, onDogComplete]);

  // Keep the active-variant click affordance (users still want to pick a
  // prior variant sometimes). Render a compact variants strip BELOW the
  // grid for any dog that has a variant and is currently selected.
  const selectedDogsWithVariants = visibleDogs.filter(
    (d) => selected.has(d.index) && d.variants.length > 0,
  );

  const handleVariantSelect = useCallback(async (dogIndex: number, variantIndex: number | null) => {
    onActiveVariantChange(dogIndex, variantIndex);
    try {
      await apiSetActiveVariant(sessionId, dogIndex, variantIndex);
      setBgVersion((v) => v + 1);
    } catch {
      // Best-effort; the reducer already moved the cursor.
    }
  }, [onActiveVariantChange, sessionId]);

  if (visibleDogs.length === 0) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Per-dog regeneration <span style={{ fontSize: '0.8rem', color: '#888', fontWeight: 'normal' }}>(crop-based, recipe prompt)</span></h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: '#888', fontSize: '0.8rem' }}>{selected.size}/{visibleDogs.length} selected</span>
          <button type="button" className="btn-link" onClick={selectAll} disabled={regenerating}>Select all</button>
          <button type="button" className="btn-link" onClick={clearSelection} disabled={regenerating || selected.size === 0}>Clear</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85rem', color: '#ccc' }}>
            <input type="checkbox" checked={useWideCrop} onChange={(e) => setUseWideCrop(e.target.checked)} disabled={regenerating} />
            Wide crop (3{'\u00d7'})
          </label>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleRegen}
            disabled={regenerating || selected.size === 0}
            title="Regenerate every selected dog using the session recipe prompt. Per-dog regen is always crop-based."
          >
            {regenerating ? `Regenerating\u2026 (${selected.size})` : `Regenerate selected (${selected.size})`}
          </button>
        </div>
      </div>
      <p style={{ fontSize: '0.8rem', color: '#888', marginBottom: 8 }}>
        Each cell shows the padded crop region that will be fed to the model.
        Dashed circle = hitbox radius.
      </p>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${CELL_SIZE}px, ${CELL_SIZE}px))`,
        gap: 10,
      }}>
        {visibleDogs.map((dog) => (
          <DogCell
            key={dog.index}
            sessionId={sessionId}
            bgVersion={bgVersion}
            bgWidth={bgWidth}
            bgHeight={bgHeight}
            dog={dog}
            hitbox={hitboxForDog(dog)!}
            selected={selected.has(dog.index)}
            regenerating={regenerating}
            padding={useWideCrop ? WIDE_CROP_PADDING : CROP_PADDING}
            onToggle={() => toggle(dog.index)}
          />
        ))}
      </div>

      {Object.keys(errors).length > 0 && (
        <div style={{
          marginTop: 10, padding: '8px 10px',
          background: '#2a1010', border: '1px solid #7a1f1f', borderRadius: 6,
          color: '#ffb4b4', fontSize: '0.8rem',
        }}>
          <strong>Regeneration errors:</strong>
          <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
            {Object.entries(errors).map(([idx, msg]) => (
              <li key={idx} style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>#{idx}: {msg}</li>
            ))}
          </ul>
        </div>
      )}

      {selectedDogsWithVariants.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: 6 }}>
            Variants for selected dogs {'\u2014'} keep a thumbnail or exclude the dog from the playable level.
          </div>
          {selectedDogsWithVariants.map((dog) => {
            const hasVariant = hasActiveVariant(dog);
            return (
            <div key={dog.index} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', color: '#888', fontFamily: 'monospace', minWidth: 40 }}>#{dog.index}</span>
              <button
                type="button"
                onClick={() => handleVariantSelect(dog.index, null)}
                disabled={regenerating}
                style={{
                  minHeight: 44,
                  padding: '0 10px',
                  border: !hasVariant ? '2px solid #6b6' : '2px solid #333',
                  borderRadius: 4,
                  background: !hasVariant ? '#172417' : '#181818',
                  color: !hasVariant ? '#bdf3bd' : '#aaa',
                  cursor: regenerating ? 'wait' : 'pointer',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                }}
                title="Exclude this dog from the playable level"
              >
                Exclude
              </button>
              {dog.variants.map((variantPath, vIdx) => (
                <button
                  key={variantPath}
                  type="button"
                  onClick={() => handleVariantSelect(dog.index, vIdx)}
                  disabled={regenerating}
                  style={{
                    padding: 0,
                    border: vIdx === dog.activeVariant ? '2px solid #6b6' : '2px solid #333',
                    borderRadius: 4,
                    background: 'transparent',
                    cursor: regenerating ? 'wait' : 'pointer',
                  }}
                  title={`variant_${String(vIdx).padStart(3, '0')}`}
                >
                  <img
                    src={dogVariantUrl(sessionId, variantPath)}
                    alt={`Variant ${vIdx}`}
                    style={{ width: 44, height: 44, objectFit: 'cover', display: 'block' }}
                  />
                </button>
              ))}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
