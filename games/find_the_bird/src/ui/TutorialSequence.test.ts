import { describe, expect, it } from 'vitest';
import { TutorialSequence } from './TutorialSequence';

describe('tutorial progression', () => {
  it.each(['left', 'right'] as const)('accepts one %s drag and finishes on the real hinted find', (direction) => {
    const tour = new TutorialSequence('a', 6);
    expect(tour.found('other', 'b')).toBe(false);
    tour.found('a', 'b'); tour.found('b', 'c'); tour.found('c', 'd');
    expect(tour.stage).toBe('zoom');
    expect(tour.found('d', 'e')).toBe(false);
    tour.zoomed();
    expect(tour.stage).toBe('pan');
    expect(tour.found('d', 'e')).toBe(false);
    tour.panned(direction);
    expect(tour.stage).toBe('hint');
    expect(tour.targetId).toBeNull();
    expect(tour.found('d', 'e')).toBe(false);
    tour.hinted('f');
    expect(tour.found('e', null)).toBe(false);
    tour.found('f', null);
    expect(tour.stage).toBe('dismissed');
  });
  it('reserves one remaining target for the hint lesson', () => {
    const tour = new TutorialSequence('a', 2);
    tour.found('a', 'b');
    expect(tour.stage).toBe('zoom');
    tour.zoomed(); tour.panned('left'); tour.hinted('b'); tour.found('b', null);
    expect(tour.stage).toBe('dismissed');
  });
});
