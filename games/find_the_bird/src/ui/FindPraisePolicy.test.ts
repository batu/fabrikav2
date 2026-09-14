import { expect, it } from 'vitest';
import { FindPraisePolicy } from './FindPraisePolicy';

it('keeps ordinary finds quiet and celebrates each group of three quick finds once', () => {
  const policy = new FindPraisePolicy();
  expect(policy.find('a', 0, false)).toBeNull();
  expect(policy.find('b', 4000, false)).toBeNull();
  expect(policy.find('c', 8000, false)).toBe('Combo!');
  expect(policy.find('d', 8100, false)).toBeNull();
  expect(policy.find('e', 8200, false)).toBeNull();
  expect(policy.find('f', 8300, false)).toBe('Combo!');
});

it('restarts expired combos and combines hard-find and combo feedback', () => {
  const policy = new FindPraisePolicy();
  expect(policy.find('a', 0, true)).toBe('Good!');
  expect(policy.find('b', 4001, false)).toBeNull();
  expect(policy.find('c', 4100, false)).toBeNull();
  expect(policy.find('d', 4200, true)).toBe('Incredible!');
});

it('excludes hinted targets even after the hint is dismissed, and breaks the chain', () => {
  const policy = new FindPraisePolicy();
  policy.find('a', 0, false);
  policy.find('b', 100, false);
  policy.markHinted('hinted');
  expect(policy.find('c', 200, false)).toBeNull();
  expect(policy.find('hinted', 300, true)).toBeNull();
  expect(policy.find('d', 400, false)).toBeNull();
  expect(policy.find('e', 500, false)).toBeNull();
  expect(policy.find('f', 600, false)).toBe('Combo!');
});

it('breaks on tutorial finds and interruptions, and resets hinted identities for a new attempt', () => {
  const policy = new FindPraisePolicy();
  policy.find('a', 0, false);
  policy.find('b', 100, false);
  expect(policy.find('c', 200, true, true)).toBeNull();
  expect(policy.find('d', 300, false)).toBeNull();
  policy.interrupt();
  expect(policy.find('e', 400, false)).toBeNull();
  expect(policy.find('f', 500, false)).toBeNull();
  policy.markHinted('g');
  policy.reset();
  expect(policy.find('g', 600, true)).toBe('Good!');
});
