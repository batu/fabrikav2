import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import LevelCanvas, { type LevelCanvasState, type CanvasMutation } from './LevelCanvas';
import DogStrip from './DogStrip';
import DogRail from './DogRail';
import { useSessionQuery, sessionQueryKey } from '../api/useSessionQuery';
import { bgPreviewUrl, saveHitboxes, deleteDogById, setActiveVariantById, regenDogById } from '../api/editorApi';
import { newDogId } from '../lib/dogIdentity';
import type { Hitbox, SessionResponse } from '../types';

// Client-only render defaults (not on the wire — see SessionResponse). radius
// drives NEW placement; inpaintPadding sizes the dashed crop boxes. Both become
// real client state when the per-dog control rail lands (later slice).
const DEFAULT_RADIUS = 50;
const DEFAULT_INPAINT_PADDING = 2.75;
const SAVE_DEBOUNCE_MS = 400;

interface Props {
  sessionId: string | null;
}

/**
 * DogsCanvas — the B2 merged surface (plan -001, spec -004). **SLICE 1c/1d.**
 * The first real `useSessionQuery` render consumer AND the first stable-id
 * mutation path: place / select / drag-move a hitbox, addressed by stable id,
 * persisted via the reconcile-by-id save (Slice 1a). Moving dog 7 patches ONLY
 * dog 7 by id — every neighbor stays byte-identical on disk.
 *
 * Query-backed dog placement surface embedded in the wizard place step.
 */
