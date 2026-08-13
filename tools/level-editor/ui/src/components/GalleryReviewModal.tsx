import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ConfigResponse, DogState, Hitbox, LevelSection, Orientation, SessionResponse } from '../types';
import {
  ApiError,
  getSession,
  getFinalCutoutReviewReadiness,
  autoPlaceHitboxes,
  rerunStale,
  runGeometryOperation,
  saveHitboxes,
  setArchived as apiSetArchived,
  setFinalCutoutApproval,
  setHitboxApproval,
  type SessionListItem,
  checkMobileVisibility,
  type VisibilityIssue,
} from '../api/editorApi';
import { blockingVisibilitySummaries, summarizeVisibilityIssues, visibilitySummaryLabel } from '../lib/visibilityWarnings';
import LevelCanvas, { type LevelCanvasAction, type LevelCanvasState } from './LevelCanvas';
import CutoutReviewPanel from './CutoutReviewPanel';

const PREVIEW_IMAGE_CACHE_LIMIT = 8;

function conflictRevision(error: unknown): string | undefined {
  if (!(error instanceof ApiError) || error.status !== 409 || !error.detail || typeof error.detail !== 'object') return undefined;
  const outer = error.detail as Record<string, unknown>;
  const detail = outer.detail && typeof outer.detail === 'object' ? outer.detail as Record<string, unknown> : outer;
  return typeof detail.actualContentRevision === 'string' ? detail.actualContentRevision : undefined;
}

export type ReviewCardState = 'background' | 'inpainted' | 'exported';

/** One card per (session × variant) — matches `GalleryPage.VariantCard`. */
export interface ReviewCard {
  id: string;                      // `${session.id}::${variant}`
  session: SessionListItem;
  variant: string;
  state: ReviewCardState;
  archived: boolean;
}

