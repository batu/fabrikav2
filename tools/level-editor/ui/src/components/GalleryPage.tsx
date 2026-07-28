import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  listSessions,
  checkMobileVisibilityBatch,
  getSequenceWorkflow,
  saveSequenceDraft,
  type SessionListItem,
  type SequenceWorkflowState,
  type VisibilityIssue,
} from '../api/editorApi';
import type { ConfigResponse } from '../types';
import { blockingVisibilitySummaries, summarizeVisibilityIssues } from '../lib/visibilityWarnings';
import GalleryReviewModal from './GalleryReviewModal';

interface Props {
  config: ConfigResponse;
  onOpen: (sessionId: string) => void;
}

type ModelFilter = 'all' | string;
type CardState = 'background' | 'inpainted' | 'exported';
type GallerySortMode = 'newest' | 'name' | 'dogs';

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

function variantPreviewUrl(session: SessionListItem, variant: string): string {
  const version = session.assetVersion ? `?v=${session.assetVersion}` : '';
  return `/api/sessions/${encodeURIComponent(session.id)}/gallery-preview/${encodeURIComponent(variant)}${version}`;
}

function compositeDownloadName(session: SessionListItem, variant: string): string {
  const variantLabel = (VARIANT_LABELS[variant] ?? variant).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const sessionLabel = session.id.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '');
  return `${sessionLabel || 'level'}-${variantLabel || 'composite'}.png`;
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
interface VariantCard {
  id: string;          // stable per card: `${session.id}::${variant}`
  session: SessionListItem;
  variant: string;
  state: CardState;
  archived: boolean;
}

function isVariantArchived(session: SessionListItem, variant: string): boolean {
  if (session.archived) return true;
  return (session.archivedVariants ?? []).includes(variant);
}

