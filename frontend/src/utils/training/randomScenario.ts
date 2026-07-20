import type { Timeframe } from '../../services/api';
import { TIMEFRAMES } from '../../services/api';
import { MAX_SCENARIO_BARS, MIN_SCENARIO_BARS } from './types';

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export type RandomScenarioPick = {
  symbol: string;
  timeframe: Timeframe;
  startMs: number;
  endMs: number;
  barCount: number;
};

/** Pick symbol/tf/window; caller fetches klines and may retry. */
export function pickRandomScenario(
  pool: string[],
  options?: { timeframe?: Timeframe; nowMs?: number },
): RandomScenarioPick | null {
  if (pool.length === 0) return null;
  const symbol = pick(pool);
  const timeframe = options?.timeframe ?? pick(TIMEFRAMES);
  const barCount =
    MIN_SCENARIO_BARS + Math.floor(Math.random() * (MAX_SCENARIO_BARS - MIN_SCENARIO_BARS + 1));
  const step = TIMEFRAME_MS[timeframe];
  const now = options?.nowMs ?? Date.now();
  // stay away from the very latest bar; look back up to ~4000 bars
  const maxLookbackBars = 4000;
  const latestEnd = now - step * 2;
  const earliestEnd = latestEnd - step * maxLookbackBars;
  const endMs = earliestEnd + Math.random() * (latestEnd - earliestEnd);
  const startMs = endMs - step * (barCount - 1);
  return {
    symbol,
    timeframe,
    startMs: Math.floor(startMs),
    endMs: Math.floor(endMs),
    barCount,
  };
}
