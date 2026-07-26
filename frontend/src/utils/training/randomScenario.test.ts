import { describe, expect, it } from 'vitest';
import type { Timeframe } from '../../services/api';
import { TIMEFRAMES } from '../../services/api';
import { pickRandomScenario, TIMEFRAME_MS } from './randomScenario';
import { MAX_SCENARIO_BARS, MIN_SCENARIO_BARS } from './types';

/** Deterministic RNG: yields the given values in order, then repeats the last one. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)] ?? 0;
    i += 1;
    return v;
  };
}

const NOW = Date.UTC(2026, 6, 26, 12, 0, 0);
const POOL = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT'];

describe('pickRandomScenario', () => {
  it('returns null for an empty pool', () => {
    expect(pickRandomScenario([], { nowMs: NOW, random: seq([0.5]) })).toBeNull();
    expect(pickRandomScenario([])).toBeNull();
  });

  it('always returns the only symbol of a single-symbol pool', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999999]) {
      const pick = pickRandomScenario(['DOGE-USDT'], { nowMs: NOW, random: seq([r]) });
      expect(pick?.symbol).toBe('DOGE-USDT');
    }
  });

  it('selects the symbol by the first random draw', () => {
    // draws: symbol, timeframe, barCount, endMs
    expect(pickRandomScenario(POOL, { nowMs: NOW, random: seq([0, 0, 0, 0]) })?.symbol).toBe(
      'BTC-USDT',
    );
    expect(pickRandomScenario(POOL, { nowMs: NOW, random: seq([0.4, 0, 0, 0]) })?.symbol).toBe(
      'ETH-USDT',
    );
    expect(pickRandomScenario(POOL, { nowMs: NOW, random: seq([0.9, 0, 0, 0]) })?.symbol).toBe(
      'SOL-USDT',
    );
  });

  it('spans exactly barCount bars: startMs === endMs - step * (barCount - 1)', () => {
    for (const timeframe of TIMEFRAMES) {
      for (const r of [0, 0.37, 0.5, 1]) {
        const pick = pickRandomScenario(POOL, {
          nowMs: NOW,
          timeframe,
          barCount: 123,
          random: seq([0.5, r]),
        });
        expect(pick).not.toBeNull();
        const step = TIMEFRAME_MS[timeframe];
        expect(pick!.barCount).toBe(123);
        expect(pick!.startMs).toBe(pick!.endMs - step * (pick!.barCount - 1));
      }
    }
  });

  it('maps each supported timeframe to the right step via TIMEFRAME_MS', () => {
    const expected: Record<Timeframe, number> = {
      '5m': 300_000,
      '15m': 900_000,
      '1h': 3_600_000,
      '4h': 14_400_000,
      '1d': 86_400_000,
    };
    expect(TIMEFRAME_MS).toEqual(expected);

    for (const timeframe of TIMEFRAMES) {
      const pick = pickRandomScenario(POOL, {
        nowMs: NOW,
        timeframe,
        barCount: 101,
        random: seq([0.5, 0.5]),
      })!;
      expect(pick.timeframe).toBe(timeframe);
      expect((pick.endMs - pick.startMs) / (pick.barCount - 1)).toBe(expected[timeframe]);
    }
  });

  it('picks the timeframe from the second draw when none is given', () => {
    TIMEFRAMES.forEach((tf, i) => {
      const r = (i + 0.5) / TIMEFRAMES.length;
      const pick = pickRandomScenario(POOL, { nowMs: NOW, barCount: 100, random: seq([0, r, 0]) });
      expect(pick?.timeframe).toBe(tf);
    });
  });

  it('never reaches the still-forming bar, even at the top of the range', () => {
    for (const timeframe of TIMEFRAMES) {
      const step = TIMEFRAME_MS[timeframe];
      const latest = pickRandomScenario(POOL, {
        nowMs: NOW,
        timeframe,
        barCount: 100,
        random: seq([0.5, 1]),
      })!;
      expect(latest.endMs).toBe(NOW - step * 2);
      expect(latest.endMs).toBeLessThan(NOW - step);

      const earliest = pickRandomScenario(POOL, {
        nowMs: NOW,
        timeframe,
        barCount: 100,
        random: seq([0.5, 0]),
      })!;
      expect(earliest.endMs).toBe(NOW - step * 2 - step * 4000);
      expect(earliest.endMs).toBeLessThan(latest.endMs);
    }
  });

  it('keeps endMs inside the lookback window for any draw', () => {
    const step = TIMEFRAME_MS['1h'];
    for (const r of [0, 0.1, 0.5, 0.9, 1]) {
      const pick = pickRandomScenario(POOL, {
        nowMs: NOW,
        timeframe: '1h',
        barCount: 100,
        random: seq([0.5, r]),
      })!;
      expect(pick.endMs).toBeLessThanOrEqual(NOW - step * 2);
      expect(pick.endMs).toBeGreaterThanOrEqual(NOW - step * 2 - step * 4000);
    }
  });

  it('clamps an explicit barCount into [MIN_SCENARIO_BARS, MAX_SCENARIO_BARS]', () => {
    const call = (barCount: number) =>
      pickRandomScenario(POOL, { nowMs: NOW, timeframe: '1h', barCount, random: seq([0.5, 0.5]) })!
        .barCount;
    expect(call(1)).toBe(MIN_SCENARIO_BARS);
    expect(call(0)).toBe(MIN_SCENARIO_BARS);
    expect(call(-100)).toBe(MIN_SCENARIO_BARS);
    expect(call(MIN_SCENARIO_BARS)).toBe(MIN_SCENARIO_BARS);
    expect(call(5000)).toBe(MAX_SCENARIO_BARS);
    expect(call(MAX_SCENARIO_BARS)).toBe(MAX_SCENARIO_BARS);
    expect(call(150)).toBe(150);
    expect(call(150.9)).toBe(150);
  });

  it('rolls an omitted barCount inside [MIN_SCENARIO_BARS, MAX_SCENARIO_BARS]', () => {
    // draws: symbol, barCount, endMs (timeframe is fixed)
    const call = (r: number) =>
      pickRandomScenario(POOL, { nowMs: NOW, timeframe: '1h', random: seq([0.5, r, 0.5]) })!.barCount;
    expect(call(0)).toBe(MIN_SCENARIO_BARS);
    expect(call(0.999999)).toBe(MAX_SCENARIO_BARS);
    for (const r of [0.01, 0.25, 0.5, 0.75, 0.99]) {
      const n = call(r);
      expect(n).toBeGreaterThanOrEqual(MIN_SCENARIO_BARS);
      expect(n).toBeLessThanOrEqual(MAX_SCENARIO_BARS);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it('treats a non-finite barCount as omitted', () => {
    const pick = pickRandomScenario(POOL, {
      nowMs: NOW,
      timeframe: '1h',
      barCount: Number.NaN,
      random: seq([0.5, 0, 0.5]),
    })!;
    expect(pick.barCount).toBe(MIN_SCENARIO_BARS);
  });

  it('returns integer millisecond bounds', () => {
    const pick = pickRandomScenario(POOL, {
      nowMs: NOW,
      timeframe: '5m',
      barCount: 137,
      random: seq([0.5, 0.3333333]),
    })!;
    expect(Number.isInteger(pick.startMs)).toBe(true);
    expect(Number.isInteger(pick.endMs)).toBe(true);
    expect(pick.startMs).toBeLessThan(pick.endMs);
  });
});
