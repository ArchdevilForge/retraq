import type { Kline, Timeframe } from '../../services/api';

export type Direction = 'long' | 'short';

export type TrainingScenario = {
  symbol: string;
  timeframe: Timeframe;
  startMs: number;
  endMs: number;
  contextBars: number;
  compareSymbol?: string | null;
};

export type VirtualAccount = {
  startEquity: number;
  feeRate: number;
  equity: number;
};

export type SimPosition = {
  direction: Direction;
  qty: number;
  entryPrice: number;
  leverage: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  /** Gross realized PnL on this open cycle (partials included). */
  cyclePnl: number;
  /** Fees attributed to this open cycle. */
  cycleFees: number;
};

export type RunStats = {
  trades: number;
  wins: number;
  realizedPnl: number;
  fees: number;
};

export type MarkerSide = 'entry' | 'exit';

export type SimMarker = {
  time: number;
  price: number;
  side: MarkerSide;
  direction: Direction;
  label: string;
};

export type TrainingRun = {
  scenario: TrainingScenario;
  account: VirtualAccount;
  cursorIndex: number;
  initialCursorIndex: number;
  bars: Kline[];
  compareBars: Kline[] | null;
  position: SimPosition | null;
  revealed: boolean;
  locked: boolean;
  stats: RunStats;
  markers: SimMarker[];
};

export const DEFAULT_START_EQUITY = 100;
/** Default order size in USDT notional (quote). */
export const DEFAULT_ORDER_USDT = 20;
export const DEFAULT_FEE_RATE = 0.0005;
export const DEFAULT_CONTEXT_BARS = 50;
export const MAX_LEVERAGE = 20;
export const MIN_SCENARIO_BARS = 100;
export const MAX_SCENARIO_BARS = 300;
