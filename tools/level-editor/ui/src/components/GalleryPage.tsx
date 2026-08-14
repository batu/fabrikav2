import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  listSessions,
  setArchived,
  checkMobileVisibilityBatch,
  getSequenceWorkflow,
  saveSequenceDraft,
  type SessionListItem,
  type SequenceWorkflowState,
  type VisibilityIssue,
} from '../api/editorApi';
import type { ConfigResponse } from '../types';
import { blockingVisibilitySummaries, summarizeVisibilityIssues } from '../lib/visibilityWarnings';
import GalleryReviewModal, {
  compareCards,
  type ReviewCard,
  type ReviewCardState,
} from './GalleryReviewModal';

interface Props {
  config: ConfigResponse;
  onOpen: (sessionId: string) => void;
}

type CardState = ReviewCardState;
type GallerySortMode = 'newest' | 'name' | 'dogs' | 'regeneration';
type HumanReviewState = 'needs-hitbox-review' | 'needs-cutout-review' | 'reviewed';

const HUMAN_REVIEW_STATES: HumanReviewState[] = [
  'needs-hitbox-review',
  'needs-cutout-review',
  'reviewed',
];

const HUMAN_REVIEW_FILTER_LABELS: Record<HumanReviewState, string> = {
  'needs-hitbox-review': 'Hitboxes need review',
  'needs-cutout-review': 'Cutouts need review',
  reviewed: 'Reviewed',
};

const VARIANT_LABELS: Record<string, string> = {
  gemini: 'Gemini',
  openai: 'GPT v1',
  openai_v2: 'GPT v2',
  gemini_bg_only: 'Gemini bg',
  openai_bg_only: 'GPT v1 bg',
  openai_v2_bg_only: 'GPT v2 bg',
};

function variantThumbnailUrl(session: SessionListItem, variant: string): string {
  const version = session.assetVersion ? `?v=${session.assetVersion}` : '';
  return `/api/sessions/${encodeURIComponent(session.id)}/gallery-thumb/${encodeURIComponent(variant)}${version}`;
}

/** Classify a (session, variant) pair into a lifecycle state. */
function variantCardState(session: SessionListItem, variant: string): CardState {
  if (variant.endsWith('_bg_only')) return 'background';
  const exported = session.exported;
  const exportedVariant = session.exportedVariant ?? 'gemini';
  if (exported && exportedVariant === variant) return 'exported';
  return 'inpainted';
}

/** Each variant of a session lives as its own card in the gallery with
 *  its own archive state. `archived` is derived from:
 *    1. session-level `archived` flag (legacy session-wide archive), OR
 *    2. this variant being in the session's `archivedVariants` list.
 *  Every user action (archive, export, review) targets one VariantCard
 *  and only that card \u2014 siblings for the same session are untouched. */
type VariantCard = ReviewCard;

function isVariantArchived(session: SessionListItem, variant: string): boolean {
  if (session.archived) return true;
  return (session.archivedVariants ?? []).includes(variant);
}

function sortCards(cards: VariantCard[], sortMode: GallerySortMode): VariantCard[] {
  return cards.slice().sort((a, b) => {
    if (sortMode === 'name') {
      const nameDelta = a.session.name.localeCompare(b.session.name);
      if (nameDelta !== 0) return nameDelta;
    } else if (sortMode === 'dogs') {
      const dogsDelta = b.session.nDogs - a.session.nDogs;
      if (dogsDelta !== 0) return dogsDelta;
    } else if (sortMode === 'regeneration') {
      const redoDelta = (b.session.regenerationCandidateCount ?? 0) - (a.session.regenerationCandidateCount ?? 0);
      if (redoDelta !== 0) return redoDelta;
    }

    return compareCards(a, b);
  });
}

function humanReviewSummary(session: SessionListItem) {
  const packageOnly = session.assetBase === 'public-levels';
  const hitboxesStale = Boolean(session.hitboxesBlessingStale);
  const cutoutsStale = Boolean(session.cutoutsFinalBlessingStale);
  const stale = hitboxesStale || cutoutsStale;
  const hitboxesReviewed = Boolean(session.hitboxesBlessed) && !hitboxesStale;
  const cutoutsReviewed = Boolean(session.cutoutsFinalBlessed) && !stale;
  // Package-only levels have no authoring session left — review is
  // impossible, so they must not sit in the needs-work buckets forever.
  const state: HumanReviewState = packageOnly
    ? 'reviewed'
    : !hitboxesReviewed
      ? 'needs-hitbox-review'
      : !cutoutsReviewed
        ? 'needs-cutout-review'
        : 'reviewed';
  return {
    state,
    packageOnly,
    hitboxesReviewed,
    cutoutsReviewed,
  };
}

