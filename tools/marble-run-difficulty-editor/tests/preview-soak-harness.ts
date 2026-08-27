import { LEVELS } from '../../../games/marble_run/src/levels/levels.generated.ts';

import { EditorGameplayPreview } from '../src/preview/EditorGameplayPreview.ts';

export interface PreviewSoakResult {
  readonly cycles: number;
  readonly peakCanvases: number;
  readonly peakContexts: number;
  readonly retainedContexts: number;
  readonly peakAnimationFrames: number;
  readonly activeAnimationFrames: number;
  readonly activeResizeListeners: number;
  readonly activeWindowPointerListeners: number;
  readonly browserHarnessPointerListeners: number;
  readonly activeCanvasPointerListeners: number;
  readonly hostRetained: boolean;
}

const POINTER_TYPES = new Set(['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture']);

/** Runs in real Chromium through Vite; unit DOM shims cannot prove WebGL lifecycle. */
export async function runPreviewSoak(): Promise<PreviewSoakResult> {
  const originalWindowAdd = window.addEventListener.bind(window);
  const originalWindowRemove = window.removeEventListener.bind(window);
  const originalCanvasAdd = HTMLCanvasElement.prototype.addEventListener;
  const originalCanvasRemove = HTMLCanvasElement.prototype.removeEventListener;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalRaf = window.requestAnimationFrame.bind(window);
  const originalCancelRaf = window.cancelAnimationFrame.bind(window);
  const resizeListeners = new Set<EventListenerOrEventListenerObject>();
  const windowPointerListeners = new Set<EventListenerOrEventListenerObject>();
  const canvasPointerListeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const canvasPointerCount = (): number => [...canvasPointerListeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  const contexts = new Set<RenderingContext>();
  const lostContexts = new Set<RenderingContext>();
  const activeFrames = new Set<number>();
  let peakContexts = 0;
  let peakCanvases = 0;
  let peakAnimationFrames = 0;
  let browserHarnessPointerListeners: number | null = null;

  window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    if (type === 'resize') resizeListeners.add(listener);
    if (type === 'pointerdown') windowPointerListeners.add(listener);
    (originalWindowAdd as (event: string, callback: EventListenerOrEventListenerObject, config?: boolean | AddEventListenerOptions) => void)(type, listener, options);
  }) as typeof window.addEventListener;
  window.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
    if (type === 'resize') resizeListeners.delete(listener);
    if (type === 'pointerdown') windowPointerListeners.delete(listener);
    (originalWindowRemove as (event: string, callback: EventListenerOrEventListenerObject, config?: boolean | EventListenerOptions) => void)(type, listener, options);
  }) as typeof window.removeEventListener;
  HTMLCanvasElement.prototype.addEventListener = function(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
    if (POINTER_TYPES.has(type)) {
      const listeners = canvasPointerListeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
      listeners.add(listener);
      canvasPointerListeners.set(type, listeners);
    }
    originalCanvasAdd.call(this, type, listener, options);
  };
  HTMLCanvasElement.prototype.removeEventListener = function(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void {
    if (POINTER_TYPES.has(type)) canvasPointerListeners.get(type)?.delete(listener);
    originalCanvasRemove.call(this, type, listener, options);
  };
  HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, contextId: string, options?: unknown): RenderingContext | null {
    const context = originalGetContext.call(this, contextId as '2d', options as CanvasRenderingContext2DSettings);
    if ((contextId === 'webgl' || contextId === 'webgl2') && context !== null && !contexts.has(context)) {
      contexts.add(context);
      peakContexts = Math.max(peakContexts, contexts.size - lostContexts.size);
      this.addEventListener('webglcontextlost', () => lostContexts.add(context), { once: true });
    }
    return context;
  } as typeof HTMLCanvasElement.prototype.getContext;
  window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    let handle = 0;
    handle = originalRaf((time) => { activeFrames.delete(handle); callback(time); });
    activeFrames.add(handle);
    peakAnimationFrames = Math.max(peakAnimationFrames, activeFrames.size);
    return handle;
  };
  window.cancelAnimationFrame = (handle: number): void => {
    activeFrames.delete(handle);
    originalCancelRaf(handle);
  };

  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', inset: '0', width: '900px', height: '700px' });
  document.body.append(host);
  const ids = [1, 46, 90] as const;
  try {
    for (let cycle = 0; cycle < 30; cycle += 1) {
      const preview = new EditorGameplayPreview(host);
      preview.open(LEVELS[ids[cycle % ids.length] - 1]!);
      await new Promise<void>((resolve) => originalRaf(() => originalRaf(() => resolve())));
      peakCanvases = Math.max(peakCanvases, host.querySelectorAll('canvas').length);
      if (host.querySelectorAll('canvas').length !== 1) throw new Error(`Cycle ${cycle + 1} mounted more than one canvas.`);
      const expectedHarnessPointers: number = browserHarnessPointerListeners ?? 0;
      if (resizeListeners.size !== 1 || windowPointerListeners.size !== expectedHarnessPointers || canvasPointerCount() !== 4) throw new Error(`Cycle ${cycle + 1} listener ownership was resize=${resizeListeners.size}, windowPointer=${windowPointerListeners.size}, canvasPointer=${canvasPointerCount()}.`);
      if (activeFrames.size > 1) throw new Error(`Cycle ${cycle + 1} duplicated the animation loop.`);
      preview.close();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
      if (host.querySelectorAll('canvas').length !== 0) throw new Error(`Cycle ${cycle + 1} retained a canvas.`);
      if (browserHarnessPointerListeners === null) browserHarnessPointerListeners = windowPointerListeners.size;
      if (browserHarnessPointerListeners > 1) throw new Error(`Browser harness installed ${browserHarnessPointerListeners} pointer listeners.`);
      const retainedPreviewListeners = resizeListeners.size + canvasPointerCount();
      if (retainedPreviewListeners !== 0 || windowPointerListeners.size !== browserHarnessPointerListeners) throw new Error(`Cycle ${cycle + 1} retained listeners: resize=${resizeListeners.size}, windowPointer=${windowPointerListeners.size}, canvasPointer=${canvasPointerCount()}.`);
      if (activeFrames.size !== 0) throw new Error(`Cycle ${cycle + 1} retained an animation frame.`);
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    return {
      cycles: 30,
      peakCanvases,
      peakContexts,
      retainedContexts: contexts.size - lostContexts.size,
      peakAnimationFrames,
      activeAnimationFrames: activeFrames.size,
      activeResizeListeners: resizeListeners.size,
      activeWindowPointerListeners: windowPointerListeners.size - (browserHarnessPointerListeners ?? 0),
      browserHarnessPointerListeners: browserHarnessPointerListeners ?? 0,
      activeCanvasPointerListeners: canvasPointerCount(),
      hostRetained: host.isConnected,
    };
  } finally {
    host.remove();
    window.addEventListener = originalWindowAdd;
    window.removeEventListener = originalWindowRemove;
    HTMLCanvasElement.prototype.addEventListener = originalCanvasAdd;
    HTMLCanvasElement.prototype.removeEventListener = originalCanvasRemove;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
  }
}
