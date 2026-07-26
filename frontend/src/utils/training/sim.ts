import type { Kline } from '../../services/api';
import type { Direction, Postmortem, RunStats, SimMarker, SimPosition, VirtualAccount } from './types';
import { MAINTENANCE_MARGIN_RATE, MAX_LEVERAGE } from './types';

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

export function clampLeverage(leverage: number): number {
  return Math.min(MAX_LEVERAGE, Math.max(1, leverage));
}

export function requiredMargin(price: number, qty: number, leverage: number): number {
  return Math.abs(price * qty) / clampLeverage(leverage);
}

/** Notional a committed margin buys at this leverage. */
export function marginToNotional(margin: number, leverage: number): number {
  if (!(margin > 0)) return 0;
  return margin * clampLeverage(leverage);
}

/**
 * Largest margin that can actually be committed from this free balance.
 *
 * The open fee is charged on notional and paid out of the balance, so committing
 * the whole balance leaves nothing for it — 满仓 means "as much as still opens",
 * which is what an exchange's MAX button gives you.
 */
export function maxOpenableMargin(freeEquity: number, leverage: number, feeRate: number): number {
  if (!(freeEquity > 0)) return 0;
  const lev = clampLeverage(leverage);
  return freeEquity / (1 + lev * Math.max(0, feeRate));
}

export function notionalOf(pos: SimPosition, price: number): number {
  return Math.abs(pos.qty * price);
}

/**
 * Cross margin: the whole balance backs the position, so 爆仓 comes from
 * notional-vs-equity, not from leverage on its own.
 *
 *   long:  balance + (P - entry)·qty = P·qty·mmr
 *   short: balance + (entry - P)·qty = P·qty·mmr
 *
 * Returns null when the position can never be liquidated (e.g. a short can
 * always be, a long cannot once balance covers the whole notional).
 */
export function liquidationPrice(
  account: VirtualAccount,
  pos: SimPosition | null,
  mmr: number = MAINTENANCE_MARGIN_RATE,
): number | null {
  if (!pos || !(pos.qty > 0)) return null;
  const balance = account.equity;
  const entryNotional = pos.entryPrice * pos.qty;
  if (pos.direction === 'long') {
    const price = (entryNotional - balance) / (pos.qty * (1 - mmr));
    return price > 0 ? price : null;
  }
  return (balance + entryNotional) / (pos.qty * (1 + mmr));
}

