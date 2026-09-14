import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { showTutorialOverlay } from './TutorialOverlay';

vi.mock('../core/GameState', () => ({ gameState: { tutorialShown: false, save: vi.fn() } }));
beforeEach(() => { document.body.innerHTML = '<div id="hud-overlay"><div id="dog-counter"></div><button id="hint-btn">Hint</button></div>'; });
afterEach(() => { document.body.innerHTML = ''; });

it('Got it advances the pinch alternative without marking the whole tutorial complete', async () => {
  const onStageChanged = vi.fn();
  const tour = showTutorialOverlay({ dogScreen: { x: 150, y: 300 }, dogRadius: 30, targetId: 'a', available: 5, total: 5, onZoomStateEntered: vi.fn(), onStageChanged });
  const hand = document.querySelector<HTMLImageElement>('.tutorial-hand')!;
  expect(hand.getAttribute('src')).toBe('/ui/tutorial/tap.png');
  tour.found('a', 'b'); tour.found('b', 'c'); tour.found('c', 'd');
  expect(tour.stage).toBe('zoom');
  expect(hand.getAttribute('src')).toBe('/ui/tutorial/pinch.webp');
  document.querySelector<HTMLButtonElement>('.tutorial-dismiss')!.click();
  expect(tour.stage).toBe('pan-left');
  expect(hand.getAttribute('src')).toBe('/ui/tutorial/tap.png');
  const alternative = document.querySelector<HTMLButtonElement>('.tutorial-dismiss')!;
  expect(alternative.hidden).toBe(false);
  alternative.click();
  expect(tour.stage).toBe('pan-right');
  expect(alternative.hidden).toBe(false);
  alternative.click();
  expect(tour.stage).toBe('zoomed-find');
  tour.found('d', 'e');
  document.getElementById('hint-btn')!.click();
  expect(tour.stage).toBe('hint'); // only the successful hint path can advance
  tour.hinted('e'); tour.found('e', null);
  expect(tour.stage).toBe('objective');
  document.querySelector<HTMLButtonElement>('.tutorial-dismiss')!.click();
  await tour.dismissed;
  expect(document.getElementById('tutorial-overlay')).toBeNull();
});

it('teardown removes masks and highlights without completing the tour', async () => {
  const tour = showTutorialOverlay({ dogScreen: { x: 150, y: 300 }, dogRadius: 30, targetId: 'a', available: 5, total: 5, onZoomStateEntered: vi.fn(), onStageChanged: vi.fn() });
  tour.found('a', 'b'); tour.found('b', 'c');
  expect(document.getElementById('dog-counter')!.classList.contains('tutorial-counter-highlight')).toBe(true);
  tour.dismiss(false); await tour.dismissed;
  expect(document.getElementById('dog-counter')!.classList.contains('tutorial-counter-highlight')).toBe(false);
});

it.each([60, 300, 650])('keeps instruction text clear of the hand near vertical anchor %s', (y) => {
  const tour = showTutorialOverlay({ dogScreen: { x: 80, y }, dogRadius: 45, targetId: 'a', available: 5, total: 5, onZoomStateEntered: vi.fn(), onStageChanged: vi.fn() });
  const bubbleY = parseFloat(document.querySelector<HTMLElement>('.tutorial-bubble')!.style.top);
  const handY = parseFloat(document.querySelector<HTMLElement>('.tutorial-hand')!.style.top);
  expect(bubbleY + 70 <= handY || bubbleY >= handY + 160).toBe(true);
  tour.dismiss(false);
});

it.each([
  [150, 300, false, false],
  [window.innerWidth - 30, 300, true, false],
  [window.innerWidth - 30, window.innerHeight - 90, true, true],
])('keeps the fingertip inside the target at %s,%s', (x, y, flipX, flipY) => {
  const tour = showTutorialOverlay({ dogScreen: { x: Number(x), y: Number(y) }, dogRadius: 30, targetId: 'a', available: 5, total: 5, onZoomStateEntered: vi.fn(), onStageChanged: vi.fn() });
  const hand = document.querySelector<HTMLElement>('.tutorial-hand')!;
  expect(hand.style.transform).toBe(`scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`);
  const tipX = parseFloat(hand.style.left) + (flipX ? 123 : 37);
  const tipY = parseFloat(hand.style.top) + (flipY ? 131 : 29);
  expect(Math.hypot(tipX - Number(x), tipY - Number(y))).toBeLessThan(16);
  expect(parseFloat(hand.style.top) + 160).toBeLessThanOrEqual(window.innerHeight - 8);
  tour.dismiss(false);
});
