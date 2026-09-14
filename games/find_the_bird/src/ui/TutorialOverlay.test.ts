import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { showTutorialOverlay } from './TutorialOverlay';

vi.mock('../core/GameState', () => ({ gameState: { tutorialShown: false, save: vi.fn() } }));
beforeEach(() => { document.body.innerHTML = '<div id="hud-overlay"><div id="dog-counter"></div><button id="hint-btn">Hint</button></div>'; });
afterEach(() => { document.body.innerHTML = ''; });

it('Got it advances the pinch alternative without marking the whole tutorial complete', async () => {
  const onStageChanged = vi.fn();
  const tour = showTutorialOverlay({ dogScreen: { x: 150, y: 300 }, dogRadius: 30, targetId: 'a', available: 5, total: 5, onZoomStateEntered: vi.fn(), onStageChanged });
  tour.found('a', 'b'); tour.found('b', 'c'); tour.found('c', 'd');
  expect(tour.stage).toBe('zoom');
  document.querySelector<HTMLButtonElement>('.tutorial-dismiss')!.click();
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
