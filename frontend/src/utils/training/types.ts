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
  /** Cycle's original size; partial closes keep it for the ClosedCycle record. */
  openedQty: number;
  entryPrice: number;
  leverage: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  /** Gross realized PnL on this open cycle (partials included). */
  cyclePnl: number;
  /** Fees attributed to this open cycle. */
  cycleFees: number;
  /** Bar time of the first entry in this cycle; anchors the 最大安全仓位 lookback. */
  openedAt: number;
};

/** Working order waiting for future bars to trigger/fill (docs/PRODUCT.md §六). */
export type PendingOrderKind = 'limit' | 'stop' | 'stop_limit';

export type PendingOrder = {
  kind: PendingOrderKind;
  direction: Direction;
  /** Trigger price: fill level for limit, trigger for stop/stop_limit. */
  price: number;
  /** Limit price of a stop_limit order after the trigger fires. */
  limitPrice?: number | null;
  marginUsdt: number;
  leverage: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
};

/** A fully closed round-trip, kept for 落库 (docs/PRODUCT.md §六). */
export type ClosedCycle = {
  direction: Direction;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  leverage: number;
  /** Net profit of the cycle (partials included, fees excluded). */
  profit: number;
  fees: number;
  entryTime: number;
  exitTime: number;
  margin: number;
  reason: string;
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

/** Post-爆仓 attribution: what size would have survived, and what it cost to ignore that. */
export type Postmortem = {
  entryPrice: number;
  direction: Direction;
  /** Worst adverse excursion after entry, as a fraction of entry price. */
  adverseExcursion: number;
  /** Committed margin that was actually used. */
  usedMargin: number;
  /** Largest committed margin that would have survived to the scenario end; null = any size survives. */
  maxSurvivableMargin: number | null;
  /** maxSurvivableMargin as a fraction of the equity held at entry. */
  maxSurvivableFraction: number | null;
};

export type TrainingRun = {
  scenario: TrainingScenario;
  account: VirtualAccount;
  cursorIndex: number;
  initialCursorIndex: number;
  bars: Kline[];
  compareBars: Kline[] | null;
  position: SimPosition | null;
  /** Working order (only while flat). */
  pendingOrder: PendingOrder | null;
  revealed: boolean;
  locked: boolean;
  /** Set when the run ended by 爆仓 rather than by reveal or reaching the end. */
  liquidated: boolean;
  postmortem: Postmortem | null;
  stats: RunStats;
  markers: SimMarker[];
  /** Closed round-trips for 落库. */
  closedCycles: ClosedCycle[];
};

export const DEFAULT_START_EQUITY = 1000;
/** Default committed margin as a fraction of equity: safe by default, one slider drag from 满仓. */
export const DEFAULT_MARGIN_FRACTION = 0.25;
export const DEFAULT_LEVERAGE = 10;
/** Maintenance margin rate on notional; the 爆仓 threshold. */
export const MAINTENANCE_MARGIN_RATE = 0.005;
/** 手续费默认 0（docs/PRODUCT.md §六）：真实复刻优先级让位给可玩性，面板可改。 */
export const DEFAULT_FEE_RATE = 0;
export const DEFAULT_CONTEXT_BARS = 50;
/** Bars that must stay ahead of the cursor for a run to be playable. */
export const MIN_DECISION_BARS = 20;
export const MAX_LEVERAGE = 20;
export const MIN_SCENARIO_BARS = 100;
export const MAX_SCENARIO_BARS = 300;