export function sessionCreatedAtMs(session: SessionListItem): number {
  const parsed = Date.parse(session.createdAt ?? '');
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function compareCards(a: ReviewCard, b: ReviewCard): number {
  const createdDelta = sessionCreatedAtMs(b.session) - sessionCreatedAtMs(a.session);
  if (createdDelta !== 0) return createdDelta;
  if (a.session.id !== b.session.id) return a.session.id.localeCompare(b.session.id);
  return a.variant.localeCompare(b.variant);
}

function nextNavigableCardId(cards: ReviewCard[], currentCardId: string, delta: 1 | -1): string | null {
  // No wrap-around: navigation stops at the ends so the reviewer knows
  // where the collection begins and finishes (2026-08-06 review feedback).
  if (cards.length === 0 || !cards.some((c) => !c.archived)) return null;
  const startIdx = Math.max(0, cards.findIndex((c) => c.id === currentCardId));
  for (let idx = startIdx + delta; idx >= 0 && idx < cards.length; idx += delta) {
    const candidate = cards[idx];
    if (candidate && !candidate.archived) return candidate.id;
  }
  return null;
}

function adjacentNavigableCards(cards: ReviewCard[], currentCardId: string): ReviewCard[] {
  const ids = [
    nextNavigableCardId(cards, currentCardId, -1),
    nextNavigableCardId(cards, currentCardId, 1),
  ];
  const seen = new Set<string>();
  const adjacent: ReviewCard[] = [];
  for (const id of ids) {
    if (id === null || id === currentCardId || seen.has(id)) continue;
    const card = cards.find((c) => c.id === id);
    if (!card) continue;
    seen.add(id);
    adjacent.push(card);
  }
  return adjacent;
}

interface Props {
  /** All variant cards for the current gallery result set. Arrow navigation
   *  skips archived cards across the filtered collection. */
  cards: ReviewCard[];
  startCardId: string;
  config: ConfigResponse;
  onClose: () => void;
  onArchivedChanged: (id: string, archived: boolean, variant?: string) => void;
  onReviewChanged: (id: string, patch: Partial<SessionListItem>) => void;
}

function variantPreviewUrl(session: SessionListItem, variant: string, version: number): string {
  return `/api/sessions/${encodeURIComponent(session.id)}/gallery-preview/${encodeURIComponent(variant)}?v=${version}`;
}

interface ModalState extends LevelCanvasState {
  dogPrompt: string;
  inpaintModel: string;
  orientation: Orientation;
  sections: LevelSection[];
  dogs: DogState[];
  contentRevision?: string;
  operationalRevision?: string;
}

function initialModalState(): ModalState {
  return {
    sessionId: null,
    orientation: 'portrait',
    sections: [],
    selectedBgIndex: null,
    bgWidth: 0,
    bgHeight: 0,
    hitboxes: [],
    selectedDogIndex: null,
    dogs: [],
    dogPrompt: '',
    radius: 30,
    inpaintPadding: 2.75,
    showOverlay: true,
    inpaintModel: '',
  };
}

type ModalAction =
  | { type: 'LOAD_SESSION'; session: SessionResponse }
  | { type: 'ADD_HITBOX'; hitbox: Hitbox }
  | { type: 'MOVE_HITBOX'; index: number; x: number; y: number }
  | { type: 'REMOVE_HITBOX'; index: number }
  | { type: 'SELECT_DOG'; index: number | null }
  | { type: 'SET_RADIUS'; radius: number }
  | { type: 'TOGGLE_OVERLAY' }
  | { type: 'SET_HITBOXES'; hitboxes: Hitbox[] }
  | { type: 'SET_REVISIONS'; contentRevision?: string; operationalRevision?: string };

type ModalCanvasAction = Extract<
  ModalAction,
  | { type: 'ADD_HITBOX' }
  | { type: 'MOVE_HITBOX' }
  | { type: 'REMOVE_HITBOX' }
  | { type: 'SELECT_DOG' }
>;

function reducer(state: ModalState, action: ModalAction): ModalState {
  switch (action.type) {
    case 'LOAD_SESSION': {
      const s = action.session;
      return {
        ...state,
        sessionId: s.id,
        orientation: s.orientation,
        sections: s.sections,
        selectedBgIndex: s.selectedBgIndex,
        bgWidth: s.bgWidth,
        bgHeight: s.bgHeight,
        hitboxes: s.hitboxes,
        dogs: s.dogs,
        dogPrompt: s.dogPrompt,
        inpaintModel: s.inpaintModel ?? '',
        contentRevision: s.contentRevision,
        operationalRevision: s.operationalRevision,
        selectedDogIndex: null,
        radius: s.hitboxes[0]?.r ?? state.radius,
      };
    }
    case 'SET_REVISIONS':
      return { ...state, contentRevision: action.contentRevision, operationalRevision: action.operationalRevision };
    case 'ADD_HITBOX':
      return { ...state, hitboxes: [...state.hitboxes, action.hitbox], selectedDogIndex: state.hitboxes.length };
    case 'MOVE_HITBOX':
      return {
        ...state,
        hitboxes: state.hitboxes.map((h, i) => (i === action.index ? { ...h, x: action.x, y: action.y } : h)),
      };
    case 'REMOVE_HITBOX':
      return {
        ...state,
        hitboxes: state.hitboxes.filter((_, i) => i !== action.index),
        selectedDogIndex: null,
      };
    case 'SELECT_DOG':
      return { ...state, selectedDogIndex: action.index };
    case 'SET_RADIUS':
      return { ...state, radius: action.radius };
    case 'TOGGLE_OVERLAY':
      return { ...state, showOverlay: !state.showOverlay };
    case 'SET_HITBOXES':
      return { ...state, hitboxes: action.hitboxes };
    default:
      return state;
  }
}

export default function GalleryReviewModal({
  cards, startCardId, config, onClose, onArchivedChanged, onReviewChanged,
}: Props) {
  // Setting-scoped nav cycles within the current setting only.
  const settings = useMemo(
    () => Array.from(new Set(cards.map((c) => c.session.setting))).sort(),
    [cards],
  );
  const startCard = useMemo(() => cards.find((c) => c.id === startCardId), [cards, startCardId]);
  const [currentSetting, setCurrentSetting] = useState<string>(startCard?.session.setting ?? settings[0] ?? '');
  const [currentCardId, setCurrentCardId] = useState<string>(startCardId);
  const [hitboxBlessBusy, setHitboxBlessBusy] = useState(false);
  const [cutoutBlessBusy, setCutoutBlessBusy] = useState(false);
  const [cutoutPlacementPending, setCutoutPlacementPending] = useState(false);
  const [blessError, setBlessError] = useState<string | null>(null);

  // FREEZE the working set's MEMBERSHIP at open (ledger 054 #13): `cards` is
  // the gallery's LIVE filtered list, so an action that changes filter
  // membership (archive with the state checkbox, ...) used to evict the current
  // card mid-review and teleport the
  // user to the first card (or force-close). Card DATA stays live (the map is
  // refreshed from the prop every render); only membership is pinned.
  const frozenIdsRef = useRef<string[] | null>(null);
  const knownCardsRef = useRef<Map<string, ReviewCard>>(new Map());
  const workingCards = useMemo(() => {
    for (const c of cards) knownCardsRef.current.set(c.id, c);
    if (frozenIdsRef.current === null) frozenIdsRef.current = cards.map((c) => c.id);
    return frozenIdsRef.current
      .map((id) => knownCardsRef.current.get(id))
      .filter((c): c is ReviewCard => c !== undefined);
  }, [cards]);
  // Navigation spans the WHOLE filtered collection, not just the current
  // setting: ←/→ walk every level in the focused view instead of orbiting
  // one group (2026-08-06 review feedback).
  const items = useMemo(
    () => [...workingCards].sort(compareCards),
    [workingCards],
  );
  const navigableItems = useMemo(
    () => items.filter((c) => !c.archived),
    [items],
  );
  const rawIdx = items.findIndex((c) => c.id === currentCardId);
  const index = Math.max(0, rawIdx);
  const card = items[index];
  const item = card?.session;
  const navIdx = navigableItems.findIndex((c) => c.id === currentCardId);

  useEffect(() => {
    if (rawIdx < 0) {
      const fallback = navigableItems[0] ?? items[0];
      if (fallback) setCurrentCardId(fallback.id);
      else onClose();
    }
  }, [rawIdx, items, navigableItems, onClose]);

  // Navigation crosses settings now — keep the setting dropdown honest about
  // where the reviewer actually is.
  useEffect(() => {
    if (card?.session.setting) setCurrentSetting(card.session.setting);
  }, [card?.session.setting]);

  const [state, dispatchNarrow] = useReducer(reducer, undefined, initialModalState);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [colorVersion, setColorVersion] = useState(0);
  const [visibilityIssues, setVisibilityIssues] = useState<VisibilityIssue[]>([]);
  const [sceneView, setSceneView] = useState<'painted' | 'restore' | 'pickup' | 'sprites' | 'residue'>('painted');
  const [reviewMode, setReviewMode] = useState<'placement' | 'cutouts'>('placement');
  const [showMap, setShowMap] = useState(true);
  const [loadedMeta, setLoadedMeta] = useState<{ setting?: string | null; scene?: string | null; entity?: string | null; model?: string }>({});

  const dispatch: React.Dispatch<LevelCanvasAction> = useCallback((action) => {
    dispatchNarrow(action as ModalCanvasAction);
  }, []);
  const sessionCacheRef = useRef<Map<string, SessionResponse>>(new Map());
  const sessionRequestRef = useRef<Map<string, Promise<SessionResponse>>>(new Map());
  const hitboxSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  // The exact hitboxes array last applied by LOAD_SESSION — lets the save
  // effect distinguish "loaded" from "edited" (ledger 054 #11).
  const loadedHitboxesRef = useRef<Hitbox[] | null>(null);
  // Set after a save failure blocks Close once; the next Close proceeds
  // (explicit discard) instead of jailing the user in the modal (054 #12).
  const discardOnNextCloseRef = useRef(false);
  const previewImageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const previewImageLoadingRef = useRef<Set<string>>(new Set());

  const loadPreviewImage = useCallback((url: string): void => {
    if (previewImageCacheRef.current.has(url) || previewImageLoadingRef.current.has(url)) return;
    previewImageLoadingRef.current.add(url);
    const img = new Image();
    img.decoding = 'async';
    previewImageCacheRef.current.set(url, img);
    img.src = url;
    const done = typeof img.decode === 'function'
      ? img.decode()
      : new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error(`Failed to preload ${url}`));
        });
    void done
      .then(() => {
        const cache = previewImageCacheRef.current;
        cache.delete(url);
        cache.set(url, img);
        while (cache.size > PREVIEW_IMAGE_CACHE_LIMIT) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cache.delete(oldest);
        }
      })
      .catch(() => {
        previewImageCacheRef.current.delete(url);
      })
      .finally(() => {
        previewImageLoadingRef.current.delete(url);
      });
  }, []);

  const getCachedSession = useCallback((sessionId: string): Promise<SessionResponse> => {
    const cached = sessionCacheRef.current.get(sessionId);
    if (cached) return Promise.resolve(cached);
    const existingRequest = sessionRequestRef.current.get(sessionId);
    if (existingRequest) return existingRequest;
    const request = getSession(sessionId)
      .then((session) => {
        sessionCacheRef.current.set(sessionId, session);
        sessionRequestRef.current.delete(sessionId);
        return session;
      })
      .catch((err: unknown) => {
        sessionRequestRef.current.delete(sessionId);
        sessionCacheRef.current.delete(sessionId);
        throw err;
      });
    sessionRequestRef.current.set(sessionId, request);
    return request;
  }, []);

  const loadSessionIntoCache = useCallback((sessionId: string): void => {
    void getCachedSession(sessionId).catch(() => {
      // Preload failures should not disturb the active review flow.
    });
  }, [getCachedSession]);

  /** THE server-state adoption point (bug-hunt wave 2026-08-13): every
   * successful mutation and every conflict reconciliation flows through here
   * so the reducer and the session cache can never diverge on revision or
   * geometry. Ad-hoc cache/reducer writes are the disease. */
  const adoptServerState = useCallback((sessionId: string, adopted: {
    hitboxes?: Hitbox[]; contentRevision?: string; operationalRevision?: string;
  }): void => {
    const cached = sessionCacheRef.current.get(sessionId);
    if (cached) {
      sessionCacheRef.current.set(sessionId, {
        ...cached,
        ...(adopted.hitboxes ? { hitboxes: adopted.hitboxes } : {}),
        ...(adopted.contentRevision ? { contentRevision: adopted.contentRevision } : {}),
        ...(adopted.operationalRevision ? { operationalRevision: adopted.operationalRevision } : {}),
      });
    }
    if (adopted.contentRevision) {
      dispatchNarrow({ type: 'SET_REVISIONS', contentRevision: adopted.contentRevision, operationalRevision: adopted.operationalRevision });
    }
    if (adopted.hitboxes) {
      // Server-adopted arrays are NOT user edits: mark them loaded so the
      // debounced save effect does not re-POST them (the re-POST carried a
      // stale revision after auto-place and produced a scary self-healing
      // 409 toast — twice on 2026-08-13).
      loadedHitboxesRef.current = adopted.hitboxes;
      dispatchNarrow({ type: 'SET_HITBOXES', hitboxes: adopted.hitboxes });
    }
  }, []);

  const updateCachedHitboxes = useCallback((sessionId: string, hitboxes: Hitbox[]): void => {
    const cached = sessionCacheRef.current.get(sessionId);
    if (!cached) return;
    sessionCacheRef.current.set(sessionId, { ...cached, hitboxes });
  }, []);

  const persistCachedHitboxes = useCallback(async (sessionId: string, hitboxes: Hitbox[]): Promise<void> => {
    const cached = sessionCacheRef.current.get(sessionId);
    let result;
    try {
      result = await persistHitboxes(sessionId, hitboxes, cached?.contentRevision);
    } catch (error) {
      // P1.8 reconciliation: a rejected save must not leave local
      // minted/unpersisted hitboxes rendered as truth — one rejection used to
      // poison every subsequent edit for the level until reload (2026-08-12).
      // The 409 carries server truth; adopt it and surface the rejection.
      if (error instanceof ApiError && error.status === 409 && error.detail
          && typeof error.detail === 'object') {
        // FastAPI wraps the payload as {detail: {...}}; unwrap like
        // conflictRevision does (CR-1 finding 7).
        const outer = error.detail as Record<string, unknown>;
        const detail = (outer.detail && typeof outer.detail === 'object'
          ? outer.detail : outer) as {
          serverHitboxes?: Hitbox[];
          actualContentRevision?: string;
        };
        if (Array.isArray(detail.serverHitboxes)) {
          adoptServerState(sessionId, {
            hitboxes: detail.serverHitboxes,
            contentRevision: detail.actualContentRevision,
          });
        }
      }
      throw error;
    }
    const serverHitboxes = (result as { hitboxes?: Hitbox[] } | undefined)?.hitboxes;
    // A6 (hunt A): an absent server body is NOT proof the local array
    // persisted — adopt only what the server actually returned.
    if (result) {
      adoptServerState(sessionId, {
        hitboxes: serverHitboxes,
        contentRevision: result.contentRevision,
        operationalRevision: result.operationalRevision,
      });
      const updated = sessionCacheRef.current.get(sessionId);
      if (updated) {
        sessionCacheRef.current.set(sessionId, {
          ...updated,
          contentRevision: result.contentRevision,
          operationalRevision: result.operationalRevision,
        });
      }
    }
    onReviewChanged(sessionId, {
      hitboxesBlessed: false,
      hitboxesBlessingStale: true,
      cutoutsFinalBlessed: false,
      cutoutsFinalBlessingStale: true,
    });
  }, [onReviewChanged, updateCachedHitboxes]);

  const queueHitboxSave = useCallback((sessionId: string, hitboxes: Hitbox[]): Promise<void> => {
    const hitboxSnapshot = hitboxes.map((hitbox) => ({ ...hitbox }));
    const queued = hitboxSaveChainRef.current
      .catch(() => undefined)
      .then(() => persistCachedHitboxes(sessionId, hitboxSnapshot));
    hitboxSaveChainRef.current = queued;
    return queued;
  }, [persistCachedHitboxes]);

  const invalidateCutoutReview = useCallback(() => {
    if (!state.sessionId) return;
    const sessionId = state.sessionId;
    onReviewChanged(sessionId, {
      cutoutsFinalBlessed: false,
      cutoutsFinalBlessingStale: true,
    });
    void getFinalCutoutReviewReadiness(sessionId).then((readiness) => {
      onReviewChanged(sessionId, {
        finalCutoutReviewReady: readiness.ready,
        missingFinalCutouts: readiness.missingCutouts,
      });
    }).catch(() => undefined);
  }, [onReviewChanged, state.sessionId]);

  const applySession = useCallback((session: SessionResponse): void => {
    // Mark this exact array as "server-loaded, not user-edited" so the save
    // effect can tell a LOAD_SESSION identity change from a real edit (ledger
    // 054 #11 — the effect used to POST the freshly loaded array on every
    // modal open / prev / next, re-asserting a possibly-stale cached snapshot
    // over newer server state). Referential identity is StrictMode-safe.
    loadedHitboxesRef.current = session.hitboxes;
    dispatchNarrow({ type: 'LOAD_SESSION', session });
    setLoadedMeta({
      setting: session.setting,
      scene: session.scene,
      entity: session.entity,
      model: session.model,
    });
    setColorVersion((v) => v + 1);
  }, []);

  // Load session on (setting / id change)
  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setLoading(true);
    setStatus(null);
    const cached = sessionCacheRef.current.get(item.id);
    if (cached) {
      applySession(cached);
      setLoading(false);
      return () => { cancelled = true; };
    }
    getCachedSession(item.id)
      .then((session) => {
        if (cancelled) return;
        applySession(session);
      })
      .catch((err) => { if (!cancelled) setStatus(`Load failed: ${err instanceof Error ? err.message : String(err)}`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [applySession, getCachedSession, item]);

  useEffect(() => {
    for (const neighbor of adjacentNavigableCards(items, currentCardId)) {
      loadSessionIntoCache(neighbor.session.id);
      loadPreviewImage(variantPreviewUrl(neighbor.session, neighbor.variant, neighbor.session.assetVersion ?? 0));
    }
  }, [currentCardId, items, loadPreviewImage, loadSessionIntoCache]);

  // Debounced hitbox save + recomposite with persisted mask params.
  const debouncerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevHitboxCountRef = useRef<number>(state.hitboxes.length);
  useEffect(() => {
    if (!state.sessionId) return;
    // A LOAD_SESSION identity change is NOT a user edit: saving here re-POSTed
    // the just-loaded (cache-served, possibly stale) array on every modal open
    // and prev/next, silently re-asserting stale positions over newer server
    // state (ledger 054 #11). Referential check is StrictMode-safe — a real
    // edit always builds a new array.
    if (state.hitboxes === loadedHitboxesRef.current) {
      prevHitboxCountRef.current = state.hitboxes.length;
      return;
    }
    const countDecreased = state.hitboxes.length < prevHitboxCountRef.current;
    prevHitboxCountRef.current = state.hitboxes.length;
    if (debouncerRef.current) clearTimeout(debouncerRef.current);
    if (countDecreased) {
      // Toast already dispatched in request(); the catch only prevents an
      // unhandledrejection now that save failures propagate (054 #12).
      void queueHitboxSave(state.sessionId, state.hitboxes).catch(() => {});
      return;
    }
    debouncerRef.current = setTimeout(() => {
      debouncerRef.current = null;
      if (!state.sessionId) return;
      void queueHitboxSave(state.sessionId, state.hitboxes).catch(() => {});
    }, 400);
    return () => {
      if (debouncerRef.current) clearTimeout(debouncerRef.current);
    };
  }, [state.hitboxes, queueHitboxSave]);

  useEffect(() => {
    if (!state.sessionId || state.hitboxes.length === 0) {
      setVisibilityIssues([]);
      return;
    }
    let cancelled = false;
    const delay = state.hitboxes === loadedHitboxesRef.current ? 0 : 550;
    const timer = setTimeout(() => {
      checkMobileVisibility(state.sessionId!)
        .then((report) => { if (!cancelled) setVisibilityIssues(report.issues); })
        .catch(() => { if (!cancelled) setVisibilityIssues([]); });
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state.sessionId, state.hitboxes]);

  // Returns the pending-save promise so callers can await it before
  // triggering server-side state reads (preview / archive / nav all re-read
  // hitboxes on the backend; a dangling save would race and ship stale
  // positions). Without awaiting, preview level.json could contain the
  // pre-edit hitbox set.
  const flushPendingSave = useCallback(async () => {
    if (debouncerRef.current) {
      clearTimeout(debouncerRef.current);
      debouncerRef.current = null;
      if (state.sessionId) {
        await queueHitboxSave(state.sessionId, state.hitboxes);
      }
    }
    await hitboxSaveChainRef.current;
  }, [queueHitboxSave, state.sessionId, state.hitboxes]);

  const goTo = useCallback(async (delta: number) => {
    if (!items.length || archiveBusy) return;
    try {
      await flushPendingSave();
    } catch {
      // Save failed (toast already shown) — stay on the card instead of
      // navigating away as if the edit persisted (ledger 054 #12).
      setStatus('Hitbox save failed — retry the edit before navigating.');
      return;
    }
    const nextId = nextNavigableCardId(items, currentCardId, delta > 0 ? 1 : -1);
    if (nextId) setCurrentCardId(nextId);
  }, [items, archiveBusy, currentCardId, flushPendingSave]);

  const handlePrev = useCallback(() => { void goTo(-1); }, [goTo]);
  const handleNext = useCallback(() => { void goTo(+1); }, [goTo]);

  const handleSettingChange = useCallback(async (setting: string) => {
    if (archiveBusy) return;
    try {
      await flushPendingSave();
    } catch {
      setStatus('Hitbox save failed — retry the edit before switching setting.');
      return;
    }
    setCurrentSetting(setting);
    const settingItems = cards.filter((c) => c.session.setting === setting).sort(compareCards);
    const first = settingItems.find((c) => !c.archived) ?? settingItems[0];
    if (first) setCurrentCardId(first.id);
  }, [cards, archiveBusy, flushPendingSave]);

  const handleClose = useCallback(async () => {
    if (archiveBusy) return;
    setStatus('Saving...');
    try {
      await flushPendingSave();
      discardOnNextCloseRef.current = false;
    } catch {
      // Block close ONCE so the failure is seen (toast + status); a second
      // Close is an explicit discard — never jail the user in the modal
      // (ledger 054 #12 / #37).
      if (!discardOnNextCloseRef.current) {
        discardOnNextCloseRef.current = true;
        setStatus('Hitbox save failed — close again to discard the edit.');
        return;
      }
      discardOnNextCloseRef.current = false;
    }
    onClose();
  }, [archiveBusy, flushPendingSave, onClose]);

  const handleArchiveToggle = useCallback(async () => {
    if (!item || !card || archiveBusy) return;
    const nextArchived = !card.archived;
    setArchiveBusy(true);
    setStatus('Saving…');
    try {
      await flushPendingSave();
      setStatus(nextArchived ? 'Archiving…' : 'Unarchiving…');
      await apiSetArchived(item.id, nextArchived, card.variant);
      // The parent gallery removes archived cards from its filtered `cards`
      // prop. Preserve the frozen focused-review membership, but update this
      // cached card before that removal so arrow navigation cannot resurrect
      // its stale pre-archive state.
      knownCardsRef.current.set(card.id, { ...card, archived: nextArchived });
      onArchivedChanged(item.id, nextArchived, card.variant);
      setStatus(nextArchived ? '\u2713 Archived.' : '\u2713 Unarchived.');
      if (!nextArchived) {
        // Card stays visible \u2014 no navigation needed.
        return;
      }
      // Archiving only hides this one card. Advance to the next in the
      // current setting.
      const remaining = items.filter((c) => c.id !== card.id && !c.archived);
      if (remaining.length === 0) {
        onClose();
        return;
      }
      const nextIdx = Math.min(index, remaining.length - 1);
      setCurrentCardId(remaining[nextIdx].id);
    } catch (e) {
      setStatus(`${nextArchived ? 'Archive' : 'Unarchive'} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setArchiveBusy(false);
    }
  }, [item, card, archiveBusy, items, index, flushPendingSave, onArchivedChanged, onClose]);

  const handleOpenWizard = useCallback(() => {
    if (!item || archiveBusy) return;
    void flushPendingSave().then(
      () => {
        window.location.hash = `session=${item.id}`;
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        onClose();
      },
      // Save failed (toast shown): stay in the modal rather than navigating
      // away as if the edit persisted (ledger 054 #12).
      () => setStatus('Hitbox save failed — retry the edit before opening the wizard.'),
    );
  }, [item, archiveBusy, flushPendingSave, onClose]);

  // Keyboard nav.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mutatingShortcutPressed = ['a', 'A'].includes(e.key);
      if (archiveBusy && mutatingShortcutPressed) {
        e.preventDefault();
        return;
      }
      if (e.key === 'ArrowLeft') { e.preventDefault(); handlePrev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); handleNext(); }
      else if (e.key === 'Escape') {
        e.preventDefault();
        void handleClose();
      }
      else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); void handleArchiveToggle(); }
      else if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        handleOpenWizard();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [archiveBusy, handlePrev, handleNext, handleArchiveToggle, handleClose, handleOpenWizard]);

  const visibilitySummaries = useMemo(() => summarizeVisibilityIssues(visibilityIssues), [visibilityIssues]);
  const blockerCount = blockingVisibilitySummaries(visibilitySummaries).length;

  const handleDogComplete = useCallback((dogIndex: number, _file: string, variantIndex: number) => {
    const nextDogs = state.dogs.map((dog) => (
      dog.index === dogIndex ? { ...dog, activeVariant: variantIndex } : dog
    ));
    const cached = state.sessionId ? sessionCacheRef.current.get(state.sessionId) : undefined;
    if (cached && state.sessionId) {
      sessionCacheRef.current.set(state.sessionId, { ...cached, dogs: nextDogs });
    }
    if (cached) applySession({ ...cached, dogs: nextDogs });
    else setColorVersion((version) => version + 1);
  }, [applySession, state.dogs, state.sessionId]);

  const canvasBgUrl = useMemo(() => {
    if (!item || !state.sessionId || !card) return undefined;
    if (sceneView === 'restore') {
      // Full clean background: what a pixel-perfect pipeline reveals after
      // every bird. Makes drift/warp between paint and restore obvious.
      const bg = String(Number.isInteger(state.selectedBgIndex) ? state.selectedBgIndex : 0).padStart(2, '0');
      return `/levels/${item.id}/bg_${bg}.png?v=${item.assetVersion ?? colorVersion}`;
    }
    if (sceneView === 'sprites') {
      // CL-10: revision-addressed cached preview — an img swap, not a
      // per-click server composite. rev busts across revisions; the server
      // marks the response immutable so the browser caches it.
      return `/api/sessions/${encodeURIComponent(item.id)}/scene-previews/sprites?rev=${state.contentRevision ?? item.assetVersion ?? colorVersion}`;
    }
    if (sceneView === 'residue') {
      // CL-11: residue heatmap — paint the runtime leaves behind.
      return `/api/sessions/${encodeURIComponent(item.id)}/scene-previews/residue?rev=${state.contentRevision ?? item.assetVersion ?? colorVersion}`;
    }
    if (sceneView === 'pickup') {
      // CL-10: cached runtime post-pickup state (see sprites note).
      return `/api/sessions/${encodeURIComponent(item.id)}/scene-previews/pickup?rev=${state.contentRevision ?? item.assetVersion ?? colorVersion}`;
    }
    return variantPreviewUrl(item, card.variant, item.assetVersion ?? colorVersion);
  }, [item, state.sessionId, colorVersion, card, sceneView, state.selectedBgIndex, state.contentRevision]);
  if (!item) { return null; }

  // Strip the `{setting}_` prefix from the scene slug only when there IS
  // a setting; otherwise the literal `_` replacement chops the first
  // character of the scene (e.g. 'japan_morning_market' \u2192
  // 'japanmorning_market').
  const sceneLabel = loadedMeta.scene
    ? (loadedMeta.setting
        ? loadedMeta.scene.replace(`${loadedMeta.setting}_`, '')
        : loadedMeta.scene
      ).replace(/_/g, ' ')
    : '';
  const settingLabel = config.settings[loadedMeta.setting ?? '']?.label ?? loadedMeta.setting ?? '';
  const modelBadge = (loadedMeta.model ?? '').includes('openai') ? 'gpt-bg' : 'gemini-bg';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(5, 5, 10, 0.96)',
        display: 'flex', flexDirection: 'column',
      }}
      role="dialog"
      aria-modal="true"
    >
      <div style={{
        padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        borderBottom: '1px solid #222',
      }}>
        {/* LEFT: setting dropdown + identity */}
        <select
          value={currentSetting}
          onChange={(e) => handleSettingChange(e.target.value)}
          disabled={archiveBusy}
          className="inline-select"
          title="Jump to a different setting. ← / → moves across the filtered collection."
          style={{ fontSize: '0.9rem' }}
        >
          {settings.map((s) => {
            const n = cards.filter((c) => c.session.setting === s).length;
            return <option key={s} value={s}>{config.settings[s]?.label ?? s} ({n})</option>;
          })}
        </select>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <div style={{ fontSize: '1rem', fontWeight: 600, color: '#f0f0f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {state.sessionId ? (state.sessionId.includes('_') ? sceneLabel || state.sessionId : state.sessionId) : '…'}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#999', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{settingLabel}</span>
            {sceneLabel && <span style={{ color: '#666' }}>·</span>}
            {loadedMeta.entity && <><span>{loadedMeta.entity}</span><span style={{ color: '#666' }}>·</span></>}
            <span>{state.dogs.length} {loadedMeta.entity ? `${loadedMeta.entity}s` : 'entities'}</span>
            <span style={{ color: '#666' }}>·</span>
            <span style={{
              padding: '1px 6px', borderRadius: 3, fontSize: '0.65rem',
              background: modelBadge === 'gpt-bg' ? '#2a3e6b' : '#2a6b4e',
              color: '#e0f5f5',
            }}>{modelBadge}</span>
            <span style={{ fontFamily: 'monospace', color: '#666' }}>{state.sessionId}</span>
          </div>
        </div>
        <div style={{ color: '#888', fontSize: '0.8rem', marginLeft: 12 }}>
          {navIdx >= 0 ? `${navIdx + 1} / ${navigableItems.length}` : `Archived · ${navigableItems.length} active`}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {status && <span style={{ fontSize: '0.8rem', color: status.includes('fail') || status.includes('blocked') ? '#ff8080' : '#8ec18e' }}>{status}</span>}
          <button type="button" className="btn" onClick={() => { void handleClose(); }} disabled={archiveBusy} title="Close (Esc)">Close</button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row', padding: 16, gap: 16 }}>
        {loading && <p style={{ color: '#888', margin: 'auto' }}>Loading…</p>}
        {!loading && state.bgWidth > 0 && (
          <>
            {(reviewMode !== 'cutouts' || showMap) && <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ height: '100%', aspectRatio: `${state.bgWidth} / ${state.bgHeight}`, maxWidth: '100%' }}>
                <LevelCanvas
                  state={state}
                  dispatch={dispatch}
                  backgroundOverride={canvasBgUrl}
                  hideVariants
                />
              </div>
            </div>}

            <aside style={{
              width: reviewMode === 'cutouts' ? (showMap ? 'min(52vw, 760px)' : '100%') : 360,
              flex: reviewMode === 'cutouts' && !showMap ? 1 : undefined,
              flexShrink: 0, overflowY: 'auto',
              display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              {state.contentRevision && (
                <div
                  data-testid="provenance-strip"
                  title={`persisted @ ${state.contentRevision}`}
                  style={{ fontSize: 11, color: '#8fa3b8', fontFamily: 'monospace' }}
                >
                  persisted @ {state.contentRevision.replace('sha256:', '').slice(0, 12)}
                </div>
              )}
              <div className="gallery-review-mode" role="tablist" aria-label="Focused review mode">
                <button type="button" role="tab" aria-selected={reviewMode === 'placement'} onClick={() => setReviewMode('placement')}>Placement</button>
                <button type="button" role="tab" aria-selected={reviewMode === 'cutouts'} onClick={() => setReviewMode('cutouts')}>Cutouts &amp; redo</button>
                {reviewMode === 'cutouts' && (
                  <button type="button" aria-pressed={!showMap} onClick={() => setShowMap((current) => !current)}>
                    {showMap ? 'Hide map' : 'Show map'}
                  </button>
                )}
              </div>
              {reviewMode === 'cutouts' && state.sessionId ? (
                <CutoutReviewPanel
                  sessionId={state.sessionId}
                  sharedPrompt={state.dogPrompt}
                  inpaintModel={state.inpaintModel}
                  models={config.inpaintModels ?? config.models}
                  hitboxes={state.hitboxes}
                  dogs={state.dogs}
                  contentRevision={state.contentRevision}
                  onRevisionChanged={(contentRevision, operationalRevision) => dispatchNarrow({
                    type: 'SET_REVISIONS', contentRevision, operationalRevision,
                  })}
                  onServerHitboxes={(serverHitboxes) => state.sessionId && adoptServerState(state.sessionId, { hitboxes: serverHitboxes })}
                  onDogComplete={handleDogComplete}
                  onCutoutsChanged={invalidateCutoutReview}
                  onPlacementPendingChanged={setCutoutPlacementPending}
                  expanded={!showMap}
                />
              ) : <>
              <div style={{ display: 'flex', gap: 6 }}>
                {([
                  ['painted', '🎨 Painted'],
                  ['restore', '🧹 Clean bg'],
                  ['pickup', '🐦 All picked up'],
                  ['sprites', '✂️ Sprites only'],
                  ['residue', '🔥 Residue'],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setSceneView(mode)}
                    onMouseEnter={() => {
                      // CL-10: warm the cached preview on hover so the first
                      // click is an instant swap too.
                      if ((mode === 'pickup' || mode === 'sprites' || mode === 'residue') && item) {
                        new window.Image().src = `/api/sessions/${encodeURIComponent(item.id)}/scene-previews/${mode}?rev=${state.contentRevision ?? item.assetVersion ?? colorVersion}`;
                      }
                    }}
                    style={{
                      flex: 1, padding: '10px 6px', borderRadius: 8, border: '1px solid #333', cursor: 'pointer',
                      background: sceneView === mode ? '#2e5d34' : '#1a1a1a',
                      color: sceneView === mode ? '#d6ffd9' : '#ccc', fontWeight: 700, fontSize: '0.78rem',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {/* CL-1/CL-2: bulk hitbox operations through the geometry service. */}
                {([
                  ['clear', '🗑 Clear all hitboxes'],
                  ['grow', '⊕ Grow all +10%'],
                  ['shrink', '⊖ Shrink all −10%'],
                ] as const).map(([op, label]) => (
                  <button
                    key={op}
                    type="button"
                    className="btn"
                    style={{ flex: 1, fontSize: '0.72rem' }}
                    onClick={async () => {
                      if (!card || !state.sessionId) return;
                      const revision = state.contentRevision
                        ?? sessionCacheRef.current.get(card.session.id)?.contentRevision;
                      if (!revision) return;
                      const count = state.hitboxes?.length ?? 0;
                      if (op === 'clear' && !window.confirm(
                        `Delete ALL ${count} hitboxes (and their birds) on this level? `
                        + 'Cutouts become stale and reviews are invalidated.')) return;
                      try {
                        const body = op === 'clear'
                          ? { operation: 'clear' as const, expectedContentRevision: revision, humanActor: 'human:editor' }
                          : { operation: 'scale' as const, factor: op === 'grow' ? 1.1 : 1 / 1.1,
                              expectedContentRevision: revision, humanActor: 'human:editor' };
                        const result = await runGeometryOperation(card.session.id, body);
                        adoptServerState(card.session.id, result);
                        onReviewChanged(card.session.id, {
                          hitboxesBlessed: false, hitboxesBlessingStale: true,
                          cutoutsFinalBlessed: false, cutoutsFinalBlessingStale: true,
                        });
                      } catch { /* request() toasts */ }
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn"
                  style={{ flex: 1, fontSize: '0.72rem' }}
                  title="Smart auto-placement (vision-scored) — proposes a full hitbox set through the geometry service"
                  onClick={async () => {
                    if (!card) return;
                    const count = Math.max(state.hitboxes?.length ?? 0, state.dogs?.length ?? 0) || 15;
                    if (!window.confirm(`Auto-place ${count} hitboxes? Existing machine-placed hitboxes are replaced; your hand-placed ones are protected.`)) return;
                    try {
                      const response = await autoPlaceHitboxes(card.session.id, count, Date.now(), undefined, 'smart');
                      if (response.hitboxes) {
                        // THE single adoption point — marks the array as
                        // server truth and threads the committed revision, so
                        // no stale re-POST follows (this button was the one
                        // caller still bypassing it, 2026-08-13).
                        adoptServerState(card.session.id, {
                          hitboxes: response.hitboxes,
                          contentRevision: (response as { contentRevision?: string }).contentRevision,
                          operationalRevision: (response as { operationalRevision?: string }).operationalRevision,
                        });
                      }
                    } catch { /* request() toasts */ }
                  }}
                >
                  ✨ Auto-place hitboxes
                </button>
                <button
                  type="button"
                  className="btn"
                  title="CL-17: queue extraction for every bird the DAG reports stale (sprite missing). Paid — one job, only the obligated birds."
                  onClick={async () => {
                    if (!card) return;
                    const revision = state.contentRevision
                      ?? sessionCacheRef.current.get(card.session.id)?.contentRevision;
                    if (!revision) return;
                    try {
                      const preview = await rerunStale(card.session.id, revision, true);
                      if (preview.queuedBirdIds.length === 0) {
                        setBlessError('Nothing stale — every bird has a cutout.');
                        return;
                      }
                      if (!window.confirm(`Queue extraction for ${preview.queuedBirdIds.length} stale bird(s)? This is a paid job.`)) return;
                      const started = await rerunStale(card.session.id, revision, false);
                      setBlessError(`Queued ${started.queuedBirdIds.length} extraction(s) (job ${started.jobId ?? '?'}).`);
                    } catch { /* request() toasts */ }
                  }}
                >
                  ↻ Re-run stale
                </button>
              </div>
              <div style={{ background: '#0a0a0a', border: '1px solid #222', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: '0.85rem', color: '#ccc', marginBottom: 6 }}>
                  Hitboxes — {state.hitboxes.length}
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', color: '#ccc', marginBottom: 10 }}>
                  <span>Radius <strong>{state.radius}px</strong></span>
                  <input
                    type="range" min={20} max={200} step={1} value={state.radius}
                    onChange={(e) => dispatchNarrow({ type: 'SET_RADIUS', radius: parseInt(e.target.value) || 40 })}
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#ccc' }}>
                  <input
                    type="checkbox"
                    checked={state.showOverlay}
                    onChange={() => dispatchNarrow({ type: 'TOGGLE_OVERLAY' })}
                  />
                  Overlay
                </label>
                <div style={{ marginTop: 8, color: '#888', fontSize: '0.72rem' }}>
                  click to add · drag to move · double-click to remove
                </div>
              </div>

              {blockerCount > 0 && (
                <div style={{
                  background: '#2a1111',
                  border: '1px solid #7a3232',
                  borderRadius: 8,
                  padding: 12,
                  color: '#ffd98a',
                  fontSize: '0.8rem',
                  }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    Hitboxes touching danger zones
                  </div>
                  {visibilitySummaries.slice(0, 6).map((summary) => (
                    <div key={summary.dogId} style={{ marginBottom: 3 }}>
                      {visibilitySummaryLabel(summary)}
                    </div>
                  ))}
                  {visibilitySummaries.length > 6 && (
                    <div style={{ color: '#caa866' }}>...and {visibilitySummaries.length - 6} more</div>
                  )}
                </div>
              )}
              </>}
            </aside>
          </>
        )}
      </div>

      <div style={{
        padding: '10px 16px', borderTop: '1px solid #222',
        display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn" onClick={handlePrev} disabled={archiveBusy} title="← previous level">
            ← Prev
          </button>
          <button type="button" className="btn" onClick={handleNext} disabled={archiveBusy} title="→ next level">
            Next →
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn"
            disabled={hitboxBlessBusy || cutoutBlessBusy || card === undefined || card.session.assetBase === 'public-levels'}
            title={card?.session.assetBase === 'public-levels'
              ? 'Only the shipped package remains; the authoring session was deleted. Nothing here can be reviewed.'
              : 'Confirm that the current hitbox geometry has been reviewed by a human. Any later hitbox edit makes this approval stale.'}
            onClick={async () => {
              if (!card) return;
              const approved = !card.session.hitboxesBlessed;
              setHitboxBlessBusy(true);
              setBlessError(null);
              try {
                await flushPendingSave();
                const expectedContentRevision = state.contentRevision
                  ?? sessionCacheRef.current.get(card.session.id)?.contentRevision;
                const result = await setHitboxApproval(card.session.id, approved, expectedContentRevision);
                const { hitboxReview, finalCutoutReadiness } = result;
                if (result.contentRevision) dispatchNarrow({
                  type: 'SET_REVISIONS',
                  contentRevision: result.contentRevision,
                  operationalRevision: result.operationalRevision,
                });
                onReviewChanged(card.session.id, {
                  hitboxesBlessed: hitboxReview.current,
                  hitboxesBlessingStale: hitboxReview.stale,
                  hitboxesBlessedAt: hitboxReview.reviewedAt,
                  finalCutoutReviewReady: approved && finalCutoutReadiness.ready,
                  missingFinalCutouts: finalCutoutReadiness.missingCutouts,
                  ...(approved ? {} : {
                    cutoutsFinalBlessed: false,
                    cutoutsFinalBlessingStale: true,
                  }),
                });
              } catch (err) {
                setBlessError(err instanceof Error ? err.message : 'Saving hitbox review failed');
              } finally {
                setHitboxBlessBusy(false);
              }
            }}
            style={card?.session.hitboxesBlessed ? {
              background: '#183c2c', color: '#9bf0bf', borderColor: '#38865d', fontWeight: 800,
            } : undefined}
          >
            {hitboxBlessBusy ? 'Saving…' : card?.session.hitboxesBlessed ? '✓ Hitboxes reviewed' : 'Mark hitboxes reviewed'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={cutoutBlessBusy || hitboxBlessBusy || cutoutPlacementPending || card === undefined || card.session.assetBase === 'public-levels' || card.session.canonicalState === 'quarantined_integrity' || !card.session.hitboxesBlessed || card.session.finalCutoutReviewReady !== true}
            title={card?.session.assetBase === 'public-levels'
              ? 'Only the shipped package remains; the authoring session was deleted. Nothing here can be reviewed.'
              : card?.session.canonicalState === 'quarantined_integrity'
              ? 'This level has mismatched bird artifacts. Repair the bird mappings before reviewing cutouts.'
              : cutoutPlacementPending
              ? 'Wait for the current sprite placement to finish saving.'
              : !card?.session.hitboxesBlessed
              ? 'Review the current hitboxes before marking cutouts reviewed.'
              : card.session.finalCutoutReviewReady !== true
              ? card.session.invalidFinalPadding
                ? `${card.session.invalidFinalPadding} padding box(es) target a different bird.`
                : `${card.session.missingFinalCutouts ?? 0} active bird cutout(s) are still missing.`
              : 'Confirm that every current cutout and sprite placement is final. Later sprite edits make this approval stale.'}
            onClick={async () => {
              if (!card) return;
              const approved = !card.session.cutoutsFinalBlessed;
              setCutoutBlessBusy(true);
              setBlessError(null);
              try {
                await flushPendingSave();
                const expectedContentRevision = state.contentRevision
                  ?? sessionCacheRef.current.get(card.session.id)?.contentRevision;
                let result;
                try {
                  result = await setFinalCutoutApproval(card.session.id, approved, expectedContentRevision);
                } catch (error) {
                  const currentRevision = conflictRevision(error);
                  if (!currentRevision) throw error;
                  // P2b.3: never blind-retry a human approval at a revision the
                  // human has not seen — adopt the server revision and require
                  // a fresh look + click.
                  dispatchNarrow({ type: 'SET_REVISIONS', contentRevision: currentRevision });
                  setBlessError('The level changed on the server since you loaded it — re-check the cutouts and click again.');
                  return;
                }
                const { finalCutoutReview } = result;
                if (result.contentRevision) dispatchNarrow({
                  type: 'SET_REVISIONS',
                  contentRevision: result.contentRevision,
                  operationalRevision: result.operationalRevision,
                });
                onReviewChanged(card.session.id, {
                  cutoutsFinalBlessed: finalCutoutReview.current,
                  cutoutsFinalBlessingStale: finalCutoutReview.stale,
                  cutoutsFinalBlessedAt: finalCutoutReview.reviewedAt,
                });
              } catch (err) {
                setBlessError(err instanceof Error ? err.message : 'Saving cutout review failed');
              } finally {
                setCutoutBlessBusy(false);
              }
            }}
            style={card?.session.cutoutsFinalBlessed ? {
              background: '#183c2c', color: '#9bf0bf', borderColor: '#38865d', fontWeight: 800,
            } : undefined}
          >
            {cutoutBlessBusy ? 'Saving…' : card?.session.cutoutsFinalBlessed ? '★ Cutouts reviewed' : 'Mark cutouts reviewed'}
          </button>
          
          {blessError && <span style={{ color: '#ff9c9c', fontSize: 12 }}>{blessError}</span>}
          <button
            type="button"
            className="btn"
            onClick={handleArchiveToggle}
            disabled={archiveBusy}
            title={card?.archived ? 'Unarchive (A) \u2014 restore this card' : 'Archive (A) \u2014 hides this card from gallery'}
          >
            {card?.archived ? 'Unarchive (A)' : 'Archive (A)'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleOpenWizard}
            disabled={archiveBusy}
            title="Open in Wizard (W)"
          >
            Wizard (W)
          </button>
          <span style={{ color: '#777', fontSize: 12, alignSelf: 'center' }}>
            Select completed levels for the game from Gallery cards.
          </span>
        </div>
      </div>
    </div>
  );
}


async function persistHitboxes(
  sessionId: string,
  hitboxes: Hitbox[],
  expectedContentRevision?: string,
) {
  // Just persist hitbox coordinates \u2014 don't recomposite. A hitbox is
  // the invisible click target; dragging it should move the click
  // target, NOT re-render the composite at the new position. Previous
  // behavior auto-called recomposite on every drag, which pasted
  // variants at the shifted positions and changed the image visibly.
  // That's the wrong contract.
  //
  // To actually re-render with the new positions, trigger a per-dog regen.
  //
  // Failures PROPAGATE (ledger 054 #12): the old swallow let
  // persistCachedHitboxes record the edit as server truth in the session
  // cache, and Catalog upload / Preview then proceeded with stale server-side
  // positions while the UI claimed the save succeeded. request() already
  // toasts; callers decide whether to abort (approve/nav) or discard (close).
  return saveHitboxes(sessionId, hitboxes, 'edit', expectedContentRevision);
}
