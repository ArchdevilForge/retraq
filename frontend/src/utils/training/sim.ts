import type { Kline } from '../../services/api';
import type {
  ClosedCycle,
  Direction,
  PendingOrder,
  PendingOrderKind,
  Postmortem,
  RunStats,
  SimMarker,
  SimPosition,
  VirtualAccount,
} from './types';
import { MAINTENANCE_MARGIN_RATE, MAX_LEVERAGE } from './types';

export type SimError = { ok: false; message: string };
export type SimOk<T> = { ok: true; value: T };
export type SimResult<T> = SimOk<T> | SimError;

export type Ledger = {
  account: VirtualAccount;
  position: SimPosition | null;
  /** Working order while flat (limit / stop / stop_limit). */
  pendingOrder: PendingOrder | null;
  stats: RunStats;
  markers: SimMarker[];
  closedCycles: ClosedCycle[];
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

  const closedCycles = isFull
    ? [
        ...ledger.closedCycles,
        {
          direction: pos.direction,
          entryPrice: pos.entryPrice,
          exitPrice: price,
          qty: pos.openedQty,
          leverage: pos.leverage,
          profit: cyclePnl,
          fees: cycleFees,
          entryTime: pos.openedAt,
          exitTime: bar.time,
          margin: requiredMargin(pos.entryPrice, pos.qty, pos.leverage),
          reason,
        } as ClosedCycle,
      ]
    : ledger.closedCycles;

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
      pendingOrder: ledger.pendingOrder,
      stats,
      markers: pushMarker(ledger.markers, bar, 'exit', pos.direction, price, reason),
      closedCycles,
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

/** Open at an explicit fill price (market close, or a working order's level). */
function openAtPrice(
  ledger: Ledger,
  bar: Kline,
  direction: Direction,
  marginUsdt: number,
  leverage: number,
  stopLoss: number | null | undefined,
  takeProfit: number | null | undefined,
  price: number,
  label: string,
): SimResult<Ledger> {
  if (ledger.position) {
    return { ok: false, message: '已有仓位' };
  }
  if (!(marginUsdt > 0)) return { ok: false, message: '保证金须大于 0' };
  const lev = clampLeverage(leverage);
  if (!(price > 0)) return { ok: false, message: '成交价无效' };
  const notional = marginToNotional(marginUsdt, lev);
  const qty = notional / price;
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
    openedQty: qty,
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
      pendingOrder: null,
      stats: { ...ledger.stats, fees: ledger.stats.fees + fee },
      markers: pushMarker(ledger.markers, bar, 'entry', direction, price, label),
      closedCycles: ledger.closedCycles,
    },
  };
}

/** Open by committed margin at the cursor bar's close. */
export function marketOpen(
  ledger: Ledger,
  bar: Kline,
  direction: Direction,
  marginUsdt: number,
  leverage: number,
  stopLoss?: number | null,
  takeProfit?: number | null,
): SimResult<Ledger> {
  if (ledger.pendingOrder) return { ok: false, message: '有挂单待成交，先撤销' };
  if (ledger.position) {
    if (ledger.position.direction !== direction) {
      return { ok: false, message: '反向请使用反向开仓' };
    }
    return { ok: false, message: '已有仓位，请使用加仓' };
  }
  return openAtPrice(ledger, bar, direction, marginUsdt, leverage, stopLoss, takeProfit, bar.close, '开仓');
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
      pendingOrder: ledger.pendingOrder,
      stats: { ...ledger.stats, fees: ledger.stats.fees + fee },
      markers: pushMarker(ledger.markers, bar, 'entry', pos.direction, price, '加仓'),
      closedCycles: ledger.closedCycles,
    },
  };
}

/**
 * Place a working order while flat: limit fills at the level, stop triggers
 * through it, stop_limit triggers then keeps working as a limit at limitPrice.
 */
export function placePendingOrder(
  ledger: Ledger,
  bar: Kline,
  kind: PendingOrderKind,
  direction: Direction,
  marginUsdt: number,
  leverage: number,
  price: number,
  limitPrice?: number | null,
  stopLoss?: number | null,
  takeProfit?: number | null,
): SimResult<Ledger> {
  if (ledger.position) return { ok: false, message: '挂单只能在空仓时下' };
  if (ledger.pendingOrder) return { ok: false, message: '已有挂单，先撤销' };
  if (!(marginUsdt > 0)) return { ok: false, message: '保证金须大于 0' };
  if (!(price > 0)) return { ok: false, message: '价格无效' };
  const mark = bar.close;
  const long = direction === 'long';
  if (kind === 'limit') {
    const wrongSide = long ? price >= mark : price <= mark;
    if (wrongSide) return { ok: false, message: long ? '限价买须低于现价' : '限价卖须高于现价' };
  } else {
    const wrongSide = long ? price <= mark : price >= mark;
    if (wrongSide) return { ok: false, message: long ? '止损买须高于现价' : '止损卖须低于现价' };
    if (kind === 'stop_limit') {
      const lp = limitPrice ?? 0;
      if (!(lp > 0)) return { ok: false, message: '止损限价缺少委托价' };
      const wrongLimit = long ? lp <= price : lp >= price;
      if (wrongLimit) return { ok: false, message: long ? '委托价须高于触发价' : '委托价须低于触发价' };
    }
  }
  const badStops = checkStops(direction, mark, stopLoss, takeProfit);
  if (badStops) return badStops;
  // Reserve check at the expected fill price so an unfundable order never works.
  const probe = requiredMargin(price, 1, leverage) * 0 + marginUsdt;
  const probeFee = feeOf(price, marginToNotional(marginUsdt, leverage), ledger.account.feeRate);
  if (probe + probeFee > ledger.account.equity + 1e-9) {
    return { ok: false, message: '保证金不足' };
  }
  return {
    ok: true,
    value: {
      ...ledger,
      pendingOrder: {
        kind,
        direction,
        price,
        limitPrice: kind === 'stop_limit' ? limitPrice ?? null : null,
        marginUsdt,
        leverage: clampLeverage(leverage),
        stopLoss: stopLoss ?? null,
        takeProfit: takeProfit ?? null,
      },
    },
  };
}

