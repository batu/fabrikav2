import { gameState } from '../core/GameState';
import { prefersReducedMotion } from '@fabrikav2/ui';
import { TutorialSequence, type TutorialStage } from './TutorialSequence';

export interface TutorialAnchor {
  dogScreen: { x: number; y: number };
  dogRadius: number;
  targetId: string;
  available: number;
  total: number;
  onZoomStateEntered: () => void;
  onStageChanged: (stage: TutorialStage, targetId: string | null) => void;
}

export interface TutorialHandle {
  dismissed: Promise<void>;
  dismiss: (markShown?: boolean) => void;
  found: (id: string, next: string | null) => void;
  zoomed: () => void;
  hinted: (id: string) => void;
  readonly stage: TutorialStage;
  updateAnchor: (point: { x: number; y: number }, radius: number) => void;
}

export function showTutorialOverlay(anchor: TutorialAnchor): TutorialHandle {
  const sequence = new TutorialSequence(anchor.targetId, anchor.available);
  const overlay = document.createElement('div');
  overlay.id = 'tutorial-overlay';
  overlay.innerHTML = '<div class="tutorial-spotlight"></div><img class="tutorial-magnifier" src="/ui/tutorial/magnifier.png" alt="" aria-hidden="true"><div class="tutorial-bubble" role="status"><span class="tutorial-text"></span></div><img class="tutorial-hand" alt="" aria-hidden="true"><button class="tutorial-dismiss" type="button">Got it</button>';
  (document.getElementById('hud-overlay') ?? document.body).appendChild(overlay);
  const spotlight = overlay.querySelector<HTMLElement>('.tutorial-spotlight')!;
  // Native runner reads the real target bounds, then injects a physical tap.
  if (String(import.meta.env.VITE_ENABLE_TEST_HARNESS) === 'true') {
    spotlight.setAttribute('role', 'img');
    spotlight.setAttribute('aria-label', 'Tutorial target');
  }
  const bubble = overlay.querySelector<HTMLElement>('.tutorial-bubble')!;
  const text = overlay.querySelector<HTMLElement>('.tutorial-text')!;
  const hand = overlay.querySelector<HTMLImageElement>('.tutorial-hand')!;
  const magnifier = overlay.querySelector<HTMLImageElement>('.tutorial-magnifier')!;
  const button = overlay.querySelector<HTMLButtonElement>('button')!;
  let point = anchor.dogScreen;
  let radius = anchor.dogRadius;
  let resolve!: () => void;
  const dismissed = new Promise<void>((done) => { resolve = done; });
  const dismiss = (markShown = true): void => {
    if (sequence.stage === 'dismissed') return;
    sequence.stage = 'dismissed';
    if (markShown) { gameState.tutorialShown = true; gameState.save(); }
    document.getElementById('dog-counter')?.classList.remove('tutorial-counter-highlight');
    window.removeEventListener('resize', layout);
    document.removeEventListener('visibilitychange', refreshGesture);
    overlay.remove();
    resolve();
  };
  const refreshGesture = (): void => {
    const name = sequence.stage === 'zoom' ? 'pinch' : 'tap';
    const still = document.hidden || prefersReducedMotion();
    hand.src = `/ui/tutorial/${name}.${still ? 'png' : 'webp'}`;
  };
  const layout = (): void => {
    const stage = sequence.stage;
    const hint = stage === 'hint' ? document.getElementById('hint-btn')?.getBoundingClientRect() : undefined;
    const center = stage === 'hint' && hint
      ? { x: hint.left + hint.width / 2, y: hint.top + hint.height / 2 }
      : stage === 'zoom' || stage === 'objective'
        ? { x: window.innerWidth / 2, y: window.innerHeight * 0.45 } : point;
    const r = stage === 'hint' && hint ? Math.max(hint.width, hint.height) / 2 + 8 : Math.max(22, radius + 8);
    spotlight.hidden = stage === 'zoom' || stage === 'objective';
    Object.assign(spotlight.style, { left: `${center.x - r}px`, top: `${center.y - r}px`, width: `${r * 2}px`, height: `${r * 2}px` });
    const width = Math.min(240, window.innerWidth - 32);
    const left = Math.max(16, Math.min(window.innerWidth - width - 16, center.x - width / 2));
    const bubbleY = center.y - r - 90 < 85 ? center.y + r + 18 : center.y - r - 90;
    Object.assign(bubble.style, { width: `${width}px`, left: `${left}px`, top: `${Math.max(85, Math.min(window.innerHeight - 180, bubbleY))}px` });
    // Source canvas padding: fingertip at 23%, 18%. Mirror toward free space
    // near viewport edges so the hand remains beside, rather than over, its target.
    const flipX = center.x + r * 0.55 + 123 > window.innerWidth - 8;
    const flipY = center.y + r * 0.55 + 131 > window.innerHeight - 110;
    const handX = center.x + (flipX ? -1 : 1) * r * 0.55 - (flipX ? 123 : 37);
    const handY = center.y + (flipY ? -1 : 1) * r * 0.55 - (flipY ? 131 : 29);
    Object.assign(hand.style, { left: `${handX}px`, top: `${handY}px`, transform: `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` });
    const lensSize = r / 0.28;
    Object.assign(magnifier.style, { width: `${lensSize}px`, height: `${lensSize}px`, left: `${center.x - lensSize * 0.43}px`, top: `${center.y - lensSize * 0.41}px` });
  };
  const render = (): void => {
    const stage = sequence.stage;
    overlay.dataset.stage = stage;
    overlay.dataset.targetId = sequence.targetId ?? '';
    switch (stage) {
      case 'guided':
        text.textContent = ['Tap this bird', 'Can you find this one?', 'Each bird you find counts here'][sequence.guidedFound];
        break;
      case 'zoom': text.textContent = 'Need a closer look? Pinch to zoom in'; break;
      case 'zoomed-find': text.textContent = 'Now tap this bird'; break;
      case 'hint': text.textContent = 'Need help? Tap the hint'; break;
      case 'hinted-find': text.textContent = 'Tap the bird inside the hint'; break;
      default: text.textContent = `Find all ${anchor.total} birds. Enjoy the scene!`;
    }
    button.hidden = stage !== 'zoom' && stage !== 'objective';
    button.textContent = stage === 'objective' ? 'Let’s play' : 'Got it';
    hand.hidden = stage === 'objective';
    magnifier.hidden = stage !== 'hinted-find';
    refreshGesture();
    document.getElementById('dog-counter')?.classList.toggle('tutorial-counter-highlight', stage === 'guided' && sequence.guidedFound === 2);
    layout();
    anchor.onStageChanged(stage, sequence.targetId);
    if (stage === 'zoom') anchor.onZoomStateEntered();
  };
  const zoomed = (): void => { if (sequence.stage !== 'zoom') return; sequence.zoomed(); render(); };
  button.addEventListener('click', () => { if (sequence.stage === 'zoom') zoomed(); else dismiss(); });
  window.addEventListener('resize', layout);
  document.addEventListener('visibilitychange', refreshGesture);
  render();
  return {
    dismissed, dismiss, zoomed,
    get stage() { return sequence.stage; },
    found: (id, next) => { if (sequence.found(id, next)) render(); },
    hinted: (id) => { sequence.hinted(id); render(); },
    updateAnchor: (next, nextRadius) => {
      point = next;
      radius = nextRadius;
      if (sequence.stage === 'guided' || sequence.stage === 'zoomed-find' || sequence.stage === 'hinted-find') layout();
    },
  };
}

export function phaserPointToCssPoint(canvas: HTMLCanvasElement, phaserWidth: number, phaserHeight: number, phaserX: number, phaserY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: rect.left + phaserX * rect.width / phaserWidth, y: rect.top + phaserY * rect.height / phaserHeight };
}

export function resetTutorial(): void {
  gameState.tutorialShown = false;
  gameState.save();
}