/** Adverse move from the mark that would liquidate, as a fraction (0.095 = 9.5%). */
export function liquidationDistance(
  account: VirtualAccount,
  pos: SimPosition | null,
  mark: number,
  mmr: number = MAINTENANCE_MARGIN_RATE,
): number | null {
  const liq = liquidationPrice(account, pos, mmr);
  if (liq == null || !(mark > 0)) return null;
  return Math.abs(mark - liq) / mark;
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

/** Reject levels on the wrong side of the mark (null/undefined always allowed). */
function checkStops(
  direction: Direction,
  mark: number,
  stopLoss?: number | null,
  takeProfit?: number | null,
): SimError | null {
  if (stopLoss != null && Number.isFinite(stopLoss)) {
    const wrongSide = direction === 'long' ? stopLoss >= mark : stopLoss <= mark;
    if (wrongSide) {
      return { ok: false, message: direction === 'long' ? '止损价须低于现价' : '止损价须高于现价' };
    }
  }
  if (takeProfit != null && Number.isFinite(takeProfit)) {
    const wrongSide = direction === 'long' ? takeProfit <= mark : takeProfit >= mark;
    if (wrongSide) {
      return { ok: false, message: direction === 'long' ? '止盈价须高于现价' : '止盈价须低于现价' };
    }
  }
  return null;
}

/** Open by committed margin; leverage turns it into notional. */
export function marketOpen(
  ledger: Ledger,
  bar: Kline,
  direction: Direction,
  marginUsdt: number,
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
  if (!(marginUsdt > 0)) return { ok: false, message: '保证金须大于 0' };
  const lev = clampLeverage(leverage);
  const price = bar.close;
  const notional = marginToNotional(marginUsdt, lev);
  const qty = price > 0 ? notional / price : 0;
  if (!(qty > 0)) return { ok: false, message: '保证金无效' };
  const badStops = checkStops(direction, price, stopLoss, takeProfit);
  if (badStops) return badStops;
  const fee = feeOf(price, qty, ledger.account.feeRate);
  if (marginUsdt + fee > ledger.account.equity + 1e-9) {
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
    openedAt: bar.time,
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

/** Add by committed margin at the position's leverage. */
export function marketAdd(ledger: Ledger, bar: Kline, marginUsdt: number): SimResult<Ledger> {
  const pos = ledger.position;
  if (!pos) return { ok: false, message: '无仓位可加' };
  if (!(marginUsdt > 0)) return { ok: false, message: '保证金须大于 0' };
  const price = bar.close;
  const notional = marginToNotional(marginUsdt, pos.leverage);
  const qty = price > 0 ? notional / price : 0;
  if (!(qty > 0)) return { ok: false, message: '保证金无效' };
  const fee = feeOf(price, qty, ledger.account.feeRate);
  const free = availableEquity(ledger.account, pos, price);
  if (marginUsdt + fee > free + 1e-9) return { ok: false, message: '保证金不足' };
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

/** Close a fraction of the position (0–1] at the cursor bar's close. Omit = full close. */
export function marketClose(ledger: Ledger, bar: Kline, fraction?: number): SimResult<Ledger> {
  const pos = ledger.position;
  if (!pos) return { ok: false, message: '当前无仓位' };
  if (fraction == null) {
    return closeQty(ledger, bar, bar.close, pos.qty, '平仓');
  }
  if (!(fraction > 0)) return { ok: false, message: '平仓比例须大于 0' };
  if (fraction > 1 + 1e-12) return { ok: false, message: '平仓比例不能超过 100%' };
  let qty = pos.qty * fraction;
  if (qty >= pos.qty - 1e-12) qty = pos.qty;
  return closeQty(ledger, bar, bar.close, qty, qty >= pos.qty - 1e-12 ? '平仓' : '减仓');
}

/** Levels are validated against the cursor bar's close (current mark). */
export function updateStops(
  ledger: Ledger,
  bar: Kline,
  stopLoss?: number | null,
  takeProfit?: number | null,
): SimResult<Ledger> {
  const pos = ledger.position;
  if (!pos) return { ok: false, message: '当前无仓位' };
  const nextSl = stopLoss === undefined ? pos.stopLoss : stopLoss;
  const nextTp = takeProfit === undefined ? pos.takeProfit : takeProfit;
  const badStops = checkStops(pos.direction, bar.close, nextSl, nextTp);
  if (badStops) return badStops;
  return {
    ok: true,
    value: {
      ...ledger,
      position: { ...pos, stopLoss: nextSl, takeProfit: nextTp },
    },
  };
}

/** Fill at the level, unless the bar gapped past it: then fill at the open, always inside the bar. */
function stopFillPrice(bar: Kline, level: number, side: 'below' | 'above'): number {
  return side === 'below'
    ? Math.max(bar.low, Math.min(level, bar.open))
    : Math.min(bar.high, Math.max(level, bar.open));
}

type ExitLevel = { level: number; reason: string; liquidation: boolean };

function finite(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

/**
 * Which level this bar takes the position out at, if any.
 *
 * Adverse levels (stop-loss, 强平价) and the take-profit compete by which price
 * reaches first: on the adverse side that is the level nearest the entry, so a
 * stop tighter than the 强平价 always fires first and prevents a 爆仓. Intrabar
 * order is unknowable, so an adverse level wins a tie against the take-profit.
 */
export function resolveBarExit(
  ledger: Ledger,
  bar: Kline,
): { price: number; reason: string; liquidation: boolean } | null {
  const pos = ledger.position;
  if (!pos) return null;

  const long = pos.direction === 'long';
  const adverse: ExitLevel[] = [];
  const sl = finite(pos.stopLoss);
  if (sl != null) adverse.push({ level: sl, reason: '止损', liquidation: false });
  const liq = liquidationPrice(ledger.account, pos);
  if (liq != null) adverse.push({ level: liq, reason: '强平', liquidation: true });
  const tp = finite(pos.takeProfit);

  // First hit on the adverse side is the level closest to the entry.
  const firstAdverse = (candidates: ExitLevel[]): ExitLevel | null =>
    candidates.length === 0
      ? null
      : candidates.reduce((best, c) => ((long ? c.level > best.level : c.level < best.level) ? c : best));

  // A bar that opened past a level already traded through it: fill at the open.
  const gapped = firstAdverse(adverse.filter((a) => (long ? bar.open <= a.level : bar.open >= a.level)));
  if (gapped) return { price: bar.open, reason: gapped.reason, liquidation: gapped.liquidation };
  if (tp != null && (long ? bar.open >= tp : bar.open <= tp)) {
    return { price: bar.open, reason: '止盈', liquidation: false };
  }

  const hit = firstAdverse(adverse.filter((a) => (long ? bar.low <= a.level : bar.high >= a.level)));
  if (hit) {
    return {
      price: stopFillPrice(bar, hit.level, long ? 'below' : 'above'),
      reason: hit.reason,
      liquidation: hit.liquidation,
    };
  }
  if (tp != null && (long ? bar.high >= tp : bar.low <= tp)) {
    return {
      price: stopFillPrice(bar, tp, long ? 'above' : 'below'),
      reason: '止盈',
      liquidation: false,
    };
  }
  return null;
}

/** Settle stop-loss / take-profit / 强平 on the bar just revealed. */
export function applyBarExits(ledger: Ledger, bar: Kline): { ledger: Ledger; liquidated: boolean } {
  const pos = ledger.position;
  if (!pos) return { ledger, liquidated: false };
  const exit = resolveBarExit(ledger, bar);
  if (!exit) return { ledger, liquidated: false };

  const r = closeQty(ledger, bar, exit.price, pos.qty, exit.reason);
  if (!r.ok) return { ledger, liquidated: false };
  if (!exit.liquidation) return { ledger: r.value, liquidated: false };

  // Cross margin 爆仓: the balance is gone, whatever rounding the fill leaves behind.
  return {
    ledger: { ...r.value, account: { ...r.value.account, equity: 0 } },
    liquidated: true,
  };
}

/**
 * Settle a run of bars in order, stopping at a 爆仓.
 *
 * 揭晓 uses this rather than jumping to the final bar: an open position must not
 * escape a stop — or a liquidation — that the masked bars would have delivered.
 */
export function replayExits(
  ledger: Ledger,
  bars: Kline[],
): { ledger: Ledger; liquidation: { position: SimPosition; backingBalance: number } | null } {
  let current = ledger;
  for (const bar of bars) {
    const position = current.position;
    if (!position) break;
    const backingBalance = current.account.equity;
    const exits = applyBarExits(current, bar);
    current = exits.ledger;
    if (exits.liquidated) return { ledger: current, liquidation: { position, backingBalance } };
  }
  return { ledger: current, liquidation: null };
}

/**
 * Largest committed margin that would have survived the rest of the scenario.
 *
 * Solves the liquidation identity for notional against the worst adverse price
 * seen after entry, then divides by leverage. Assumes every other action is
 * unchanged and only the size scales — it never implies a better exit existed.
 *
 * long:  N ≤ entry·B / (entry − worst·(1 − mmr))
 * short: N ≤ entry·B / (worst·(1 + mmr) − entry)
 * A non-positive denominator means no size could ever be liquidated here.
 */
export function buildPostmortem(
  pos: SimPosition,
  equityAtEntry: number,
  barsAfterEntry: Kline[],
  mmr: number = MAINTENANCE_MARGIN_RATE,
): Postmortem {
  const long = pos.direction === 'long';
  const entry = pos.entryPrice;
  const worst = barsAfterEntry.length
    ? barsAfterEntry.reduce(
        (acc, b) => (long ? Math.min(acc, b.low) : Math.max(acc, b.high)),
        long ? Infinity : -Infinity,
      )
    : entry;
  const adverseExcursion = entry > 0 ? Math.max(0, long ? (entry - worst) / entry : (worst - entry) / entry) : 0;

  const denominator = long ? entry - worst * (1 - mmr) : worst * (1 + mmr) - entry;
  const used = requiredMargin(entry, pos.qty, pos.leverage);
  if (!(denominator > 0) || !(equityAtEntry > 0)) {
    return {
      entryPrice: entry,
      direction: pos.direction,
      adverseExcursion,
      usedMargin: used,
      maxSurvivableMargin: null,
      maxSurvivableFraction: null,
    };
  }
  const maxNotional = (entry * equityAtEntry) / denominator;
  const maxMargin = maxNotional / clampLeverage(pos.leverage);
  return {
    entryPrice: entry,
    direction: pos.direction,
    adverseExcursion,
    usedMargin: used,
    maxSurvivableMargin: maxMargin,
    maxSurvivableFraction: maxMargin / equityAtEntry,
  };
}

export function emptyLedger(startEquity: number, feeRate: number): Ledger {
  return {
    account: { startEquity, feeRate, equity: startEquity },
    position: null,
    stats: { trades: 0, wins: 0, realizedPnl: 0, fees: 0 },
    markers: [],
  };
}
