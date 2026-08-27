import { useEffect, useRef, useState } from 'react';

import type { LevelDef } from '../../../../../games/marble_run/src/marble-board/types.ts';
import { EditorGameplayPreview, type PreviewOutcome } from '../../preview/EditorGameplayPreview.ts';

interface PlayViewProps {
  readonly board: LevelDef;
  readonly canRegenerate: boolean;
  readonly onRegenerate: () => void;
  readonly onClose: () => void;
}

export function PlayView({ board, canRegenerate, onRegenerate, onClose }: PlayViewProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const preview = useRef<EditorGameplayPreview | null>(null);
  const [outcome, setOutcome] = useState<PreviewOutcome>('playing');

  useEffect(() => {
    if (host.current === null) return undefined;
    const instance = new EditorGameplayPreview(host.current, { onOutcome: setOutcome });
    preview.current = instance;
    instance.open(board);
    return () => {
      preview.current = null;
      instance.dispose();
    };
  }, [board]);

  return (
    <section className="play-view" data-play-level={board.id} aria-label={`Play level ${board.id}`}>
      <div className="play-view__bar">
        <div><span>Draft preview</span><strong>Play level {board.id}</strong></div>
        <div className="play-view__actions">
          <button type="button" data-action="restart" onClick={() => preview.current?.restart()}>Restart</button>
          <button type="button" data-action="regenerate" disabled={!canRegenerate} onClick={onRegenerate}>Regenerate level</button>
          <button type="button" data-action="close-play" onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="play-view__stage" ref={host} />
      {outcome !== 'playing' && <div className="play-view__outcome" role="status">{outcome === 'won' ? 'Board cleared' : 'Run ended'} · Restart or close preview.</div>}
    </section>
  );
}
