import type { Kline } from '../../services/api';
import type { Direction, RunStats, SimMarker, SimPosition, VirtualAccount } from './types';
import { MAX_LEVERAGE } from './types';

export type SimError = { ok: false; message: string };
export type SimOk<T> = { ok: true; value: T };
export type SimResult<T> = SimOk<T> | SimError;

export type Ledger = {
  account: VirtualAccount;
  position: SimPosition | null;
  stats: RunStats;
  markers: SimMarker[];
};

function feeOf(price: number, qty: number, feeRate: number): number {
  return Math.abs(price * qty * feeRate);
}

export function requiredMargin(price: number, qty: number, leverage: number): number {
  const lev = Math.min(MAX_LEVERAGE, Math.max(1, leverage));
  return Math.abs(price * qty) / lev;
}

export function unrealizedPnl(pos: SimPosition, mark: number): number {
  const diff = pos.direction === 'long' ? mark - pos.entryPrice : pos.entryPrice - mark;
  return diff * pos.qty;
}

export function usedMargin(pos: SimPosition | null): number {
  if (!pos) return 0;
  return requiredMargin(pos.entryPrice, pos.qty, pos.leverage);
}

export function availableEquity(account: VirtualAccount, pos: SimPosition | null, mark: number): number {
  const u = pos ? unrealizedPnl(pos, mark) : 0;
  return account.equity + u - usedMargin(pos);
}

function pushMarker(
  markers: SimMarker[],
  bar: Kline,
  side: 'entry' | 'exit',
  direction: Direction,
  price: number,
  label: string,
): SimMarker[] {
  return [...markers, { time: bar.time, price, side, direction, label }];
}

function closeQty(
  ledger: Ledger,
  bar: Kline,
  price: number,
  qty: number,
  reason: string,
): SimResult<Ledger> {
  const pos = ledger.position;
  if (!pos) return { ok: false, message: '当前无仓位' };
  if (!(qty > 0) || qty > pos.qty + 1e-12) return { ok: false, message: '平仓数量无效' };

  const closeAmount = Math.min(qty, pos.qty);
  const pnl =
    (pos.direction === 'long' ? price - pos.entryPrice : pos.entryPrice - price) * closeAmount;
  const fee = feeOf(price, closeAmount, ledger.account.feeRate);
  const remaining = pos.qty - closeAmount;
  const isFull = remaining <= 1e-12;
  const cyclePnl = pos.cyclePnl + pnl;
  const cycleFees = pos.cycleFees + fee;

  // Full flat only: win rate uses whole-cycle net (partials + final)
  const stats: RunStats = {
    trades: ledger.stats.trades + (isFull ? 1 : 0),
    wins: ledger.stats.wins + (isFull && cyclePnl - cycleFees > 0 ? 1 : 0),
    realizedPnl: ledger.stats.realizedPnl + pnl,
    fees: ledger.stats.fees + fee,
  };

  return {
    ok: true,
    value: {
      account: {
        ...ledger.account,
        equity: ledger.account.equity + pnl - fee,
      },
      position: isFull ? null : { ...pos, qty: remaining, cyclePnl, cycleFees },
      stats,
      markers: pushMarker(ledger.markers, bar, 'exit', pos.direction, price, reason),
    },
  };
}

/** Convert USDT notional → base qty at price. */
export function usdtToBase(usdt: number, price: number): number {
  if (!(price > 0) || !(usdt > 0)) return 0;
  return usdt / price;
}

export function baseToUsdt(qty: number, price: number): number {
  return Math.abs(qty * price);
}

/** Open with USDT notional (quote). Internal book keeps base qty. */
export function marketOpen(
  ledger: Ledger,
  bar: Kline,
  direction: Direction,
  usdtNotional: number,
  leverage: number,
  stopLoss?: number | null,
  takeProfit?: number | null,
): SimResult<Ledger> {
  if (ledger.position) {
    if (ledger.position.direction !== direction) {
      return { ok: false, message: '反向须先平仓' };
    }
    return { ok: false, message: '已有仓位，请使用加仓' };
  }
  if (!(usdtNotional > 0)) return { ok: false, message: '金额须大于 0' };
  const lev = Math.min(MAX_LEVERAGE, Math.max(1, leverage));
  const price = bar.close;
  const qty = usdtToBase(usdtNotional, price);
  if (!(qty > 0)) return { ok: false, message: '金额无效' };
  const margin = requiredMargin(price, qty, lev);
  const fee = feeOf(price, qty, ledger.account.feeRate);
  if (margin + fee > ledger.account.equity + 1e-9) {
    return { ok: false, message: '保证金不足' };
  }
  const position: SimPosition = {
    direction,
    qty,
    entryPrice: price,
    leverage: lev,
    stopLoss: stopLoss ?? null,
    takeProfit: takeProfit ?? null,
    cyclePnl: 0,
    cycleFees: fee,
  };
  return {
    ok: true,
    value: {
      account: { ...ledger.account, equity: ledger.account.equity - fee },
      position,
      stats: { ...ledger.stats, fees: ledger.stats.fees + fee },
      markers: pushMarker(ledger.markers, bar, 'entry', direction, price, '开仓'),
    },
  };
}

