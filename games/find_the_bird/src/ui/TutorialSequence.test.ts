import { describe, expect, it } from 'vitest';
import { TutorialSequence } from './TutorialSequence';

describe('tutorial progression', () => {
  it('requires designated finds, a pinch, and the real hinted find in order', () => {
    const tour = new TutorialSequence('a', 6);
    expect(tour.found('other', 'b')).toBe(false);
    tour.found('a', 'b'); tour.found('b', 'c'); tour.found('c', 'd');
    expect(tour.stage).toBe('zoom');
    expect(tour.found('d', 'e')).toBe(false);
    tour.zoomed();
    expect(tour.stage).toBe('pan-left');
    tour.panned('right');
    expect(tour.stage).toBe('pan-left');
    expect(tour.found('d', 'e')).toBe(false);
    tour.panned('left');
    expect(tour.stage).toBe('hint');
    expect(tour.targetId).toBeNull();
    expect(tour.found('d', 'e')).toBe(false);
    tour.hinted('f');
    expect(tour.found('e', null)).toBe(false);
    tour.found('f', null);
    expect(tour.stage).toBe('objective');
  });
  it('reserves one remaining target for the hint lesson', () => {
    const tour = new TutorialSequence('a', 2);
    tour.found('a', 'b');
    expect(tour.stage).toBe('zoom');
    tour.zoomed(); tour.panned('left'); tour.hinted('b'); tour.found('b', null);
    expect(tour.stage).toBe('objective');
  });
});
