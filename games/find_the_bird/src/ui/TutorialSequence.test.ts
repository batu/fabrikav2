import { describe, expect, it } from 'vitest';
import { TutorialSequence } from './TutorialSequence';

describe('tutorial progression', () => {
  it('requires designated finds, a pinch, and the real hinted find in order', () => {
    const tour = new TutorialSequence('a', 6);
    expect(tour.found('other', 'b')).toBe(false);
    tour.found('a', 'b'); tour.found('b', 'c'); tour.found('c', 'd');
    expect(tour.stage).toBe('zoom');
    expect(tour.found('d', 'e')).toBe(false);
    tour.zoomed(); tour.found('d', 'e');
    expect(tour.stage).toBe('hint');
    tour.hinted('f');
    expect(tour.found('e', null)).toBe(false);
    tour.found('f', null);
    expect(tour.stage).toBe('objective');
  });
  it('reserves scarce targets for gesture and hint lessons', () => {
    const tour = new TutorialSequence('a', 2);
    expect(tour.stage).toBe('zoom');
    tour.zoomed(); tour.found('a', 'b'); tour.hinted('b'); tour.found('b', null);
    expect(tour.stage).toBe('objective');
  });
});