function sessionCreatedAtMs(session: SessionListItem): number {
  const parsed = Date.parse(session.createdAt ?? '');
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortCards(cards: VariantCard[], sortMode: GallerySortMode): VariantCard[] {
  return cards.slice().sort((a, b) => {
    if (sortMode === 'name') {
      const nameDelta = a.session.name.localeCompare(b.session.name);
      if (nameDelta !== 0) return nameDelta;
    } else if (sortMode === 'dogs') {
      const dogsDelta = b.session.nDogs - a.session.nDogs;
      if (dogsDelta !== 0) return dogsDelta;
    }

    const createdDelta = sessionCreatedAtMs(b.session) - sessionCreatedAtMs(a.session);
    if (createdDelta !== 0) return createdDelta;
    if (a.session.id !== b.session.id) return a.session.id.localeCompare(b.session.id);
    return a.variant.localeCompare(b.variant);
  });
}

export default function GalleryPage({ config, onOpen }: Props) {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [lineupState, setLineupState] = useState<SequenceWorkflowState | null>(null);
  const [lineupSavingId, setLineupSavingId] = useState<string | null>(null);
  const [lineupError, setLineupError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingFilter, setSettingFilter] = useState<string>('all');
  const [modelFilter, setModelFilter] = useState<ModelFilter>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [stateFilter, setStateFilter] = useState<Record<CardState, boolean>>({
    background: true,
    inpainted: true,
    exported: true,
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
        out.push({
          id: `${s.id}::${v}`,
          session: s,
          variant: v,
          state: variantCardState(s, v),
          archived: isVariantArchived(s, v),
        });
      }
    }
    return out;
  }, [sessions]);

  const settingKeys = useMemo(
    () => Array.from(new Set(sessions.map((s) => s.setting))).sort(),
    [sessions],
  );
  const modelKeys = useMemo(
    () => Array.from(new Set(sessions.map((s) => s.model).filter(Boolean) as string[])).sort(),
    [sessions],
  );
  const tagKeys = useMemo(
    () => Array.from(new Set(sessions.flatMap((s) => s.tags ?? []))).sort(),
    [sessions],
  );

  const orderedAllCards = useMemo(
    () => sortCards(allCards, sortMode),
    [allCards, sortMode],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orderedAllCards
      .filter((c) => (showArchived ? true : !c.archived))
      .filter((c) => (settingFilter === 'all' ? true : c.session.setting === settingFilter))
      .filter((c) => (modelFilter === 'all' ? true : c.session.model === modelFilter))
      .filter((c) => selectedTags.every((tag) => (c.session.tags ?? []).includes(tag)))
      .filter((c) => stateFilter[c.state])
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
      });
  }, [orderedAllCards, showArchived, settingFilter, modelFilter, selectedTags, stateFilter, search, config.settings]);

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
    if (!groupBySetting) return [['all', filtered] as const];
    const g = new Map<string, VariantCard[]>();
    for (const c of filtered) {
      const cards = g.get(c.session.setting) ?? [];
      cards.push(c);
      g.set(c.session.setting, cards);
    }
    return Array.from(g.entries());
  }, [filtered, groupBySetting]);

  const stateCounts = useMemo(() => {
    const c: Record<CardState, number> = { background: 0, inpainted: 0, exported: 0 };
    for (const card of allCards) c[card.state]++;
    return c;
  }, [allCards]);

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

  const selectedCount = lineupState?.draft.levelIds.length ?? 0;

  return (
    <div className="pipeline-body" style={{ padding: 16 }}>
      <div className="step" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>Gallery</h2>
          <span style={{ color: '#888', fontSize: '0.85rem' }}>
            {filtered.length} / {allCards.length} cards · {selectedCount} selected for Lineup
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, setting, scene, tags"
              style={{ background: '#111', border: '1px solid #333', borderRadius: 6, color: '#e0e0e0', padding: '6px 10px' }}
            />
            <select
              value={settingFilter}
              onChange={(e) => setSettingFilter(e.target.value)}
              className="inline-select"
            >
              <option value="all">All settings</option>
              {settingKeys.map((k) => (
                <option key={k} value={k}>{config.settings[k]?.label ?? k}</option>
              ))}
            </select>
            <select
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              className="inline-select"
              title="Filter by bg-gen model at session create time."
            >
              <option value="all">All models (gen)</option>
              {modelKeys.map((k) => (
                <option key={k} value={k}>{config.models.find((m) => m.id === k)?.label ?? k}</option>
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
              <option value="dogs">Dogs high-low</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85rem', color: '#ccc' }}>
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
          <span style={{ color: '#888', fontSize: '0.8rem' }}>Completion:</span>
          {(['background', 'inpainted', 'exported'] as CardState[]).map((s) => (
            <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', color: '#ccc' }}>
              <input
                type="checkbox"
                checked={stateFilter[s]}
                onChange={(e) => setStateFilter((prev) => ({ ...prev, [s]: e.target.checked }))}
              />
              <StateBadge state={s} />
              <span style={{ color: '#777' }}>({stateCounts[s]})</span>
            </label>
          ))}
          {tagKeys.length > 0 && (
            <>
              <span style={{ color: '#888', fontSize: '0.8rem' }}>Tags:</span>
              {tagKeys.map((tag) => {
                const tagCount = allCards.filter((card) => (card.session.tags ?? []).includes(tag)).length;
                const checked = selectedTags.includes(tag);
                return (
                  <label key={tag} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', color: '#ccc' }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setSelectedTags((prev) => e.target.checked
                          ? [...prev, tag].sort()
                          : prev.filter((item) => item !== tag));
                      }}
                    />
                    {tag}
                    <span style={{ color: '#777' }}>({tagCount})</span>
                  </label>
                );
              })}
            </>
          )}
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
        />
      )}
    </div>
  );
}