export function cancelPendingOrder(ledger: Ledger): SimResult<Ledger> {
  if (!ledger.pendingOrder) return { ok: false, message: '没有挂单' };
  return { ok: true, value: { ...ledger, pendingOrder: null } };
}

/** Fill price for a working order on this bar, or null when it doesn't fill. */
function orderFill(ledger: Ledger, bar: Kline): { price: number; order: PendingOrder } | null {
  const order = ledger.pendingOrder;
  if (!order) return null;
  const long = order.direction === 'long';
  if (order.kind === 'stop_limit') {
    const triggerHit = long ? bar.high >= order.price : bar.low <= order.price;
    if (!triggerHit) return null;
    // After the trigger, the limit must also trade within this bar to fill.
    const lp = order.limitPrice ?? order.price;
    const limitHit = long ? bar.high >= lp : bar.low <= lp;
    if (!limitHit) return null;
    const price = long ? Math.max(lp, bar.open) : Math.min(lp, bar.open);
    return { price, order: { ...order } };
  }

  if (order.kind === 'limit') {
    const hit = long ? bar.low <= order.price : bar.high >= order.price;
    if (!hit) return null;
    const price = long ? Math.min(order.price, bar.open) : Math.max(order.price, bar.open);
    return { price, order };
  }

  // stop
  const hit = long ? bar.high >= order.price : bar.low <= order.price;
  if (!hit) return null;
  const price = long ? Math.max(order.price, bar.open) : Math.min(order.price, bar.open);
  return { price, order };
}

/**
 * Settle a revealed bar: working order fills first, then the position's
 * stop-loss / take-profit / 强平 compete on the same bar.
 */
export function applyBarAdvance(ledger: Ledger, bar: Kline): { ledger: Ledger; liquidated: boolean } {
  let current = ledger;
  const fill = orderFill(current, bar);
  if (fill) {
    const label = fill.order.kind === 'limit' ? '限价成交' : fill.order.kind === 'stop' ? '止损单成交' : '止损限价成交';
    const opened = openAtPrice(
      { ...current, position: null },
      bar,
      fill.order.direction,
      fill.order.marginUsdt,
      fill.order.leverage,
      fill.order.stopLoss,
      fill.order.takeProfit,
      fill.price,
      label,
    );
    if (opened.ok) current = opened.value;
  } else if (current.pendingOrder?.kind === 'stop_limit') {
    // Triggered but the limit was out of reach this bar: keep working as a pure limit.
    const o = current.pendingOrder;
    const long = o.direction === 'long';
    const triggered = long ? bar.high >= o.price : bar.low <= o.price;
    if (triggered) {
      current = {
        ...current,
        pendingOrder: { ...o, kind: 'limit', price: o.limitPrice ?? o.price, limitPrice: null },
      };
    }
  }
  return applyBarExits(current, bar);
}

/** 反向开仓：平掉全部持仓，同保证金反向开回（docs/PRODUCT.md §六）。 */
export function reversePosition(ledger: Ledger, bar: Kline, marginUsdt: number): SimResult<Ledger> {
  const pos = ledger.position;
  if (!pos) return { ok: false, message: '无仓位可反向' };
  const closed = marketClose(ledger, bar);
  if (!closed.ok) return closed;
  return marketOpen(closed.value, bar, pos.direction === 'long' ? 'short' : 'long', marginUsdt, pos.leverage);
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
    if (!current.position && !current.pendingOrder) break;
    const position = current.position;
    const backingBalance = current.account.equity;
    const advanced = applyBarAdvance(current, bar);
    current = advanced.ledger;
    if (advanced.liquidated && position) {
      return { ledger: current, liquidation: { position, backingBalance } };
    }
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
    pendingOrder: null,
    stats: { trades: 0, wins: 0, realizedPnl: 0, fees: 0 },
    markers: [],
    closedCycles: [],
  };
}
