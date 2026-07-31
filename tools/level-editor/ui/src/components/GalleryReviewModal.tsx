import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Background, ConfigResponse, DogState, GenerationProgress, Hitbox, LevelSection, Orientation, SessionResponse } from '../types';
import {
  getSession,
  saveHitboxes,
  setArchived as apiSetArchived,
  type SessionListItem,
  checkMobileVisibility,
  type VisibilityIssue,
} from '../api/editorApi';
import { blockingVisibilitySummaries, summarizeVisibilityIssues, visibilitySummaryLabel } from '../lib/visibilityWarnings';
import LevelCanvas, { type LevelCanvasAction, type LevelCanvasState } from './LevelCanvas';

const PREVIEW_IMAGE_CACHE_LIMIT = 8;

/** One card per (session × variant) — matches `GalleryPage.VariantCard`. */
export interface ReviewCard {
  id: string;                      // `${session.id}::${variant}`
  session: SessionListItem;
  variant: string;
  state: 'background' | 'inpainted' | 'exported';
  archived: boolean;
}

function sessionCreatedAtMs(session: SessionListItem): number {
  const parsed = Date.parse(session.createdAt ?? '');
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareCards(a: ReviewCard, b: ReviewCard): number {
  const createdDelta = sessionCreatedAtMs(b.session) - sessionCreatedAtMs(a.session);
  if (createdDelta !== 0) return createdDelta;
  if (a.session.id !== b.session.id) return a.session.id.localeCompare(b.session.id);
  return a.variant.localeCompare(b.variant);
}

function nextNavigableCardId(cards: ReviewCard[], currentCardId: string, delta: 1 | -1): string | null {
  if (cards.length === 0 || !cards.some((c) => !c.archived)) return null;
  const startIdx = Math.max(0, cards.findIndex((c) => c.id === currentCardId));
  for (let step = 1; step <= cards.length; step += 1) {
    const idx = (startIdx + delta * step + cards.length) % cards.length;
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
   *  skips archived cards within the current setting. */
  cards: ReviewCard[];
  startCardId: string;
  config: ConfigResponse;
  onClose: () => void;
  onArchivedChanged: (id: string, archived: boolean, variant?: string) => void;
}

/** Source PNG for a given variant. Review uses WebP; download keeps PNG. */
function variantSourceFile(variant: string, selectedBgIndex?: number | null): string {
  const selectedBg = Number.isInteger(selectedBgIndex) ? selectedBgIndex : 0;
  switch (variant) {
    case 'gemini':            return 'color.png';
    case 'openai':            return 'openai_color.png';
    case 'openai_v2':         return 'openai_color_v2.png';
    case 'gemini_bg_only':    return `bg_${String(selectedBg).padStart(2, '0')}.png`;
    case 'openai_bg_only':    return 'openai_bg.png';
    case 'openai_v2_bg_only': return 'openai_bg_v2.png';
    default:                  return 'color.png';
  }
}

function variantPreviewUrl(session: SessionListItem, variant: string, version: number): string {
  return `/api/sessions/${encodeURIComponent(session.id)}/gallery-preview/${encodeURIComponent(variant)}?v=${version}`;
}

function compositeDownloadName(session: SessionListItem, variant: string): string {
  const variantLabel = variant.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const sessionLabel = session.id.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '');
  return `${sessionLabel || 'level'}-${variantLabel || 'composite'}.png`;
}

interface ModalState extends LevelCanvasState {
  config: ConfigResponse | null;
  backgrounds: Background[];
  dogPrompt: string;
  generating: boolean;
  generationProgress: GenerationProgress;
  generationErrors: string[];
  inpainting: boolean;
  inpaintProgress: {
    done: number;
    total: number;
    currentPass: number;
    totalPasses: number;
  };
  configSummary: string;
  exportError: string | null;
  orientation: Orientation;
  sections: LevelSection[];
  dogs: DogState[];
}

function initialModalState(): ModalState {
  return {
    config: null,
    sessionId: null,
    orientation: 'portrait',
    sections: [],
    backgrounds: [],
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
    generating: false,
    generationProgress: { succeeded: 0, failed: 0, total: 0 },
    generationErrors: [],
    inpainting: false,
    inpaintProgress: { done: 0, total: 0, currentPass: 0, totalPasses: 0 },
    configSummary: '',
    exportError: null,
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
  | { type: 'SET_HITBOXES'; hitboxes: Hitbox[] };

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
        backgrounds: s.backgrounds,
        selectedBgIndex: s.selectedBgIndex,
        bgWidth: s.bgWidth,
        bgHeight: s.bgHeight,
        hitboxes: s.hitboxes,
        dogs: s.dogs,
        dogPrompt: s.dogPrompt,
        selectedDogIndex: null,
        radius: s.hitboxes[0]?.r ?? state.radius,
      };
    }
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
  cards, startCardId, config, onClose, onArchivedChanged,
}: Props) {
  // Setting-scoped nav cycles within the current setting only.
  const settings = useMemo(
    () => Array.from(new Set(cards.map((c) => c.session.setting))).sort(),
    [cards],
  );
  const startCard = useMemo(() => cards.find((c) => c.id === startCardId), [cards, startCardId]);
  const [currentSetting, setCurrentSetting] = useState<string>(startCard?.session.setting ?? settings[0] ?? '');
  const [currentCardId, setCurrentCardId] = useState<string>(startCardId);

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
  const items = useMemo(
    () => workingCards.filter((c) => c.session.setting === currentSetting).sort(compareCards),
    [workingCards, currentSetting],
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

  const [state, dispatchNarrow] = useReducer(reducer, undefined, initialModalState);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [colorVersion, setColorVersion] = useState(0);
  const [visibilityIssues, setVisibilityIssues] = useState<VisibilityIssue[]>([]);
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

  const updateCachedHitboxes = useCallback((sessionId: string, hitboxes: Hitbox[]): void => {
    const cached = sessionCacheRef.current.get(sessionId);
    if (!cached) return;
    sessionCacheRef.current.set(sessionId, { ...cached, hitboxes });
  }, []);

  const persistCachedHitboxes = useCallback(async (sessionId: string, hitboxes: Hitbox[]): Promise<void> => {
    await persistHitboxes(sessionId, hitboxes);
    updateCachedHitboxes(sessionId, hitboxes);
  }, [updateCachedHitboxes]);

  const queueHitboxSave = useCallback((sessionId: string, hitboxes: Hitbox[]): Promise<void> => {
    const hitboxSnapshot = hitboxes.map((hitbox) => ({ ...hitbox }));
    const queued = hitboxSaveChainRef.current
      .catch(() => undefined)
      .then(() => persistCachedHitboxes(sessionId, hitboxSnapshot));
    hitboxSaveChainRef.current = queued;
    return queued;
  }, [persistCachedHitboxes]);

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
      void checkMobileVisibility(cached.id)
        .then((report) => { if (!cancelled) setVisibilityIssues(report.issues); })
        .catch(() => { if (!cancelled) setVisibilityIssues([]); });
      return () => { cancelled = true; };
    }
    getCachedSession(item.id)
      .then((session) => {
        if (cancelled) return;
        applySession(session);
        void checkMobileVisibility(session.id)
          .then((report) => { if (!cancelled) setVisibilityIssues(report.issues); })
          .catch(() => { if (!cancelled) setVisibilityIssues([]); });
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
    const timer = setTimeout(() => {
      checkMobileVisibility(state.sessionId!)
        .then((report) => { if (!cancelled) setVisibilityIssues(report.issues); })
        .catch(() => { if (!cancelled) setVisibilityIssues([]); });
    }, 550);
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
    if (!items.length || activeAction !== null) return;
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
  }, [items, activeAction, currentCardId, flushPendingSave]);

  const handlePrev = useCallback(() => { void goTo(-1); }, [goTo]);
  const handleNext = useCallback(() => { void goTo(+1); }, [goTo]);

  const handleSettingChange = useCallback(async (setting: string) => {
    if (activeAction !== null) return;
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
  }, [cards, activeAction, flushPendingSave]);

  const handleClose = useCallback(async () => {
    if (activeAction !== null) return;
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
  }, [activeAction, flushPendingSave, onClose]);

  const handleArchiveToggle = useCallback(async () => {
    if (!item || !card || activeAction !== null) return;
    const nextArchived = !card.archived;
    setActiveAction('archive');
    setStatus('Saving…');
    try {
      await flushPendingSave();
      setStatus(nextArchived ? 'Archiving…' : 'Unarchiving…');
      await apiSetArchived(item.id, nextArchived, card.variant);
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
      setActiveAction(null);
    }
  }, [item, card, activeAction, items, index, flushPendingSave, onArchivedChanged, onClose]);

  const handleOpenWizard = useCallback(() => {
    if (!item || activeAction !== null) return;
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
  }, [item, activeAction, flushPendingSave, onClose]);

  // Keyboard nav.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mutatingShortcutPressed = ['a', 'A'].includes(e.key);
      if (activeAction !== null && mutatingShortcutPressed) {
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
  }, [activeAction, handlePrev, handleNext, handleArchiveToggle, handleClose, handleOpenWizard]);

  const visibilitySummaries = useMemo(() => summarizeVisibilityIssues(visibilityIssues), [visibilityIssues]);
  const blockerCount = blockingVisibilitySummaries(visibilitySummaries).length;

  const canvasBgUrl = useMemo(() => {
    if (!item || !state.sessionId || !card) return undefined;
    return variantPreviewUrl(item, card.variant, item.assetVersion ?? colorVersion);
  }, [item, state.sessionId, colorVersion, card]);
  const downloadHref = item && card
    ? `/levels/${item.id}/${variantSourceFile(card.variant, state.selectedBgIndex)}?v=${item.assetVersion ?? colorVersion}`
    : '';
  const downloadName = item && card ? compositeDownloadName(item, card.variant) : 'level-composite.png';

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
          disabled={activeAction !== null}
          className="inline-select"
          title="Jump to a different setting. ← / → stays within the current one."
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
            <span>{state.dogs.length} dogs</span>
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
          <button type="button" className="btn" onClick={() => { void handleClose(); }} disabled={activeAction !== null} title="Close (Esc)">Close</button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row', padding: 16, gap: 16 }}>
        {loading && <p style={{ color: '#888', margin: 'auto' }}>Loading…</p>}
        {!loading && state.bgWidth > 0 && (
          <>
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ height: '100%', aspectRatio: `${state.bgWidth} / ${state.bgHeight}`, maxWidth: '100%' }}>
                <LevelCanvas
                  state={state}
                  dispatch={dispatch}
                  backgroundOverride={canvasBgUrl}
                  hideVariants
                />
              </div>
            </div>

            <aside style={{
              width: 360, flexShrink: 0, overflowY: 'auto',
              display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              <div style={{ background: '#0a0a0a', border: '1px solid #222', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: '0.85rem', color: '#ccc', marginBottom: 6 }}>
                  Hitboxes — {state.hitboxes.length}
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', color: '#ccc', marginBottom: 10 }}>
                  <span>Radius <strong>{state.radius}px</strong></span>
                  <input
                    type="range" min={20} max={120} step={1} value={state.radius}
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

              {visibilitySummaries.length > 0 && (
                <div style={{
                  background: blockerCount > 0 ? '#2a1111' : '#2a210d',
                  border: `1px solid ${blockerCount > 0 ? '#7a3232' : '#7a5a1d'}`,
                  borderRadius: 8,
                  padding: 12,
                  color: '#ffd98a',
                  fontSize: '0.8rem',
                  }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    {blockerCount > 0 ? 'Hitboxes touching danger zones' : 'Mobile border warnings'}
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

            </aside>
          </>
        )}
      </div>

      <div style={{
        padding: '10px 16px', borderTop: '1px solid #222',
        display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn" onClick={handlePrev} disabled={activeAction !== null} title="← (wraps)">
            ← Prev
          </button>
          <button type="button" className="btn" onClick={handleNext} disabled={activeAction !== null} title="→ (wraps)">
            Next →
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a
            href={downloadHref}
            download={downloadName}
            title="Download the currently shown composite image"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '8px 14px',
              borderRadius: 4,
              background: '#1f3329',
              color: '#bfe8ce',
              border: '1px solid #2f674b',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Save Image
          </a>
          <button
            type="button"
            className="btn"
            onClick={handleArchiveToggle}
            disabled={activeAction !== null}
            title={card?.archived ? 'Unarchive (A) \u2014 restore this card' : 'Archive (A) \u2014 hides this card from gallery'}
          >
            {card?.archived ? 'Unarchive (A)' : 'Archive (A)'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleOpenWizard}
            disabled={activeAction !== null}
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
  await saveHitboxes(sessionId, hitboxes, 'edit');
}