export default function DogsCanvas({ sessionId }: Props) {
  const queryClient = useQueryClient();
  const { data: session, isLoading, error } = useSessionQuery(sessionId);
  // Selection is by STABLE ID, not array position (review P1 #3): after a delete
  // tombstone gap the array position and dog.index diverge, so an index-keyed
  // selection would target the WRONG dog in the rail/regen (incl a PAID regen).
  const [selectedDogId, setSelectedDogId] = useState<string | null>(null);
  // SET, not a single slot: regens take ~30s, so "regen A → select B → regen B"
  // overlaps; a single slot let A's settle clear B's in-flight flag and
  // re-enable B's PAID Regen button mid-flight (fresh-review P1 — ledger 054 #5).
  const [regeneratingDogIds, setRegeneratingDogIds] = useState<ReadonlySet<string>>(new Set());

  // Debounced hitbox save (the only persistence path this slice). The latest
  // pending array flushes on a trailing timer AND on unmount/navigation-away so
  // an edit is never lost when leaving the tab.
  const pendingSaveRef = useRef<Hitbox[] | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  // The last DISPATCHED save POST. flushSave() only covers the pending-timer
  // window — once the timer fires, the in-flight POST was invisible to the
  // "land the move before X" barriers (fresh-review P2 — ledger 054 #6, #7).
  // Kept pre-swallowed so barrier composition can't unhandled-reject.
  const inflightSaveRef = useRef<Promise<unknown>>(Promise.resolve());
  // Ids with a DELETE in flight. SYNCHRONOUS (unlike LevelCanvas's passive
  // hitboxesRef sync), so a rapid REPEAT gesture before the optimistic prune
  // propagates can't (a) re-emit a redundant DELETE that 404s + toasts, nor
  // (b) mis-fire as a stray 'add' at the just-deleted spot (final-rereview iter6).
  const deletingIdsRef = useRef<Set<string>>(new Set());

  const flushSave = useCallback((): Promise<void> => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const hitboxes = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (hitboxes && sessionId) {
      // Returns the POST promise so an invalidate-bearing mutation can wait for
      // the move to land before refetching (otherwise the refetch reverts the
      // not-yet-saved move — rereview round-1 P2 #3). The server reconciles by id
      // so a stale id-less echo can never re-stamp a sibling.
      const post = saveHitboxes(sessionId, hitboxes, 'edit');
      inflightSaveRef.current = post.catch(() => {});
      return post;
    }
    return Promise.resolve();
  }, [sessionId]);

  // Barrier: every hitbox save is fully LANDED — both the pending-timer window
  // (flushSave) and an already-dispatched in-flight POST (ledger 054 #6, #7).
  // Never rejects (in-flight is pre-swallowed; flush errors toast in request()).
  const settleSaves = useCallback(
    (): Promise<unknown> => Promise.allSettled([inflightSaveRef.current, flushSave()]),
    [flushSave],
  );

  const scheduleSave = useCallback(
    (hitboxes: Hitbox[]) => {
      pendingSaveRef.current = hitboxes;
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(flushSave, SAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  // Flush any pending edit when DogsCanvas unmounts (tab switch / New Level).
  // `void` so the cleanup returns void, not the flush promise.
  useEffect(() => () => { void flushSave(); }, [flushSave]);

  const handleMutate = useCallback(
    async (m: CanvasMutation) => {
      if (m.type === 'select') {
        setSelectedDogId(m.dogId);
        return;
      }
      if (m.type === 'remove') {
        // DELETE-by-id (Slice 4). Legacy id-less hitboxes can't be addressed —
        // the banner warns; no-op rather than fall into a positional delete.
        if (!sessionId || !m.dogId) return;
        const dogId = m.dogId;
        // Suppress a rapid REPEAT dblclick on the same dog: the 2nd gesture hit-
        // tests LevelCanvas's not-yet-synced (passive-effect) hitbox ref and re-
        // emits remove, which would 404 + toast (final-rereview iter6). Synchronous
        // membership check closes the window before the optimistic prune commits.
        if (deletingIdsRef.current.has(dogId)) return;
        deletingIdsRef.current.add(dogId);
        // Cancel any in-flight refetch (a variant-pick/regen invalidate) BEFORE
        // the optimistic prune, so it can't land afterward and reintroduce the
        // dog we're deleting (final-rereview iter4 P1 — the standard optimistic-
        // update guard, previously missing everywhere in src/).
        await queryClient.cancelQueries({ queryKey: sessionQueryKey(sessionId) });
        const current = queryClient.getQueryData<SessionResponse>(sessionQueryKey(sessionId));
        if (!current) {
          deletingIdsRef.current.delete(dogId); // don't leave the id stuck (it would suppress all future deletes)
          return;
        }
        // Stop any pending save (it holds the PRE-delete array incl the deleted
        // id). After the DELETE lands we re-save from the LIVE cache (final-
        // rereview iter3 P2) — NOT a snapshot captured here, which would clobber a
        // sibling move made DURING the delete round-trip. The live cache already
        // has the deleted id pruned (the optimistic write below) AND reflects any
        // concurrent move, so the re-save preserves it, can't resurrect the id,
        // and is sequenced after the DELETE so it can't 404 it.
        // Capture (not just flag) the pending array: on a FAILED delete the dog
        // still exists server-side, and the captured body — which carries both
        // the un-deleted dog and any move made in the debounce window — is the
        // correct state to re-save. Discarding it silently lost those moves
        // (fresh-review P2 — ledger 054 #8).
        const capturedPending = pendingSaveRef.current;
        const hadPendingSave = capturedPending !== null;
        if (saveTimerRef.current !== null) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        pendingSaveRef.current = null;
        // Optimistic removal of the hitbox + dog by id, then persist; re-sync to
        // server truth on settle (the server recomposite is authoritative).
        queryClient.setQueryData<SessionResponse>(sessionQueryKey(sessionId), {
          ...current,
          hitboxes: current.hitboxes.filter((h) => h.id !== dogId),
          dogs: current.dogs.filter((d) => d.id !== dogId),
        });
        setSelectedDogId(null);
        void (async () => {
          try {
            await deleteDogById(sessionId, dogId);
            // Only if a save was actually pending (a move would otherwise be lost
            // to the timer-cancel above). Re-save from the LIVE cache (preserves a
            // concurrent sibling move), but ALWAYS filter the deleted id out
            // (final-rereview iter4 P1): even if a racing refetch reintroduced it,
            // the re-save body can never carry it — resurrection is impossible by
            // construction.
            if (hadPendingSave) {
              const live = queryClient.getQueryData<SessionResponse>(sessionQueryKey(sessionId));
              const pruned = (live?.hitboxes ?? []).filter((h) => h.id !== dogId);
              if (pruned.length) await saveHitboxes(sessionId, pruned, 'edit');
            }
          } catch {
            // Delete FAILED — the dog still exists server-side. Re-save the
            // captured pre-delete pending array so a move made in the debounce
            // window isn't silently dropped with it (ledger 054 #8). The error
            // toast is already dispatched in request(); swallowing here also
            // avoids the iter7-P3 unhandledrejection.
            if (capturedPending) {
              await saveHitboxes(sessionId, capturedPending, 'edit').catch(() => {});
            }
          } finally {
            deletingIdsRef.current.delete(dogId);
            queryClient.invalidateQueries({ queryKey: sessionQueryKey(sessionId) });
          }
        })();
        return;
      }
      if (!sessionId) return;
      // Same optimistic-update guard the delete branch got (final-rereview
      // iter4): without it an in-flight refetch (from a variant-pick/regen
      // invalidate) can land AFTER the optimistic move/add write and visually
      // revert an edit that DID persist, with no later reconciliation
      // (fresh-review P2 — ledger 054 #9).
      await queryClient.cancelQueries({ queryKey: sessionQueryKey(sessionId) });
      const current = queryClient.getQueryData<SessionResponse>(sessionQueryKey(sessionId));
      if (!current) return;

      let nextHitboxes: Hitbox[];
      if (m.type === 'move') {
        // Match by stable id (fallback to index on legacy id-less hitboxes) and
        // patch ONLY that dog's geometry — neighbors are referentially unchanged.
        nextHitboxes = current.hitboxes.map((h, i) =>
          (m.dogId ? h.id === m.dogId : i === m.index) ? { ...h, x: m.x, y: m.y } : h,
        );
      } else {
        // Suppress a stray 'add' fired by a rapid repeat gesture at a JUST-deleted
        // spot while its DELETE is still settling — the hit-test missed the
        // not-yet-synced hitbox and fell through to add (final-rereview iter6).
        if (deletingIdsRef.current.size > 0) return;
        // New placement mints a client-side stable id from gesture-zero (§6.4).
        nextHitboxes = [...current.hitboxes, { ...m.hitbox, id: newDogId() }];
      }

      // Optimistic cache write (instant feel) + debounced persist.
      queryClient.setQueryData<SessionResponse>(sessionQueryKey(sessionId), {
        ...current,
        hitboxes: nextHitboxes,
      });
      scheduleSave(nextHitboxes);
    },
    [queryClient, sessionId, scheduleSave],
  );

  // Per-dog rail action: pick a variant or exclude (variantIndex null) BY ID.
  // Optimistic dog-state patch + the by-id active route (server recomposites);
  // re-sync to server truth on settle.
  const handleSetVariant = useCallback(
    (variantIndex: number | null) => {
      if (!sessionId || !selectedDogId) return;
      const current = queryClient.getQueryData<SessionResponse>(sessionQueryKey(sessionId));
      if (!current) return;
      const dog = current.dogs.find((d) => d.id === selectedDogId);
      if (!dog) return;
      const dogId = selectedDogId;
      queryClient.setQueryData<SessionResponse>(sessionQueryKey(sessionId), {
        ...current,
        dogs: current.dogs.map((d) => (d.id === dogId ? { ...d, activeVariant: variantIndex } : d)),
      });
      // Land any pending AND in-flight move save first; invalidate only after
      // BOTH that and the active POST settle (rereview round-1 P2 #3; in-flight
      // window: ledger 054 #6) — otherwise this invalidate's refetch reverts the
      // not-yet-saved move on screen.
      void Promise.allSettled([
        settleSaves(),
        setActiveVariantById(sessionId, dogId, variantIndex),
      ]).then(() => {
        queryClient.invalidateQueries({ queryKey: sessionQueryKey(sessionId) });
      });
    },
    [queryClient, sessionId, selectedDogId, settleSaves],
  );

  // Re-inpaint the selected dog BY ID (paid). The regen route composites
  // server-side (~30s); the rail shows an in-flight state and we invalidate on
  // settle so the new variant appears.
  const handleRegen = useCallback(() => {
    if (!sessionId || !selectedDogId) return;
    const current = queryClient.getQueryData<SessionResponse>(sessionQueryKey(sessionId));
    if (!current) return;
    const dog = current.dogs.find((d) => d.id === selectedDogId);
    if (!dog) return;
    const prompt = (current.dogPrompt || '').trim() || 'a small hidden dog matching the scene art style';
    const dogId = selectedDogId;
    setRegeneratingDogIds((prev) => new Set(prev).add(dogId));
    // Land any pending AND in-flight move save BEFORE firing the PAID regen —
    // firing them concurrently let the server crop at the pre-drag coordinates
    // (fresh-review P2 — ledger 054 #7). settleSaves never rejects.
    void settleSaves()
      .then(() => regenDogById(sessionId, dogId, prompt))
      .finally(() => {
        setRegeneratingDogIds((prev) => {
          const next = new Set(prev);
          next.delete(dogId);
          return next;
        });
        queryClient.invalidateQueries({ queryKey: sessionQueryKey(sessionId) });
      })
      .catch(() => {}); // toast already dispatched in request(); avoid unhandledrejection (iter7 P3)
  }, [queryClient, sessionId, selectedDogId, settleSaves]);

  const canvasState = useMemo<LevelCanvasState | null>(() => {
    if (!session) return null;
    // The canvas highlights by ARRAY POSITION; resolve the selected stable id to
    // its current hitbox position (so a tombstone gap doesn't highlight the wrong
    // circle). The rail/regen/variant address by id directly (above).
    const selPos = selectedDogId ? session.hitboxes.findIndex((h) => h.id === selectedDogId) : -1;
    return {
      sessionId: session.id,
      bgWidth: session.bgWidth,
      bgHeight: session.bgHeight,
      selectedBgIndex: session.selectedBgIndex,
      orientation: session.orientation,
      sections: session.sections,
      hitboxes: session.hitboxes,
      dogs: session.dogs,
      selectedDogIndex: selPos >= 0 ? selPos : null,
      showOverlay: true,
      radius: DEFAULT_RADIUS,
      inpaintPadding: DEFAULT_INPAINT_PADDING,
    };
  }, [session, selectedDogId]);

  if (!sessionId) {
    return (
      <div className="dogs-canvas-msg" data-testid="dogs-canvas-empty">
        Load a level first (Gallery → open, or finish the wizard), then return to this tab.
      </div>
    );
  }
  if (error) {
    return (
      <div className="dogs-canvas-msg" data-testid="dogs-canvas-error">
        Failed to load level: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }
  if (isLoading || !canvasState || !session) {
    return (
      <div className="dogs-canvas-msg" data-testid="dogs-canvas-loading">
        <div className="loading-spinner" />
        Loading level…
      </div>
    );
  }

  const total = session.hitboxes.length;
  const withId = session.hitboxes.filter((h) => h.id).length;
  const legacyCount = total - withId;
  const selectedDog = selectedDogId
    ? session.dogs.find((d) => d.id === selectedDogId) ?? null
    : null;

  return (
    <div className="dogs-canvas" data-testid="dogs-canvas">
      <div className="dogs-canvas-bar">
        <strong>Dogs canvas</strong>
        <span className="dogs-canvas-sub" data-testid="dogs-canvas-summary">
          {total} hitboxes · {session.dogs.length} dogs · drag to move
        </span>
        {legacyCount > 0 && (
          <span className="dogs-canvas-legacy" data-testid="dogs-canvas-legacy-banner">
            ⚠ {legacyCount} id-less hitbox{legacyCount === 1 ? '' : 'es'} (positional identity) —
            deletes may shift siblings until this level is backfilled.
          </span>
        )}
      </div>
      <div
        className="dogs-canvas-stage"
        style={{ maxWidth: session.orientation === 'landscape' ? 960 : 460, width: '100%', margin: '0 auto' }}
      >
        <LevelCanvas
          state={canvasState}
          dispatch={() => {}}
          onMutate={handleMutate}
          showLabels={false}
          backgroundOverride={bgPreviewUrl(session.id)}
        />
      </div>
      {selectedDog && (
        <DogRail
          sessionId={session.id}
          dog={selectedDog}
          onPick={handleSetVariant}
          onRegen={handleRegen}
          regenerating={!!selectedDog.id && regeneratingDogIds.has(selectedDog.id)}
        />
      )}
      <DogStrip
        sessionId={session.id}
        dogs={session.dogs}
        selectedDogId={selectedDogId}
        onSelect={setSelectedDogId}
      />
    </div>
  );
}
