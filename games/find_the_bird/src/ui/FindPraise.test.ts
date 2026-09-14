import { afterEach, expect, it, vi } from 'vitest';
import { FindPraise } from './FindPraise';

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });
it('rotates phrases without scoring, bounds concurrent feedback, and cleans up', () => {
  vi.useFakeTimers();
  const praise = new FindPraise();
  praise.show(0, 0);
  expect(document.querySelector('.find-praise-word')?.textContent).toBe('Found It!');
  praise.show(100, 100); praise.show(100, 100);
  expect(document.querySelectorAll('.find-praise')).toHaveLength(2);
  expect(document.querySelector('.find-praise-stars')?.textContent).toBe('★ ★ ★');
  praise.clear();
  expect(document.querySelectorAll('.find-praise')).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});
