import type { Kline } from '../../services/api';
import { DEFAULT_CONTEXT_BARS } from './types';

export function initialCursorIndex(barCount: number, contextBars = DEFAULT_CONTEXT_BARS): number {
  if (barCount <= 0) return 0;
  const ctx = Math.max(1, Math.min(contextBars, barCount));
  // leave at least 1 decision bar when possible
  if (barCount > 1 && ctx >= barCount) return barCount - 2;
  return ctx - 1;
}

export function visibleBars(bars: Kline[], cursorIndex: number, revealed: boolean): Kline[] {
  if (revealed) return bars;
  if (bars.length === 0) return [];
  const end = Math.min(bars.length - 1, Math.max(0, cursorIndex));
  return bars.slice(0, end + 1);
}

/** Mask compare series by main cursor time (indexes may not align). */
export function visibleBarsUntilTime(
  bars: Kline[],
  cursorTimeSec: number | null,
  revealed: boolean,
): Kline[] {
  if (revealed) return bars;
  if (cursorTimeSec == null || bars.length === 0) return [];
  return bars.filter((b) => b.time <= cursorTimeSec);
}

export function canStep(cursorIndex: number, barCount: number, locked: boolean): boolean {
  return !locked && barCount > 0 && cursorIndex < barCount - 1;
}

export const AUTOPLAY_MS: Record<1 | 2 | 4, number> = {
  1: 800,
  2: 400,
  4: 200,
};
