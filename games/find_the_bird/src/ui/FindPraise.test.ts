import { afterEach, expect, it, vi } from 'vitest';
import { FindPraise } from './FindPraise';

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });
it('shows the earned phrase at a fixed screen coordinate, bounds feedback, and cleans up', () => {
  vi.useFakeTimers();
  const praise = new FindPraise();
  praise.show(0, 0, 'Good!');
  expect(document.querySelector('.find-praise-word')?.textContent).toBe('Good!');
  const el = document.querySelector<HTMLElement>('.find-praise')!;
  expect(el.style.left).toBe('110px');
  expect(el.style.top).toBe('140px');
  window.dispatchEvent(new Event('scroll'));
  expect(el.style.left).toBe('110px');
  expect(el.style.top).toBe('140px');
  praise.show(100, 100, 'Combo!'); praise.show(100, 100, 'Incredible!');
  expect(document.querySelectorAll('.find-praise')).toHaveLength(2);
  expect(document.querySelector('.find-praise-stars')?.textContent).toBe('★ ★ ★');
  praise.clear();
  expect(document.querySelectorAll('.find-praise')).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});
