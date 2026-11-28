// Sideways swipe between tabs. Kept strict, so scrolling a list or a sloppy
// diagonal drag never changes tab by accident.
const MIN_DISTANCE = 56; // px
const MAX_DURATION = 700; // ms: a swipe, not a slow drag
const MAX_SLOPE = 0.5; // at most 1 px up/down for every 2 px sideways

/** -1 = go to the tab on the left, 1 = the tab on the right, 0 = not a swipe. */
export function swipeStep(dx: number, dy: number, ms: number): -1 | 0 | 1 {
  if (ms > MAX_DURATION || Math.abs(dx) < MIN_DISTANCE || Math.abs(dy) > Math.abs(dx) * MAX_SLOPE) return 0;
  // Finger moves left → the next tab slides in from the right.
  return dx < 0 ? 1 : -1;
}

/** The tab reached by a step; stops at both ends rather than wrapping around. */
export function neighbour<T>(tabs: readonly T[], current: T, step: -1 | 0 | 1): T {
  const index = tabs.indexOf(current) + step;
  return tabs[Math.min(tabs.length - 1, Math.max(0, index))] ?? current;
}