export default function GalleryPage({ config, onOpen }: Props) {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [lineupState, setLineupState] = useState<SequenceWorkflowState | null>(null);
  const [lineupSavingId, setLineupSavingId] = useState<string | null>(null);
  const [lineupError, setLineupError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Operator 2026-08-13: tag chips off the cards; provenance filters as
  // three dropdowns (background / inpaint / cutout) parsed from the tags.
  const [bgFilter, setBgFilter] = useState<string>('all');
  const [inpaintFilter, setInpaintFilter] = useState<string>('all');
  const [cutoutFilter, setCutoutFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [lineupOnly, setLineupOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [humanReviewFilter, setHumanReviewFilter] = useState<Record<HumanReviewState, boolean>>({
    'needs-hitbox-review': true,
    'needs-cutout-review': true,
    reviewed: true,
  });
  const [reviewStartCardId, setReviewStartCardId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<GallerySortMode>('newest');
  const [groupBySetting, setGroupBySetting] = useState(true);
  const [visibilityBySessionId, setVisibilityBySessionId] = useState<Record<string, VisibilityIssue[]>>({});

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([listSessions({ includePublic: true }), getSequenceWorkflow()])
      .then(([nextSessions, nextLineup]) => {
        setSessions(nextSessions);
        setLineupState(nextLineup);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Explode sessions into one card per (session, variant). A session with
  // variants=['gemini', 'openai_v2'] produces two independent cards.
  const allCards = useMemo<VariantCard[]>(() => {
    const out: VariantCard[] = [];
    for (const s of sessions) {
      const variants = s.variants ?? [];
      if (variants.length === 0) continue;
      for (const v of variants) {
        const state = variantCardState(s, v);
        if (state === 'background') continue;
        out.push({
          id: `${s.id}::${v}`,
          session: s,
          variant: v,
          state,
          archived: isVariantArchived(s, v),
        });
      }
    }
    return out;
  }, [sessions]);

  const activeCards = useMemo(
    () => (showArchived ? allCards : allCards.filter((card) => !card.archived)),
    [allCards, showArchived],
  );
  const activeSessions = useMemo(
    () => Array.from(new Map(
      activeCards.map((card) => [card.session.id, card.session]),
    ).values()),
    [activeCards],
  );
  const orderedAllCards = useMemo(
    () => sortCards(activeCards, sortMode),
    [activeCards, sortMode],
  );

  const provenanceOptions = useMemo(() => {
    const collect = (prefix: string) => Array.from(new Set(
      activeSessions.flatMap((session) => (session.tags ?? [])
        .filter((tag) => tag.startsWith(prefix))
        .map((tag) => tag.slice(prefix.length))),
    )).sort();
    return { bg: collect('gen:'), inpaint: collect('inpaint:'), cutout: collect('cutout:') };
  }, [activeSessions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const lineupOrder = lineupState?.draft.levelIds ?? [];
    const lineupSet = new Set(lineupOrder);
    return orderedAllCards
      .filter((c) => (lineupOnly ? lineupSet.has(c.session.id) : true))
      .filter((c) => (bgFilter === 'all' ? true : (c.session.tags ?? []).includes(`gen:${bgFilter}`)))
      .filter((c) => (inpaintFilter === 'all' ? true : (c.session.tags ?? []).includes(`inpaint:${inpaintFilter}`)))
      .filter((c) => (cutoutFilter === 'all' ? true : (c.session.tags ?? []).includes(`cutout:${cutoutFilter}`)))
      .filter((c) => humanReviewFilter[humanReviewSummary(c.session).state])
      .filter((c) => {
        if (!q) return true;
        const haystack = [
          c.session.name,
          c.session.setting,
          config.settings[c.session.setting]?.label ?? '',
          c.session.scene ?? '',
          ...(c.session.tags ?? []),
        ].join(' ').toLowerCase();
        return haystack.includes(q);
      })
      // Lineup view is an ORDER, not just a filter: sort by play position so
      // the gallery reads the way players will meet the levels.
      .sort((a, b) => (lineupOnly
        ? lineupOrder.indexOf(a.session.id) - lineupOrder.indexOf(b.session.id)
        : 0));
  }, [orderedAllCards, lineupOnly, lineupState, bgFilter, inpaintFilter, cutoutFilter, humanReviewFilter, search, config.settings]);

  const visibilitySessionIds = useMemo(
    () => Array.from(new Set(
      filtered
        .filter((c) => c.state !== 'background' && c.session.nDogs > 0)
        .map((c) => c.session.id),
    )).sort(),
    [filtered],
  );
  const visibilitySessionKey = visibilitySessionIds.join('\0');

  useEffect(() => {
    if (visibilitySessionIds.length === 0) {
      setVisibilityBySessionId({});
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      checkMobileVisibilityBatch(visibilitySessionIds)
        .then(({ reports }) => {
          if (cancelled) return;
          setVisibilityBySessionId((prev) => {
            const next = { ...prev };
            for (const sessionId of visibilitySessionIds) {
              next[sessionId] = reports[sessionId]?.issues ?? [];
            }
            return next;
          });
        })
        .catch(() => {
          if (!cancelled) setVisibilityBySessionId({});
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [visibilitySessionKey]);

  const grouped = useMemo(() => {
    if (!groupBySetting || lineupOnly) return [['all', filtered] as const];
    const g = new Map<string, VariantCard[]>();
    for (const c of filtered) {
      const cards = g.get(c.session.setting) ?? [];
      cards.push(c);
      g.set(c.session.setting, cards);
    }
    return Array.from(g.entries());
  }, [filtered, groupBySetting, lineupOnly]);

  const humanReviewCounts = useMemo(() => {
    const counts: Record<HumanReviewState, number> = {
      'needs-hitbox-review': 0,
      'needs-cutout-review': 0,
      reviewed: 0,
    };
    for (const session of activeSessions) {
      counts[humanReviewSummary(session).state]++;
    }
    return counts;
  }, [activeSessions]);

  const activeLevelCount = useMemo(
    () => activeSessions.length,
    [activeSessions],
  );

  const handleCardOpen = useCallback((cardId: string) => {
    setReviewStartCardId(cardId);
  }, []);

  const handleArchivedChanged = useCallback((id: string, archived: boolean, variant?: string) => {
    setSessions((prev) => prev.map((s) => {
      if (s.id !== id) return s;
      if (!variant) {
        // Whole-session archive. Full unarchive clears the per-variant
        // list too (mirrors server-side set_archived semantics).
        return {
          ...s,
          archived,
          archivedVariants: archived ? s.archivedVariants : [],
          exported: archived ? false : s.exported,
        };
      }
      // Per-variant archive \u2014 mutate the archivedVariants list.
      const set = new Set(s.archivedVariants ?? []);
      if (archived) set.add(variant); else set.delete(variant);
      const exportedVariant = s.exportedVariant ?? 'gemini';
      const wasExportedVariant = archived && variant === exportedVariant;
      // On unarchive, also clear any legacy session-wide archive flag
      // so the card isn't still filtered as archived.
      const nextSessionArchived = archived ? s.archived : false;
      return {
        ...s,
        archived: nextSessionArchived,
        archivedVariants: [...set].sort(),
        exported: wasExportedVariant ? false : s.exported,
      };
    }));
  }, []);

  const handleReviewChanged = useCallback((id: string, patch: Partial<SessionListItem>) => {
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((session) => {
        if (session.id !== id) return session;
        const differs = Object.entries(patch).some(
          ([key, value]) => session[key as keyof SessionListItem] !== value,
        );
        if (!differs) return session;
        changed = true;
        return { ...session, ...patch };
      });
      return changed ? next : prev;
    });
  }, []);

  const handleModalClose = useCallback(() => {
    setReviewStartCardId(null);
    refresh();
  }, [refresh]);

  const lineupIds = useMemo(() => new Set(lineupState?.draft.levelIds ?? []), [lineupState]);
  const saveLineupIds = useCallback(async (nextIds: string[], cardId: string) => {
    if (lineupState === null) return;
    setLineupSavingId(cardId);
    setLineupError(null);
    try {
      const nextState = await saveSequenceDraft({
        levelIds: nextIds,
        baseLiveSequenceVersion: lineupState.liveSequence.sequenceVersion,
        baseCatalogRevision: lineupState.catalog.catalogRevision,
        draftRevision: lineupState.draft.draftRevision,
      });
      setLineupState(nextState);
    } catch (err) {
      setLineupError(err instanceof Error ? err.message : String(err));
    } finally {
      setLineupSavingId(null);
    }
  }, [lineupState]);
  const toggleLineupMembership = useCallback((card: VariantCard, selectable: boolean) => {
    if (!selectable || lineupState === null) return;
    const currentIds = lineupState.draft.levelIds;
    const selected = currentIds.includes(card.session.id);
    const nextIds = selected
      ? currentIds.filter((id) => id !== card.session.id)
      : [...currentIds, card.session.id];
    void saveLineupIds(nextIds, card.id);
  }, [lineupState, saveLineupIds]);

  const visibleLineupCount = useMemo(() => {
    const activeSessionIds = new Set(activeSessions.map((session) => session.id));
    return (lineupState?.draft.levelIds ?? []).filter((id) => activeSessionIds.has(id)).length;
  }, [activeSessions, lineupState]);

  return (
    <div className="pipeline-body" style={{ padding: 16 }}>
      <div className="step" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>Gallery</h2>
          <span style={{ color: '#888', fontSize: '0.85rem' }}>
            {filtered.length} / {activeCards.length} cards · {visibleLineupCount} selected for Lineup
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, setting, scene, tags"
              style={{ background: '#111', border: '1px solid #333', borderRadius: 6, color: '#e0e0e0', padding: '6px 10px' }}
            />
            <select value={bgFilter} onChange={(e) => setBgFilter(e.target.value)}
              className="inline-select" title="Filter by background generation model (gen: tag)">
              <option value="all">All backgrounds</option>
              {provenanceOptions.bg.map((k) => (
                <option key={k} value={k}>{k.replace('google/', '')}</option>
              ))}
            </select>
            <select value={inpaintFilter} onChange={(e) => setInpaintFilter(e.target.value)}
              className="inline-select" title="Filter by inpaint lane/model (inpaint: tag)">
              <option value="all">All inpaints</option>
              {provenanceOptions.inpaint.map((k) => (
                <option key={k} value={k}>{k.replace('google/', '')}</option>
              ))}
            </select>
            <select value={cutoutFilter} onChange={(e) => setCutoutFilter(e.target.value)}
              className="inline-select" title="Filter by cutout technique/model (cutout: tag)">
              <option value="all">All crops</option>
              {provenanceOptions.cutout.map((k) => (
                <option key={k} value={k}>{k.replace('google/', '')}</option>
              ))}
            </select>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as GallerySortMode)}
              className="inline-select"
              title="Browse order only. Game order lives in Lineup."
            >
              <option value="newest">Newest first</option>
              <option value="name">Name A-Z</option>
              <option value="dogs">Entities high-low</option>
              <option value="regeneration">Redo candidates high-low</option>
            </select>
            <span style={{ color: '#888', fontSize: '0.8rem' }}>Show:</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85rem', color: !lineupOnly ? '#67e8f9' : '#ccc', fontWeight: !lineupOnly ? 700 : 400 }}>
              <input
                type="radio"
                name="gallery-scope"
                checked={!lineupOnly}
                onChange={() => setLineupOnly(false)}
              />
              All active ({activeLevelCount})
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85rem', color: lineupOnly ? '#67e8f9' : '#ccc', fontWeight: lineupOnly ? 700 : 400 }}>
              <input
                type="radio"
                name="gallery-scope"
                checked={lineupOnly}
                onChange={() => setLineupOnly(true)}
              />
              Lineup ({visibleLineupCount})
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85rem', color: showArchived ? '#f0a860' : '#ccc', fontWeight: showArchived ? 700 : 400 }}>
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Show archived
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85rem', color: '#ccc' }}>
              <input
                type="checkbox"
                checked={groupBySetting}
                onChange={(e) => setGroupBySetting(e.target.checked)}
              />
              Group
            </label>
            <button className="btn" onClick={refresh}>Refresh</button>
          </div>
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: '#888', fontSize: '0.8rem' }}>Needs work:</span>
          {HUMAN_REVIEW_STATES.map((reviewState) => (
            <label key={reviewState} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', color: '#ccc' }}>
              <input
                type="checkbox"
                checked={humanReviewFilter[reviewState]}
                onChange={(e) => setHumanReviewFilter((prev) => ({ ...prev, [reviewState]: e.target.checked }))}
              />
              {HUMAN_REVIEW_FILTER_LABELS[reviewState]}
              <span style={{ color: '#777' }}>({humanReviewCounts[reviewState]})</span>
            </label>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {lineupError && <span style={{ fontSize: '0.8rem', color: '#ff8080' }}>{lineupError}</span>}
          </div>
        </div>
      </div>

      {loading && <p style={{ color: '#888' }}>Loading…</p>}
      {error && <p style={{ color: '#c55' }}>Error: {error}</p>}
      {!loading && !error && filtered.length === 0 && (
        <p style={{ color: '#888' }}>No cards match the current filters.</p>
      )}

      {grouped.map(([setting, cards]) => (
        <div key={setting} className="step" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>
            {setting === 'all' ? 'All cards' : (config.settings[setting]?.label ?? setting)}
            <span style={{ color: '#888', fontWeight: 'normal', marginLeft: 8, fontSize: '0.85rem' }}>
              ({cards.length})
            </span>
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
            {cards.map((c) => (
              <GalleryCard
                key={c.id}
                card={c}
                index={filtered.findIndex((card) => card.id === c.id)}
                selectedInLineup={lineupIds.has(c.session.id)}
                lineupBusy={lineupSavingId === c.id}
                visibilityIssues={visibilityBySessionId[c.session.id] ?? []}
                onOpenWizard={onOpen}
                onOpenReview={handleCardOpen}
                onToggleLineup={toggleLineupMembership}
                onArchivedChanged={handleArchivedChanged}
              />
            ))}
          </div>
        </div>
      ))}

      {reviewStartCardId !== null && (
        <GalleryReviewModal
          cards={filtered}
          startCardId={reviewStartCardId}
          config={config}
          onClose={handleModalClose}
          onArchivedChanged={handleArchivedChanged}
          onReviewChanged={handleReviewChanged}
        />
      )}
    </div>
  );
}

function HumanReviewBadge({
  children,
  tone,
  title,
}: {
  children: ReactNode;
  tone: 'good' | 'pending' | 'final';
  title: string;
}) {
  const colors = {
    good: { background: '#183c2c', color: '#9bf0bf', border: '#38865d' },
    pending: { background: '#3d2d17', color: '#ffd39a', border: '#8a6030' },
    final: { background: '#493b13', color: '#ffe28a', border: '#a78726' },
  }[tone];
  return (
    <span title={title} style={{
      background: colors.background,
      color: colors.color,
      border: `1px solid ${colors.border}`,
      borderRadius: 4,
      padding: '2px 5px',
      fontSize: 10,
      lineHeight: 1.2,
      fontWeight: 850,
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

function HumanReviewBadges({ session }: { session: SessionListItem }) {
  const review = humanReviewSummary(session);
  if (review.packageOnly) {
    return (
      <div data-review-state="package-only" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <HumanReviewBadge tone="pending" title="Only the shipped package remains; the authoring session was deleted. Nothing here can be reviewed or edited.">Package only</HumanReviewBadge>
      </div>
    );
  }
  return (
    <div data-review-state={review.state} style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {review.hitboxesReviewed ? (
        <HumanReviewBadge tone="good" title="A human reviewed the current hitbox geometry.">✓ Hitboxes reviewed</HumanReviewBadge>
      ) : (
        <HumanReviewBadge tone="pending" title="A human has not reviewed the current hitbox geometry.">{HUMAN_REVIEW_FILTER_LABELS['needs-hitbox-review']}</HumanReviewBadge>
      )}
      {review.state === 'needs-cutout-review' ? (
        <HumanReviewBadge tone="pending" title="Current cutouts and sprite placements need human review.">{HUMAN_REVIEW_FILTER_LABELS['needs-cutout-review']}</HumanReviewBadge>
      ) : review.cutoutsReviewed ? (
        <HumanReviewBadge tone="final" title="A human reviewed the current cutout pixels and sprite placements.">★ Cutouts reviewed</HumanReviewBadge>
      ) : null}
    </div>
  );
}

function GalleryCard({
  card,
  index,
  selectedInLineup,
  lineupBusy,
  onOpenWizard,
  onOpenReview,
  onToggleLineup,
  onArchivedChanged,
  visibilityIssues,
}: {
  card: VariantCard;
  index: number;
  selectedInLineup: boolean;
  lineupBusy: boolean;
  onOpenWizard: (sessionId: string) => void;
  onOpenReview: (cardId: string) => void;
  onToggleLineup: (card: VariantCard, selectable: boolean) => void;
  onArchivedChanged: (id: string, archived: boolean, variant?: string) => void;
  visibilityIssues: VisibilityIssue[];
}) {
  const { session, variant, state } = card;
  const thumbSrc = variantThumbnailUrl(session, variant);
  const [thumbFailed, setThumbFailed] = useState(false);
  useEffect(() => {
    setThumbFailed(false);
  }, [variant, session.id, session.assetVersion]);
  const visibilitySummaries = useMemo(() => summarizeVisibilityIssues(visibilityIssues), [visibilityIssues]);
  const blockerCount = blockingVisibilitySummaries(visibilitySummaries).length;
  const warnCount = visibilitySummaries.length;
  const fullyReviewed = humanReviewSummary(session).state === 'reviewed';
  const quarantined = session.canonicalState === 'quarantined_integrity';
  const missingAssetReason = state !== 'background' && session.hasImage === false
    ? 'Missing composite image asset. Open in Wizard or review assets before adding this level to Lineup.'
    : state !== 'background' && session.hasThumbnail === false
      ? 'Missing preview thumbnail asset. Repair assets before adding this level to Lineup.'
      : null;
  const selectableForLineup = !card.archived && !quarantined && state !== 'background' && blockerCount === 0 && missingAssetReason === null;
  const disabledReason = card.archived
    ? 'Archived cards are not selectable for Lineup.'
    : quarantined
      ? 'Bird mappings need repair before this level can be added or republished.'
    : missingAssetReason
      ? missingAssetReason
      : state === 'background'
        ? 'Place and inpaint entities before adding this level to Lineup.'
        : blockerCount > 0
          ? 'Fix blocking visibility issues before adding this level to Lineup.'
          : null;

  return (
    <div
      data-gallery-card-id={card.id}
      data-lineup-selected={selectedInLineup ? 'true' : 'false'}
      style={{
        border: `1px solid ${selectedInLineup ? '#74d680' : state === 'exported' ? '#2a6b4e' : state === 'inpainted' ? '#333' : '#2a2a44'}`,
        borderRadius: 8,
        overflow: 'hidden',
        background: '#0a0a0a',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
        MozUserSelect: 'none',
        WebkitUserDrag: 'none',
        boxShadow: selectedInLineup ? '0 0 0 2px rgba(116, 214, 128, 0.45)' : 'none',
        transition: 'border-color 120ms ease, box-shadow 120ms ease',
      } as CSSProperties & { MozUserSelect: string; WebkitUserDrag: string }}
      title={`${session.name} · ${variant}`}
      onDragStartCapture={(e) => {
        e.preventDefault();
      }}
    >
      <button
        type="button"
        draggable={false}
        tabIndex={-1}
        onClick={() => onOpenReview(card.id)}
        onMouseDown={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
        onDragStartCapture={(e) => e.preventDefault()}
        style={{
          padding: 0,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          userSelect: 'none',
          WebkitUserDrag: 'none',
        } as CSSProperties & { WebkitUserDrag: string }}
      >
        {thumbFailed ? (
          <div
            style={{
              width: '100%',
              aspectRatio: '1/1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#111',
              color: '#888',
              fontSize: '0.76rem',
              fontWeight: 700,
            }}
          >
            No preview
          </div>
        ) : (
          <img
            src={thumbSrc}
            alt=""
            loading={index < 8 ? 'eager' : 'lazy'}
            decoding="async"
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            style={{
              width: '100%',
              aspectRatio: '1/1',
              objectFit: 'cover',
              display: 'block',
              background: '#111',
              userSelect: 'none',
              WebkitUserDrag: 'none',
              MozUserSelect: 'none',
            } as CSSProperties & { WebkitUserDrag: string }}
            onError={() => setThumbFailed(true)}
          />
        )}
      </button>
      <div style={{ position: 'absolute', top: 8, left: 8, right: 52, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{
          background: 'rgba(0,0,0,0.78)',
          color: '#d8d8d8',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 3,
          padding: '2px 6px',
          fontSize: '0.68rem',
          lineHeight: 1.1,
          fontWeight: 800,
          userSelect: 'none',
        }}>
          #{index + 1}
        </span>
        <span style={{
          background: 'rgba(0,0,0,0.72)', color: '#fff',
          fontSize: '0.65rem', padding: '2px 6px', borderRadius: 3, fontWeight: 600,
        }}>{VARIANT_LABELS[variant] ?? variant}</span>
        {selectedInLineup && (
          <span style={{
            background: 'rgba(49, 112, 72, 0.92)',
            color: '#d7ffd8',
            fontSize: '0.65rem',
            padding: '2px 6px',
            borderRadius: 3,
            fontWeight: 700,
            border: '1px solid rgba(116, 214, 128, 0.35)',
          }}>
            in Lineup
          </span>
        )}
        {warnCount > 0 && (
          <span
            title={blockerCount > 0 ? `${blockerCount} danger-zone hitbox issue(s)` : `${warnCount} mobile border warning(s)`}
            style={{
              marginLeft: 'auto',
              background: blockerCount > 0 ? 'rgba(128, 31, 31, 0.9)' : 'rgba(122, 83, 20, 0.9)',
              color: '#fff2c2',
              fontSize: '0.65rem',
              padding: '2px 6px',
              borderRadius: 3,
              fontWeight: 700,
              border: '1px solid rgba(255, 205, 90, 0.45)',
            }}
          >
            ! {warnCount}
          </span>
        )}
      </div>
      {fullyReviewed && (
        <div
          aria-label="Fully reviewed"
          title="Hitboxes and cutouts are human reviewed"
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            width: 36,
            height: 36,
            display: 'grid',
            placeItems: 'center',
            borderRadius: '50%',
            background: 'rgba(20, 15, 3, 0.88)',
            border: '1px solid rgba(255, 220, 92, 0.72)',
            color: '#ffdc5c',
            fontSize: '1.55rem',
            lineHeight: 1,
            textShadow: '0 1px 5px rgba(0, 0, 0, 0.9)',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
            pointerEvents: 'none',
          }}
        >
          ★
        </div>
      )}
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session.name}
        </div>
        <div style={{ fontSize: '0.7rem', color: '#888' }}>
          {session.nDogs} dogs
        </div>
        {quarantined && (
          <HumanReviewBadge tone="pending" title="Artifact identity or provenance needs repair before publishing.">Needs repair</HumanReviewBadge>
        )}
        <HumanReviewBadges session={session} />
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', fontSize: '0.68rem' }}>
          {(session.regenerationCandidateCount ?? 0) > 0 && (
            <span style={{ color: '#ffb06b', fontWeight: 750 }}>
              Redo candidates {session.regenerationCandidateCount}
            </span>
          )}
        </div>
        {disabledReason && (
          <div style={{ fontSize: '0.72rem', color: '#d6b75c' }}>
            {disabledReason}
          </div>
        )}
        <button
          type="button"
          data-gallery-no-reorder="true"
          onClick={(e) => { e.stopPropagation(); onOpenWizard(session.id); }}
          title="Load this level into the Wizard for full editing"
          style={{
            marginTop: 4,
            background: '#1f2a3a',
            color: '#c0dff5',
            border: '1px solid #2a4a6b',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: '0.75rem',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Open in Wizard
        </button>
        <button
          type="button"
          data-gallery-no-reorder="true"
          onClick={async (e) => {
            e.stopPropagation();
            const next = !card.archived;
            try {
              await setArchived(session.id, next, variant);
              onArchivedChanged(session.id, next, variant);
            } catch (err) {
              console.error('archive failed', err);
            }
          }}
          title={card.archived
            ? 'Restore this card into the active gallery'
            : 'Archive this card (hidden unless SHOW ARCHIVED; never selectable for Lineup)'}
          style={{
            background: card.archived ? '#332a1f' : '#2a1f1f',
            color: card.archived ? '#e8d5bf' : '#e8bfbf',
            border: `1px solid ${card.archived ? '#6b4a2a' : '#6b2a2a'}`,
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: '0.75rem',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          {card.archived ? 'Unarchive' : 'Archive'}
        </button>
      </div>
    </div>
  );
}
