import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

type ScrollAxis = 'horizontal' | 'vertical';

interface ScrollRailProps {
  readonly axis: ScrollAxis;
  readonly targetRef: RefObject<HTMLElement | null>;
}

interface RailState {
  readonly extent: number;
  readonly offset: number;
  readonly viewport: number;
}

const EMPTY_RAIL: RailState = { extent: 0, offset: 0, viewport: 0 };

export function ScrollRail({ axis, targetRef }: ScrollRailProps): React.JSX.Element | null {
  const trackRef = useRef<HTMLDivElement>(null);
  const [rail, setRail] = useState<RailState>(EMPTY_RAIL);

  const measure = useCallback(() => {
    const target = targetRef.current;
    if (target === null) return;
    setRail(axis === 'horizontal'
      ? { extent: target.scrollWidth, offset: target.scrollLeft, viewport: target.clientWidth }
      : { extent: target.scrollHeight, offset: target.scrollTop, viewport: target.clientHeight });
  }, [axis, targetRef]);

  useEffect(() => {
    const target = targetRef.current;
    if (target === null) return undefined;
    measure();
    target.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(target);
    window.addEventListener('resize', measure);
    return () => {
      target.removeEventListener('scroll', measure);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, targetRef]);

  if (rail.extent <= rail.viewport + 1 || rail.viewport === 0) return null;

  const thumbFraction = rail.viewport / rail.extent;
  const thumbSize = `${Math.max(7, thumbFraction * 100)}%`;
  const thumbOffset = `${rail.offset / rail.extent * 100}%`;

  const scrollFromPointer = (event: PointerEvent<HTMLDivElement>, grabFraction = thumbFraction / 2) => {
    const target = targetRef.current;
    const track = trackRef.current;
    if (target === null || track === null) return;
    const rect = track.getBoundingClientRect();
    const pointer = axis === 'horizontal' ? event.clientX - rect.left : event.clientY - rect.top;
    const trackSize = axis === 'horizontal' ? rect.width : rect.height;
    const nextFraction = Math.max(0, Math.min(1 - thumbFraction, pointer / trackSize - grabFraction));
    if (axis === 'horizontal') target.scrollLeft = nextFraction * rail.extent;
    else target.scrollTop = nextFraction * rail.extent;
  };

  return (
    <div
      aria-hidden="true"
      className={`scroll-rail scroll-rail--${axis}`}
      ref={trackRef}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        const thumb = (event.target as HTMLElement).closest<HTMLElement>('.scroll-rail__thumb');
        const trackRect = event.currentTarget.getBoundingClientRect();
        const pointer = axis === 'horizontal' ? event.clientX - trackRect.left : event.clientY - trackRect.top;
        const thumbStart = rail.offset / rail.extent * (axis === 'horizontal' ? trackRect.width : trackRect.height);
        const grabFraction = thumb === null ? thumbFraction / 2 : Math.max(0, pointer - thumbStart) / (axis === 'horizontal' ? trackRect.width : trackRect.height);
        scrollFromPointer(event, grabFraction);
        const move = (moveEvent: globalThis.PointerEvent) => scrollFromPointer(moveEvent as unknown as PointerEvent<HTMLDivElement>, grabFraction);
        const stop = () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', stop);
          document.removeEventListener('pointercancel', stop);
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', stop, { once: true });
        document.addEventListener('pointercancel', stop, { once: true });
      }}
    >
      <span className="scroll-rail__thumb" style={axis === 'horizontal' ? { left: thumbOffset, width: thumbSize } : { height: thumbSize, top: thumbOffset }} />
    </div>
  );
}

