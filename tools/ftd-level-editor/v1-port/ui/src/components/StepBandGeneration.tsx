import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SessionResponse } from '../types';
import {
  acceptExtension,
  bandImageUrl,
  clearExtension,
  type BandSide,
} from '../api/editorApi';
import type { useBandGenStream } from '../api/useBandGenStream';
import { sessionQueryKey } from '../api/useSessionQuery';
import StepHeader from './StepHeader';

interface Props {
  sessionId: string;
  extension: SessionResponse['extension'];
  extensionBands: SessionResponse['extensionBands'];
  bandGen: ReturnType<typeof useBandGenStream>;
  collapsed: boolean;
}

/**
 * "Extend scene" stage: generate + curate the dog-free top/bottom scenery bands
 * that grow a finished level toward the tall-phone target aspect, then accept
 * them (writing the extension config so export/publish ship an extension level).
 * Mirrors the durable-job UX of StepInpaint via the band-gen poll stream.
 */
export default function StepBandGeneration({
  sessionId, extension, extensionBands, bandGen, collapsed,
}: Props) {
  const queryClient = useQueryClient();
  const { status, start, resume } = bandGen;
  const [topPrompt, setTopPrompt] = useState('');
  const [bottomPrompt, setBottomPrompt] = useState('');
  // Cache-buster for the band <img>s: bump whenever a generation run finishes so
  // a regenerated band (same path) actually reloads.
  const [version, setVersion] = useState(0);
  const [accepting, setAccepting] = useState(false);

  const accepted = extension != null;
  // A band is present if this run's poll saw it OR the session reports it on disk
  // (so a reload re-surfaces completed bands + the Accept action without a fresh
  // paid regeneration).
  const hasTop = status.top || Boolean(extensionBands?.top);
  const hasBottom = status.bottom || Boolean(extensionBands?.bottom);
  const bothReady = hasTop && hasBottom;

  // Resume an in-flight band job after a reload / step remount (mirrors StepInpaint).
  useEffect(() => {
    resume(sessionId);
  }, [resume, sessionId]);

  useEffect(() => {
    if (!status.generating) setVersion((v) => v + 1);
  }, [status.generating, status.top, status.bottom]);

  const generateBoth = useCallback(() => {
    start(sessionId, ['top', 'bottom'], topPrompt.trim() || undefined, bottomPrompt.trim() || undefined);
  }, [start, sessionId, topPrompt, bottomPrompt]);

  const regen = useCallback(
    (side: BandSide) => {
      const prompt = (side === 'top' ? topPrompt : bottomPrompt).trim() || undefined;
      start(sessionId, [side], side === 'top' ? prompt : undefined, side === 'bottom' ? prompt : undefined);
    },
    [start, sessionId, topPrompt, bottomPrompt],
  );

  const refreshSession = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: sessionQueryKey(sessionId) });
  }, [queryClient, sessionId]);

  const onAccept = useCallback(async () => {
    setAccepting(true);
    try {
      await acceptExtension(sessionId);
      refreshSession();
    } finally {
      setAccepting(false);
    }
  }, [sessionId, refreshSession]);

  const onClear = useCallback(async () => {
    setAccepting(true);
    try {
      await clearExtension(sessionId);
      refreshSession();
    } finally {
      setAccepting(false);
    }
  }, [sessionId, refreshSession]);

  const summary = accepted ? 'Scene extended ✓' : 'Optional — fill tall screens with generated scenery.';

  return (
    <div className="step">
      <StepHeader stepNumber={5} title="Extend Scene" collapsed={collapsed} summary={summary} />
      {!collapsed && (
        <div className="step-content">
          <p style={{ color: '#aaa', marginTop: 0 }}>
            Generate dog-free top and bottom bands that continue this scene, growing it
            to fill tall phone screens. Optional — a level without an extension ships at
            its native aspect.
          </p>

          {accepted ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ color: '#7dd87d' }}>
                ✓ Extended (bands: {extension?.bandsRef}, target {extension?.targetAspect}:1)
              </span>
              <button className="btn" disabled={accepting} onClick={onClear}>
                Remove extension
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <button
                  className="btn btn-primary"
                  disabled={status.generating}
                  onClick={generateBoth}
                >
                  {status.generating ? 'Generating…' : bothReady ? 'Regenerate both' : 'Generate bands'}
                </button>
                {bothReady && !status.generating && (
                  <button className="btn btn-primary" disabled={accepting} onClick={onAccept}>
                    Accept extension
                  </button>
                )}
              </div>

              {status.failed && status.error && (
                <p style={{ color: '#e88' }}>Band generation failed: {status.error}</p>
              )}

              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {(['top', 'bottom'] as BandSide[]).map((side) => (
                  <div key={side} style={{ flex: '1 1 220px', minWidth: 200 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4, textTransform: 'capitalize' }}>
                      {side} band
                    </div>
                    {(side === 'top' ? hasTop : hasBottom) ? (
                      <img
                        src={bandImageUrl(sessionId, side, version)}
                        alt={`${side} band`}
                        style={{ width: '100%', border: '1px solid #333', display: 'block' }}
                      />
                    ) : (
                      <div style={{ color: '#777', fontStyle: 'italic', padding: '8px 0' }}>
                        {status.generating ? 'generating…' : 'not generated yet'}
                      </div>
                    )}
                    <textarea
                      value={side === 'top' ? topPrompt : bottomPrompt}
                      onChange={(e) =>
                        side === 'top' ? setTopPrompt(e.target.value) : setBottomPrompt(e.target.value)
                      }
                      placeholder={`Optional prompt override for the ${side} band`}
                      rows={2}
                      style={{ width: '100%', marginTop: 6, resize: 'vertical' }}
                    />
                    <button
                      className="btn"
                      disabled={status.generating}
                      onClick={() => regen(side)}
                      style={{ marginTop: 4 }}
                    >
                      Regenerate {side}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
