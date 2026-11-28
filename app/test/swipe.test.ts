import { describe, expect, it } from 'vitest';
import { neighbour, swipeStep } from '../src/lib/swipe';

describe('swipeStep', () => {
  it('a quick swipe left goes to the next tab, right to the previous', () => {
    expect(swipeStep(-120, 10, 200)).toBe(1);
    expect(swipeStep(120, -10, 200)).toBe(-1);
  });
  it('ignores short, slow, vertical and diagonal movements', () => {
    expect(swipeStep(-40, 0, 150)).toBe(0); // too short
    expect(swipeStep(-200, 0, 900)).toBe(0); // a slow drag
    expect(swipeStep(-80, 300, 200)).toBe(0); // scrolling the list
    expect(swipeStep(-100, 70, 200)).toBe(0); // diagonal
    expect(swipeStep(0, 0, 50)).toBe(0); // a tap
  });
});

describe('neighbour', () => {
  const tabs = ['today', 'work', 'personal', 'groceries'] as const;
  it('moves one tab and stops at the ends', () => {
    expect(neighbour(tabs, 'today', 1)).toBe('work');
    expect(neighbour(tabs, 'work', -1)).toBe('today');
    expect(neighbour(tabs, 'today', -1)).toBe('today');
    expect(neighbour(tabs, 'groceries', 1)).toBe('groceries');
    expect(neighbour(tabs, 'personal', 0)).toBe('personal');
  });
});