/** Add with USDT notional at current close. */
export function marketAdd(ledger: Ledger, bar: Kline, usdtNotional: number): SimResult<Ledger> {
  const pos = ledger.position;
  if (!pos) return { ok: false, message: '无仓位可加' };
  if (!(usdtNotional > 0)) return { ok: false, message: '金额须大于 0' };
  const price = bar.close;
  const qty = usdtToBase(usdtNotional, price);
  if (!(qty > 0)) return { ok: false, message: '金额无效' };
  const margin = requiredMargin(price, qty, pos.leverage);
  const fee = feeOf(price, qty, ledger.account.feeRate);
  const free = availableEquity(ledger.account, pos, price);
  if (margin + fee > free + 1e-9) return { ok: false, message: '保证金不足' };
  const newQty = pos.qty + qty;
  const entryPrice = (pos.entryPrice * pos.qty + price * qty) / newQty;
  return {
    ok: true,
    value: {
      account: { ...ledger.account, equity: ledger.account.equity - fee },
      position: { ...pos, qty: newQty, entryPrice, cycleFees: pos.cycleFees + fee },
      stats: { ...ledger.stats, fees: ledger.stats.fees + fee },
      markers: pushMarker(ledger.markers, bar, 'entry', pos.direction, price, '加仓'),
    },
  };
}

/** Close full or partial by USDT notional at fill price (close). Omit usdt = full close. */
export function marketClose(ledger: Ledger, bar: Kline, usdtNotional?: number): SimResult<Ledger> {
  const pos = ledger.position;
  if (!pos) return { ok: false, message: '当前无仓位' };
  if (usdtNotional == null) {
    return closeQty(ledger, bar, bar.close, pos.qty, '平仓');
  }
  if (!(usdtNotional > 0)) return { ok: false, message: '金额须大于 0' };
  const price = bar.close;
  let qty = usdtToBase(usdtNotional, price);
  if (qty >= pos.qty - 1e-12) qty = pos.qty;
  return closeQty(ledger, bar, price, qty, qty >= pos.qty - 1e-12 ? '平仓' : '减仓');
}

export function updateStops(
  ledger: Ledger,
  stopLoss?: number | null,
  takeProfit?: number | null,
): SimResult<Ledger> {
  if (!ledger.position) return { ok: false, message: '当前无仓位' };
  return {
    ok: true,
    value: {
      ...ledger,
      position: {
        ...ledger.position,
        stopLoss: stopLoss === undefined ? ledger.position.stopLoss : stopLoss,
        takeProfit: takeProfit === undefined ? ledger.position.takeProfit : takeProfit,
      },
    },
  };
}

/** Evaluate SL then TP on the bar just revealed (SL wins if both hit). */
export function applyStopsOnBar(ledger: Ledger, bar: Kline): Ledger {
  const pos = ledger.position;
  if (!pos) return ledger;

  const sl = pos.stopLoss;
  if (sl != null && Number.isFinite(sl)) {
    const hitSl = pos.direction === 'long' ? bar.low <= sl : bar.high >= sl;
    if (hitSl) {
      const r = closeQty(ledger, bar, sl, pos.qty, '止损');
      if (r.ok) return r.value;
    }
  }

  const tp = pos.takeProfit;
  if (tp != null && Number.isFinite(tp)) {
    const hitTp = pos.direction === 'long' ? bar.high >= tp : bar.low <= tp;
    if (hitTp) {
      const r = closeQty(ledger, bar, tp, pos.qty, '止盈');
      if (r.ok) return r.value;
    }
  }

  return ledger;
}

export function emptyLedger(startEquity: number, feeRate: number): Ledger {
  return {
    account: { startEquity, feeRate, equity: startEquity },
    position: null,
    stats: { trades: 0, wins: 0, realizedPnl: 0, fees: 0 },
    markers: [],
  };
}