function StateBadge({ state }: { state: CardState }) {
  const tone: Record<CardState, { bg: string; fg: string; label: string }> = {
    background: { bg: '#2a2a44', fg: '#a8a8d8', label: 'bg only' },
    inpainted:  { bg: '#2a4a6b', fg: '#c0dff5', label: 'inpainted' },
    exported:   { bg: '#2a6b4e', fg: '#c5e8c5', label: 'complete' },
  };
  const t = tone[state];
  return (
    <span style={{
      background: t.bg, color: t.fg, fontSize: '0.68rem',
      padding: '1px 6px', borderRadius: 3, fontWeight: 600,
    }}>{t.label}</span>
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
  visibilityIssues,
}: {
  card: VariantCard;
  index: number;
  selectedInLineup: boolean;
  lineupBusy: boolean;
  onOpenWizard: (sessionId: string) => void;
  onOpenReview: (cardId: string) => void;
  onToggleLineup: (card: VariantCard, selectable: boolean) => void;
  visibilityIssues: VisibilityIssue[];
}) {
  const { session, variant, state } = card;
  const thumbSrc = variantThumbnailUrl(session, variant);
  const previewSrc = variantPreviewUrl(session, variant);
  const [thumbFailed, setThumbFailed] = useState(false);
  const downloadName = compositeDownloadName(session, variant);
  useEffect(() => {
    setThumbFailed(false);
  }, [variant, session.id, session.assetVersion]);
  const visibilitySummaries = useMemo(() => summarizeVisibilityIssues(visibilityIssues), [visibilityIssues]);
  const blockerCount = blockingVisibilitySummaries(visibilitySummaries).length;
  const warnCount = visibilitySummaries.length;
  const missingAssetReason = state !== 'background' && session.hasImage === false
    ? 'Missing composite image asset. Open in Wizard or review assets before adding this level to Lineup.'
    : state !== 'background' && session.hasThumbnail === false
      ? 'Missing preview thumbnail asset. Repair assets before adding this level to Lineup.'
      : null;
  const selectableForLineup = !card.archived && state !== 'background' && blockerCount === 0 && missingAssetReason === null;
  const disabledReason = card.archived
    ? 'Archived cards are not selectable for Lineup.'
    : missingAssetReason
      ? missingAssetReason
      : state === 'background'
        ? 'Place and inpaint dogs before adding this level to Lineup.'
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
              aspectRatio: '9/16',
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
              aspectRatio: '9/16',
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
      <div style={{ position: 'absolute', top: 8, left: 8, right: 8, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
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
        <StateBadge state={state} />
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
        {(session.tags ?? []).map((tag) => (
          <span
            key={tag}
            style={{
              background: 'rgba(80, 92, 126, 0.9)',
              color: '#d8e1ff',
              fontSize: '0.65rem',
              padding: '2px 6px',
              borderRadius: 3,
              fontWeight: 700,
              border: '1px solid rgba(180, 195, 255, 0.25)',
            }}
          >
            {tag}
          </span>
        ))}
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
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session.name}
        </div>
        <div style={{ fontSize: '0.7rem', color: '#888' }}>
          {session.nDogs} dogs
        </div>
        {disabledReason && (
          <div style={{ fontSize: '0.72rem', color: '#d6b75c' }}>
            {disabledReason}
          </div>
        )}
        <button
          type="button"
          data-gallery-no-reorder="true"
          onClick={(e) => {
            e.stopPropagation();
            onToggleLineup(card, selectableForLineup);
          }}
          disabled={!selectableForLineup || lineupBusy}
          title={disabledReason ?? (selectedInLineup ? 'Remove this level from Lineup' : 'Add this completed level to Lineup')}
          style={{
            marginTop: 4,
            background: selectedInLineup ? '#23462f' : '#1f3329',
            color: selectedInLineup ? '#d7ffd8' : '#bfe8ce',
            border: selectedInLineup ? '1px solid #74d680' : '1px solid #2f674b',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: '0.75rem',
            cursor: selectableForLineup && !lineupBusy ? 'pointer' : 'not-allowed',
            fontWeight: 700,
            opacity: selectableForLineup ? 1 : 0.6,
          }}
        >
          {lineupBusy ? 'Saving...' : selectedInLineup ? 'Remove from Lineup' : 'Add to Lineup'}
        </button>
        <button
          type="button"
          data-gallery-no-reorder="true"
          onClick={(e) => { e.stopPropagation(); onOpenReview(card.id); }}
          title="Review this Gallery card"
          style={{
            marginTop: 4,
            background: '#242424',
            color: '#ddd',
            border: '1px solid #444',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: '0.75rem',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Review
        </button>
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
        <a
          data-gallery-no-reorder="true"
          href={previewSrc}
          download={downloadName}
          draggable={false}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDragStart={(e) => e.preventDefault()}
          title="Download the currently shown composite image"
          style={{
            background: '#1f3329',
            color: '#bfe8ce',
            border: '1px solid #2f674b',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: '0.75rem',
            cursor: 'pointer',
            fontWeight: 600,
            textAlign: 'center',
            textDecoration: 'none',
          }}
        >
          Save Image
        </a>
      </div>
    </div>
  );
}
