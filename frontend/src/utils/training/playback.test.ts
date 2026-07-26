import { describe, expect, it } from 'vitest';
import type { Kline } from '../../services/api';
import { AUTOPLAY_MS, canStep, initialCursorIndex, visibleBars, visibleBarsUntilTime } from './playback';
import { DEFAULT_CONTEXT_BARS } from './types';

function series(times: number[]): Kline[] {
  return times.map((t, i) => ({ time: t, open: i, high: i, low: i, close: i, volume: 0 }));
}

function bars(n: number): Kline[] {
  return series(Array.from({ length: n }, (_, i) => 1000 + i * 60));
}

describe('initialCursorIndex', () => {
  it('covers the boundary table', () => {
    const table: Array<[number, number | undefined, number]> = [
      [0, undefined, 0],
      [-3, undefined, 0],
      [1, undefined, 0],
      [2, undefined, 0],
      [3, undefined, 1],
      // contextBars >= barCount leaves one decision bar
      [10, 50, 8],
      [10, 10, 8],
      [10, 11, 8],
      // normal case
      [100, 50, 49],
      [200, 50, 49],
      [51, 50, 49],
      // contextBars is floored at 1
      [100, 0, 0],
      [100, -5, 0],
      [100, 1, 0],
    ];
    for (const [barCount, ctx, expected] of table) {
      expect(
        ctx === undefined ? initialCursorIndex(barCount) : initialCursorIndex(barCount, ctx),
        `barCount=${barCount} ctx=${ctx}`,
      ).toBe(expected);
    }
  });

  it('defaults to DEFAULT_CONTEXT_BARS', () => {
    expect(initialCursorIndex(100)).toBe(initialCursorIndex(100, DEFAULT_CONTEXT_BARS));
    expect(initialCursorIndex(100)).toBe(DEFAULT_CONTEXT_BARS - 1);
  });

  it('always leaves at least one bar ahead of the cursor when there is more than one bar', () => {
    for (let n = 2; n <= 60; n += 1) {
      expect(initialCursorIndex(n, 50)).toBeLessThan(n - 1);
    }
  });
});

describe('visibleBars', () => {
  it('returns everything when revealed', () => {
    const all = bars(5);
    expect(visibleBars(all, 0, true)).toEqual(all);
    expect(visibleBars(all, 99, true)).toEqual(all);
  });

  it('slices inclusively up to the cursor when masked', () => {
    const all = bars(5);
    expect(visibleBars(all, 2, false)).toHaveLength(3);
    expect(visibleBars(all, 2, false).at(-1)).toEqual(all[2]);
    expect(visibleBars(all, 0, false)).toEqual([all[0]]);
  });

  it('clamps the cursor at both ends', () => {
    const all = bars(5);
    expect(visibleBars(all, -10, false)).toEqual([all[0]]);
    expect(visibleBars(all, 4, false)).toEqual(all);
    expect(visibleBars(all, 99, false)).toEqual(all);
  });

  it('handles empty input', () => {
    expect(visibleBars([], 0, false)).toEqual([]);
    expect(visibleBars([], 3, false)).toEqual([]);
    expect(visibleBars([], 0, true)).toEqual([]);
  });
});

describe('visibleBarsUntilTime', () => {
  const main = series([100, 200, 300, 400]);

  it('masks by time inclusive of the cursor bar', () => {
    expect(visibleBarsUntilTime(main, 300, false).map((b) => b.time)).toEqual([100, 200, 300]);
    expect(visibleBarsUntilTime(main, 100, false).map((b) => b.time)).toEqual([100]);
    expect(visibleBarsUntilTime(main, 99, false)).toEqual([]);
  });

  it('returns [] for a null cursor time', () => {
    expect(visibleBarsUntilTime(main, null, false)).toEqual([]);
  });

  it('returns everything when revealed, even with a null cursor', () => {
    expect(visibleBarsUntilTime(main, null, true)).toEqual(main);
    expect(visibleBarsUntilTime(main, 100, true)).toEqual(main);
  });

  it('works when the compare series bar times do not align with the main series', () => {
    // compare bars land between the main bars
    const compare = series([90, 150, 250, 350, 450]);
    expect(visibleBarsUntilTime(compare, 300, false).map((b) => b.time)).toEqual([90, 150, 250]);
    expect(visibleBarsUntilTime(compare, 350, false).map((b) => b.time)).toEqual([90, 150, 250, 350]);
    // a compare series that starts after the cursor reveals nothing
    expect(visibleBarsUntilTime(series([1000, 2000]), 300, false)).toEqual([]);
  });

  it('handles empty input', () => {
    expect(visibleBarsUntilTime([], 300, false)).toEqual([]);
  });
});

describe('canStep', () => {
  it('is false at the last bar', () => {
    expect(canStep(4, 5, false)).toBe(false);
    expect(canStep(5, 5, false)).toBe(false);
    expect(canStep(3, 5, false)).toBe(true);
  });

  it('is false when locked', () => {
    expect(canStep(0, 5, true)).toBe(false);
    expect(canStep(3, 5, true)).toBe(false);
  });

  it('is false with no bars', () => {
    expect(canStep(0, 0, false)).toBe(false);
  });
});

describe('AUTOPLAY_MS', () => {
  it('maps each speed to a shorter interval', () => {
    expect(AUTOPLAY_MS[1]).toBeGreaterThan(AUTOPLAY_MS[2]);
    expect(AUTOPLAY_MS[2]).toBeGreaterThan(AUTOPLAY_MS[4]);
  });
});
