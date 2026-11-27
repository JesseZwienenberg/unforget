import { describe, expect, it } from 'vitest';
import { createCapture } from '../src/capture';
import { addUsage, costUsd, formatUsd, NO_USAGE } from '../src/cost';
import { DEFAULT_SETTINGS } from '../src/settings';
import { capitalizeFirst } from '../src/text';

describe('capitalizeFirst', () => {
  it.each([
    ['ketchup', 'Ketchup'],
    ['oven uit', 'Oven uit'],
    ['Already fine', 'Already fine'],
    ['éclairs kopen', 'Éclairs kopen'],
    ['ijs halen', 'Ijs halen'],
    ['  spaties', 'Spaties'],
    ['2 pakken melk', '2 pakken melk'],
    ['', ''],
  ])('"%s" → "%s"', (input, expected) => {
    expect(capitalizeFirst(input)).toBe(expected);
  });

  it('leaves links alone so they stay links', () => {
    expect(capitalizeFirst('https://example.com/pasta')).toBe('https://example.com/pasta');
    expect(capitalizeFirst('www.example.com')).toBe('www.example.com');
  });

  it('is applied to every capture on the device, and never to the raw text', () => {
    const now = new Date('2026-11-27T15:00:00.000Z');
    let n = 0;
    const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    const made = createCapture('g ketchup', 'typed', now, DEFAULT_SETTINGS, id);
    expect(made.item.title).toBe('Ketchup');
    expect(made.capture.text).toBe('g ketchup');
    expect(createCapture('over 10 minuten oven uit', 'typed', now, DEFAULT_SETTINGS, id).item.title).toBe('Oven uit');
  });
});

describe('cost', () => {
  it('prices tokens at the Haiku 5.5 list prices', () => {
    // 1M input = $0.10, 1M output = $0.50, 1M cache write = $0.125, 1M cache read = $0.01
    expect(costUsd({ calls: 1, inputTokens: 1_000_000, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 })).toBeCloseTo(0.1);
    expect(costUsd({ calls: 1, inputTokens: 0, outputTokens: 1_000_000, cacheWriteTokens: 0, cacheReadTokens: 0 })).toBeCloseTo(0.5);
    expect(costUsd({ calls: 1, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000, cacheReadTokens: 1_000_000 })).toBeCloseTo(0.135);
    // a typical capture: 300 fresh input, 2400 read from cache, 120 output
    expect(costUsd({ calls: 1, inputTokens: 300, outputTokens: 120, cacheWriteTokens: 0, cacheReadTokens: 2400 })).toBeCloseTo(0.000114);
  });

  it('adds usage and formats small and large amounts', () => {
    const one = { calls: 1, inputTokens: 10, outputTokens: 5, cacheWriteTokens: 2, cacheReadTokens: 1 };
    expect(addUsage(addUsage(NO_USAGE, one), one)).toEqual({ calls: 2, inputTokens: 20, outputTokens: 10, cacheWriteTokens: 4, cacheReadTokens: 2 });
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.00042)).toBe('$0.0004');
    expect(formatUsd(0.0123)).toBe('$0.01');
    expect(formatUsd(1.234)).toBe('$1.23');
  });
});
