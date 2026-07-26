import { describe, expect, it } from 'vitest';
import type { Kline } from '../../services/api';
import type { Ledger, SimResult } from './sim';
import {
  applyBarExits,
  availableEquity,
  buildPostmortem,
  clampLeverage,
  emptyLedger,
  liquidationPrice,
  marginToNotional,
  marketAdd,
  marketClose,
  marketOpen,
  notionalOf,
  requiredMargin,
  resolveBarExit,
  unrealizedPnl,
  updateStops,
  usedMargin,
} from './sim';
import type { Direction } from './types';
import { MAX_LEVERAGE } from './types';

function bar(o: Partial<Kline> & { close: number }): Kline {
  const c = o.close;
  return {
    time: o.time ?? 1_700_000_000,
    open: o.open ?? c,
    high: o.high ?? Math.max(o.open ?? c, c),
    low: o.low ?? Math.min(o.open ?? c, c),
    close: c,
    volume: o.volume ?? 0,
  };
}

function unwrap(r: SimResult<Ledger>): Ledger {
  if (!r.ok) throw new Error(`expected ok, got: ${r.message}`);
  return r.value;
}

function errMessage(r: SimResult<Ledger>): string {
  if (r.ok) throw new Error('expected rejection, got ok');
  return r.message;
}

/** 20 USDT margin @ 10x, price 100 -> qty 2. Small enough on 1000 equity to be unliquidatable. */
function openedLong(feeRate = 0, startEquity = 1000): Ledger {
  return unwrap(marketOpen(emptyLedger(startEquity, feeRate), bar({ close: 100 }), 'long', 20, 10));
}

function openedShort(feeRate = 0, startEquity = 1000): Ledger {
  return unwrap(marketOpen(emptyLedger(startEquity, feeRate), bar({ close: 100 }), 'short', 20, 10));
}

/** 满仓 on 1000 equity @ 10x, price 100 -> qty 100; 强平价 90.4523 long / 109.4527 short. */
function fullSize(direction: Direction): Ledger {
  return unwrap(marketOpen(emptyLedger(1000, 0), bar({ close: 100 }), direction, 1000, 10));
}

const LONG_LIQ = 90.4523;
const SHORT_LIQ = 109.4527;

describe('sizing: committed margin x leverage = notional', () => {
  it('marginToNotional multiplies by the clamped leverage', () => {
    expect(marginToNotional(250, 10)).toBeCloseTo(2500, 12);
    expect(marginToNotional(1000, 1)).toBeCloseTo(1000, 12);
    expect(marginToNotional(100, 1000)).toBeCloseTo(100 * MAX_LEVERAGE, 12);
    expect(marginToNotional(0, 10)).toBe(0);
    expect(marginToNotional(-5, 10)).toBe(0);
  });

  it('clampLeverage bounds leverage to [1, MAX_LEVERAGE]', () => {
    expect(clampLeverage(7)).toBe(7);
    expect(clampLeverage(MAX_LEVERAGE)).toBe(MAX_LEVERAGE);
    expect(clampLeverage(MAX_LEVERAGE + 5)).toBe(MAX_LEVERAGE);
    expect(clampLeverage(0)).toBe(1);
    expect(clampLeverage(-50)).toBe(1);
  });

  it('marketOpen buys margin x leverage of notional, not margin of notional', () => {
    const led = unwrap(marketOpen(emptyLedger(1000, 0), bar({ close: 50 }), 'long', 250, 10));
    expect(led.position?.qty).toBeCloseTo(50, 12);
    expect(notionalOf(led.position!, 50)).toBeCloseTo(2500, 12);
    expect(usedMargin(led.position)).toBeCloseTo(250, 12);
  });

  it('rejects committing more margin than the equity backing it', () => {
    expect(marketOpen(emptyLedger(1000, 0), bar({ close: 100 }), 'long', 1000, 10).ok).toBe(true);
    expect(errMessage(marketOpen(emptyLedger(1000, 0), bar({ close: 100 }), 'long', 1000.01, 10))).toBe(
      '保证金不足',
    );
  });

  it('counts the open fee against the margin budget', () => {
    // margin 990 + fee 9.9 fits in 1000; margin 1000 + fee 10 does not
    expect(marketOpen(emptyLedger(1000, 0.001), bar({ close: 100 }), 'long', 990, 10).ok).toBe(true);
    expect(errMessage(marketOpen(emptyLedger(1000, 0.001), bar({ close: 100 }), 'long', 1000, 10))).toBe(
      '保证金不足',
    );
  });

  it('rejects a non-positive margin', () => {
    expect(errMessage(marketOpen(emptyLedger(1000, 0), bar({ close: 100 }), 'long', 0, 10))).toBe(
      '保证金须大于 0',
    );
    expect(errMessage(marketOpen(emptyLedger(1000, 0), bar({ close: 100 }), 'short', -10, 10))).toBe(
      '保证金须大于 0',
    );
  });

  it('clamps the stored leverage and sizes with the clamped value', () => {
    const led = unwrap(marketOpen(emptyLedger(1000, 0), bar({ close: 100 }), 'long', 20, 1000));
    expect(led.position?.leverage).toBe(MAX_LEVERAGE);
    expect(led.position?.qty).toBeCloseTo((20 * MAX_LEVERAGE) / 100, 12);
    expect(usedMargin(led.position)).toBeCloseTo(20, 12);
  });

  it('stamps openedAt, seeds the cycle counters and deducts the fee', () => {
    const led = unwrap(
      marketOpen(emptyLedger(1000, 0.001), bar({ time: 1_700_000_600, close: 100 }), 'long', 20, 10),
    );
    expect(led.position?.openedAt).toBe(1_700_000_600);
    expect(led.position?.entryPrice).toBe(100);
    expect(led.position?.cyclePnl).toBe(0);
    expect(led.position?.cycleFees).toBeCloseTo(0.2, 12);
    expect(led.stats.fees).toBeCloseTo(0.2, 12);
    expect(led.stats.trades).toBe(0);
    expect(led.account.equity).toBeCloseTo(1000 - 0.2, 12);
    expect(led.markers).toHaveLength(1);
    expect(led.markers[0]).toMatchObject({ side: 'entry', direction: 'long', label: '开仓', price: 100 });
  });
});

describe('margin / pnl helpers', () => {
  it('requiredMargin divides notional by the clamped leverage', () => {
    expect(requiredMargin(100, 1, 10)).toBeCloseTo(10, 12);
    expect(requiredMargin(100, 1, 1)).toBeCloseTo(100, 12);
    expect(requiredMargin(100, 1, 1000)).toBeCloseTo(100 / MAX_LEVERAGE, 12);
    expect(requiredMargin(100, 1, -50)).toBeCloseTo(100, 12);
  });

  it('notionalOf is the unsigned mark notional', () => {
    expect(notionalOf(openedLong().position!, 150)).toBeCloseTo(300, 12);
    expect(notionalOf(openedShort().position!, 150)).toBeCloseTo(300, 12);
  });

  it('unrealizedPnl signs by direction', () => {
    expect(unrealizedPnl(openedLong().position!, 120)).toBeCloseTo(40, 12);
    expect(unrealizedPnl(openedLong().position!, 80)).toBeCloseTo(-40, 12);
    expect(unrealizedPnl(openedShort().position!, 120)).toBeCloseTo(-40, 12);
    expect(unrealizedPnl(openedShort().position!, 80)).toBeCloseTo(40, 12);
  });

  it('usedMargin is the committed margin; availableEquity nets unrealized against it', () => {
    expect(usedMargin(null)).toBe(0);
    const led = openedLong();
    expect(usedMargin(led.position)).toBeCloseTo(20, 12);
    expect(availableEquity(led.account, led.position, 120)).toBeCloseTo(1000 + 40 - 20, 12);
    expect(availableEquity(led.account, null, 120)).toBeCloseTo(1000, 12);
  });
});

describe('open guards', () => {
  it('rejects a reverse-direction open with 反向须先平仓', () => {
    expect(errMessage(marketOpen(openedLong(), bar({ close: 100 }), 'short', 20, 10))).toBe('反向须先平仓');
    expect(errMessage(marketOpen(openedShort(), bar({ close: 100 }), 'long', 20, 10))).toBe('反向须先平仓');
  });

  it('rejects a same-direction open with 已有仓位，请使用加仓', () => {
    expect(errMessage(marketOpen(openedLong(), bar({ close: 100 }), 'long', 20, 10))).toBe(
      '已有仓位，请使用加仓',
    );
    expect(errMessage(marketOpen(openedShort(), bar({ close: 100 }), 'short', 20, 10))).toBe(
      '已有仓位，请使用加仓',
    );
  });

  it('rejects wrong-side stop-loss levels at open', () => {
    // The exploit: a short @100 stopping out at 95 would "stop out" into profit.
    expect(errMessage(marketOpen(emptyLedger(1000, 0), bar({ close: 100 }), 'short', 20, 10, 95))).toBe(
      '止损价须高于现价',
    );
    expect(errMessage(marketOpen(emptyLedger(1000, 0), bar({ close: 100 }), 'long', 20, 10, 105))).toBe(
      '止损价须低于现价',
    );
  });

  it('rejects wrong-side take-profit levels at open', () => {
    expect(
      errMessage(marketOpen(emptyLedger(1000, 0), bar({ close: 100 }), 'long', 20, 10, null, 95)),
    ).toBe('止盈价须高于现价');
    expect(
      errMessage(marketOpen(emptyLedger(1000, 0), bar({ close: 100 }), 'short', 20, 10, null, 105)),
    ).toBe('止盈价须低于现价');
  });

  it('rejects a level sitting exactly on the mark', () => {
    expect(errMessage(marketOpen(emptyLedger(1000, 0), bar({ close: 100 }), 'long', 20, 10, 100))).toBe(
      '止损价须低于现价',
    );
    expect(
      errMessage(marketOpen(emptyLedger(1000, 0), bar({ close: 100 }), 'short', 20, 10, null, 100)),
    ).toBe('止盈价须低于现价');
  });

  it('updateStops refuses a wrong-side move and leaves the position untouched', () => {
    const short = openedShort();
    expect(errMessage(updateStops(short, bar({ close: 100 }), 95))).toBe('止损价须高于现价');
    expect(short.position?.stopLoss).toBeNull();

    const long = openedLong();
    expect(errMessage(updateStops(long, bar({ close: 100 }), 105))).toBe('止损价须低于现价');
    expect(errMessage(updateStops(long, bar({ close: 100 }), null, 95))).toBe('止盈价须高于现价');
    expect(errMessage(updateStops(short, bar({ close: 100 }), null, 105))).toBe('止盈价须低于现价');
  });

  it('updateStops accepts correct-side levels and leaves the untouched side alone', () => {
    const led = unwrap(updateStops(openedLong(), bar({ close: 100 }), 95, 110));
    expect(led.position?.stopLoss).toBe(95);
    expect(led.position?.takeProfit).toBe(110);
    const led2 = unwrap(updateStops(led, bar({ close: 100 }), undefined, 120));
    expect(led2.position?.stopLoss).toBe(95);
    expect(led2.position?.takeProfit).toBe(120);
  });

  it('updateStops rejects without a position', () => {
    expect(errMessage(updateStops(emptyLedger(1000, 0), bar({ close: 100 }), 95))).toBe('当前无仓位');
  });
});

describe('marketAdd', () => {
  it('computes the weighted-average entry price and keeps the cycle anchor', () => {
    const base = openedLong();
    const led = unwrap(marketAdd(base, bar({ time: 1_700_000_600, close: 150 }), 30));
    // 2 @ 100 + (30 x 10 / 150 = 2) @ 150 -> 4 @ 125
    expect(led.position?.qty).toBeCloseTo(4, 12);
    expect(led.position?.entryPrice).toBeCloseTo(125, 12);
    expect(led.position?.openedAt).toBe(base.position?.openedAt);
    expect(led.markers.at(-1)).toMatchObject({ side: 'entry', label: '加仓', price: 150 });
  });

  it('sizes the add with the position leverage, not a fresh default', () => {
    const led = unwrap(marketOpen(emptyLedger(1000, 0), bar({ close: 100 }), 'long', 20, 5));
    expect(led.position?.qty).toBeCloseTo(1, 12);
    const added = unwrap(marketAdd(led, bar({ close: 100 }), 20));
    expect(added.position?.leverage).toBe(5);
    // 20 x 5 / 100 = 1 more, not 20 x 10 / 100 = 2
    expect(added.position?.qty).toBeCloseTo(2, 12);
  });

  it('accrues the add fee into cycleFees and stats.fees', () => {
    const led = unwrap(marketAdd(openedLong(0.001), bar({ close: 100 }), 20));
    expect(led.stats.fees).toBeCloseTo(0.4, 12);
    expect(led.position?.cycleFees).toBeCloseTo(0.4, 12);
    expect(led.account.equity).toBeCloseTo(1000 - 0.4, 12);
  });

  it('is gated by availableEquity, not by raw equity', () => {
    // equity 100 with 20 committed -> 80 free, even though equity still reads 100
    const led = unwrap(marketOpen(emptyLedger(100, 0), bar({ close: 100 }), 'long', 20, 10));
    expect(led.account.equity).toBe(100);
    expect(marketAdd(led, bar({ close: 100 }), 80).ok).toBe(true);
    expect(errMessage(marketAdd(led, bar({ close: 100 }), 81))).toBe('保证金不足');
  });

  it('lets unrealized profit widen the add budget', () => {
    const led = unwrap(marketOpen(emptyLedger(100, 0), bar({ close: 100 }), 'long', 20, 10));
    // at 200 the position is +200 unrealized: free = 100 + 200 - 20 = 280
    expect(marketAdd(led, bar({ close: 200 }), 280).ok).toBe(true);
    expect(errMessage(marketAdd(led, bar({ close: 200 }), 281))).toBe('保证金不足');
  });

  it('rejects without a position and for a non-positive margin', () => {
    expect(errMessage(marketAdd(emptyLedger(100, 0), bar({ close: 100 }), 10))).toBe('无仓位可加');
    expect(errMessage(marketAdd(openedLong(), bar({ close: 100 }), 0))).toBe('保证金须大于 0');
  });

  it('short: the weighted-average entry price rises when adding higher', () => {
    const led = unwrap(marketAdd(openedShort(), bar({ close: 150 }), 30));
    expect(led.position?.direction).toBe('short');
    expect(led.position?.qty).toBeCloseTo(4, 12);
    expect(led.position?.entryPrice).toBeCloseTo(125, 12);
  });
});

describe('marketClose by fraction', () => {
  it('0.5 halves the qty, labels 减仓 and counts no trade', () => {
    const led = unwrap(marketClose(openedLong(), bar({ close: 120 }), 0.5));
    expect(led.position?.qty).toBeCloseTo(1, 12);
    expect(led.position?.entryPrice).toBe(100);
    expect(led.position?.cyclePnl).toBeCloseTo(20, 12);
    expect(led.stats.trades).toBe(0);
    expect(led.stats.wins).toBe(0);
    expect(led.stats.realizedPnl).toBeCloseTo(20, 12);
    expect(led.account.equity).toBeCloseTo(1020, 12);
    expect(led.markers.at(-1)).toMatchObject({ side: 'exit', direction: 'long', label: '减仓' });
  });

  it('an omitted fraction closes the rest, labels 平仓 and counts one trade', () => {
    const partial = unwrap(marketClose(openedLong(), bar({ close: 120 }), 0.5));
    const led = unwrap(marketClose(partial, bar({ close: 120 })));
    expect(led.position).toBeNull();
    expect(led.stats.trades).toBe(1);
    expect(led.stats.wins).toBe(1);
    expect(led.stats.realizedPnl).toBeCloseTo(40, 12);
    expect(led.account.equity).toBeCloseTo(1040, 12);
    expect(led.markers.at(-1)).toMatchObject({ label: '平仓' });
  });

  it('fraction 1 is a full close', () => {
    const led = unwrap(marketClose(openedLong(), bar({ close: 120 }), 1));
    expect(led.position).toBeNull();
    expect(led.stats.trades).toBe(1);
    expect(led.markers.at(-1)).toMatchObject({ label: '平仓' });
  });

  it('decides the win on cyclePnl - cycleFees: gross profit eaten by fees is a loss', () => {
    const opened = unwrap(marketOpen(emptyLedger(1000, 0.01), bar({ close: 100 }), 'long', 20, 10));
    const led = unwrap(marketClose(opened, bar({ close: 100.5 })));
    expect(led.stats.trades).toBe(1);
    expect(led.stats.realizedPnl).toBeCloseTo(1, 12);
    // fees 2 (open) + 2.01 (close) swallow the +1 gross
    expect(led.stats.fees).toBeCloseTo(4.01, 12);
    expect(led.stats.wins).toBe(0);
    expect(led.account.equity).toBeCloseTo(1000 - 3.01, 12);
  });

  it('counts a win once the gross profit clears the cycle fees', () => {
    const opened = unwrap(marketOpen(emptyLedger(1000, 0.01), bar({ close: 100 }), 'long', 20, 10));
    const led = unwrap(marketClose(opened, bar({ close: 110 })));
    expect(led.stats.trades).toBe(1);
    expect(led.stats.wins).toBe(1);
  });

  it('a partial-close fee still counts against the cycle', () => {
    const opened = unwrap(marketOpen(emptyLedger(1000, 0.01), bar({ close: 100 }), 'long', 20, 10));
    const partial = unwrap(marketClose(opened, bar({ close: 100.5 }), 0.5));
    expect(partial.position?.cycleFees).toBeCloseTo(2 + 1.005, 12);
    const led = unwrap(marketClose(partial, bar({ close: 100.5 })));
    expect(led.stats.wins).toBe(0);
  });

  it('rejects fraction 0, a negative fraction and a fraction above 1', () => {
    expect(errMessage(marketClose(openedLong(), bar({ close: 100 }), 0))).toBe('平仓比例须大于 0');
    expect(errMessage(marketClose(openedLong(), bar({ close: 100 }), -0.5))).toBe('平仓比例须大于 0');
    expect(errMessage(marketClose(openedLong(), bar({ close: 100 }), 1.5))).toBe('平仓比例不能超过 100%');
  });

  it('rejects without a position', () => {
    expect(errMessage(marketClose(emptyLedger(100, 0), bar({ close: 100 })))).toBe('当前无仓位');
    expect(errMessage(marketClose(emptyLedger(100, 0), bar({ close: 100 }), 0.5))).toBe('当前无仓位');
  });

  it('short: a full close realizes the inverse pnl', () => {
    const led = unwrap(marketClose(openedShort(), bar({ close: 80 })));
    expect(led.stats.realizedPnl).toBeCloseTo(40, 12);
    expect(led.stats.trades).toBe(1);
    expect(led.stats.wins).toBe(1);
    expect(led.account.equity).toBeCloseTo(1040, 12);
  });

  it('short: a partial close leaves the entry price alone', () => {
    const led = unwrap(marketClose(openedShort(), bar({ close: 80 }), 0.25));
    expect(led.position?.qty).toBeCloseTo(1.5, 12);
    expect(led.position?.entryPrice).toBe(100);
    expect(led.position?.cyclePnl).toBeCloseTo(10, 12);
    expect(led.stats.trades).toBe(0);
    expect(led.markers.at(-1)).toMatchObject({ label: '减仓' });
  });
});

describe('resolveBarExit: the level nearest the entry fires first', () => {
  it('long: a stop tighter than the 强平价 fires first and prevents the 爆仓', () => {
    const led = unwrap(updateStops(fullSize('long'), bar({ close: 100 }), 95));
    const exit = resolveBarExit(led, bar({ time: 2, open: 99, high: 99, low: 88, close: 89 }))!;
    expect(exit).toMatchObject({ reason: '止损', liquidation: false });
    expect(exit.price).toBeCloseTo(95, 12);
  });

  it('long: a stop looser than the 强平价 never executes — 强平 comes first', () => {
    const led = unwrap(updateStops(fullSize('long'), bar({ close: 100 }), 85));
    const exit = resolveBarExit(led, bar({ time: 2, open: 99, high: 99, low: 80, close: 82 }))!;
    expect(exit).toMatchObject({ reason: '强平', liquidation: true });
    expect(exit.price).toBeCloseTo(LONG_LIQ, 4);
  });

  it('short: a stop tighter than the 强平价 fires first and prevents the 爆仓', () => {
    const led = unwrap(updateStops(fullSize('short'), bar({ close: 100 }), 105));
    const exit = resolveBarExit(led, bar({ time: 2, open: 101, high: 115, low: 100, close: 114 }))!;
    expect(exit).toMatchObject({ reason: '止损', liquidation: false });
    expect(exit.price).toBeCloseTo(105, 12);
  });

  it('short: a stop looser than the 强平价 never executes', () => {
    const led = unwrap(updateStops(fullSize('short'), bar({ close: 100 }), 115));
    const exit = resolveBarExit(led, bar({ time: 2, open: 101, high: 120, low: 100, close: 118 }))!;
    expect(exit).toMatchObject({ reason: '强平', liquidation: true });
    expect(exit.price).toBeCloseTo(SHORT_LIQ, 4);
  });

  it('returns null without a position and when the bar touches nothing', () => {
    expect(resolveBarExit(emptyLedger(1000, 0), bar({ close: 100, high: 200, low: 1 }))).toBeNull();
    const led = unwrap(updateStops(openedLong(), bar({ close: 100 }), 95, 110));
    expect(resolveBarExit(led, bar({ open: 100, high: 109, low: 96, close: 105 }))).toBeNull();
  });
});

describe('gap fills', () => {
  it('long: a bar that opened below the stop fills at the open, never at the untraded level', () => {
    const led = unwrap(updateStops(openedLong(), bar({ close: 100 }), 95, 110));
    const b = bar({ open: 90, high: 92, low: 88, close: 91 });
    const exit = resolveBarExit(led, b)!;
    expect(exit).toMatchObject({ reason: '止损', price: 90 });
    expect(exit.price).toBeGreaterThanOrEqual(b.low);
    expect(exit.price).toBeLessThanOrEqual(b.high);
  });

  it('long: an intrabar touch fills at the level, clamped inside the bar', () => {
    const led = unwrap(updateStops(openedLong(), bar({ close: 100 }), 95, 110));
    const b = bar({ open: 99, high: 101, low: 90, close: 94 });
    const exit = resolveBarExit(led, b)!;
    expect(exit).toMatchObject({ reason: '止损', price: 95 });
    expect(exit.price).toBeGreaterThanOrEqual(b.low);
    expect(exit.price).toBeLessThanOrEqual(b.high);
  });

  it('long: the adverse level beats the take-profit on an intrabar tie', () => {
    const led = unwrap(updateStops(openedLong(), bar({ close: 100 }), 95, 110));
    expect(resolveBarExit(led, bar({ open: 100, high: 115, low: 90, close: 112 }))).toMatchObject({
      reason: '止损',
      price: 95,
    });
  });

  it('long: a bar that OPENED through the take-profit fills the take-profit', () => {
    const led = unwrap(updateStops(openedLong(), bar({ close: 100 }), 95, 110));
    // the same bar also traded through the stop, but the open already cleared the TP
    expect(resolveBarExit(led, bar({ open: 115, high: 116, low: 90, close: 91 }))).toMatchObject({
      reason: '止盈',
      price: 115,
    });
  });

  it('short: a bar that opened above the stop fills at the open', () => {
    const led = unwrap(updateStops(openedShort(), bar({ close: 100 }), 105, 90));
    expect(resolveBarExit(led, bar({ open: 112, high: 114, low: 108, close: 110 }))).toMatchObject({
      reason: '止损',
      price: 112,
    });
  });

  it('short: an intrabar touch fills at the level', () => {
    const led = unwrap(updateStops(openedShort(), bar({ close: 100 }), 105, 90));
    expect(resolveBarExit(led, bar({ open: 101, high: 108, low: 99, close: 106 }))).toMatchObject({
      reason: '止损',
      price: 105,
    });
  });

  it('short: the adverse level beats the take-profit on an intrabar tie', () => {
    const led = unwrap(updateStops(openedShort(), bar({ close: 100 }), 105, 90));
    expect(resolveBarExit(led, bar({ open: 100, high: 108, low: 85, close: 88 }))).toMatchObject({
      reason: '止损',
      price: 105,
    });
  });

  it('short: a bar that OPENED through the take-profit fills the take-profit', () => {
    const led = unwrap(updateStops(openedShort(), bar({ close: 100 }), 105, 90));
    expect(resolveBarExit(led, bar({ open: 85, high: 108, low: 84, close: 86 }))).toMatchObject({
      reason: '止盈',
      price: 85,
    });
  });
});

describe('applyBarExits', () => {
  it('is a no-op without a position or without levels', () => {
    const flat = emptyLedger(1000, 0);
    const wide = bar({ open: 100, high: 200, low: 1, close: 150 });
    expect(applyBarExits(flat, wide).ledger).toBe(flat);
    expect(applyBarExits(flat, wide).liquidated).toBe(false);
    const led = openedLong();
    expect(applyBarExits(led, wide).ledger).toBe(led);
    expect(applyBarExits(led, wide).liquidated).toBe(false);
  });

  it('an ordinary stop exit is not a 爆仓 and leaves the equity standing', () => {
    const led = unwrap(updateStops(openedLong(), bar({ close: 100 }), 95));
    const out = applyBarExits(led, bar({ time: 1_700_000_600, open: 99, high: 99, low: 90, close: 94 }));
    expect(out.liquidated).toBe(false);
    expect(out.ledger.position).toBeNull();
    expect(out.ledger.account.equity).toBeCloseTo(1000 + (95 - 100) * 2, 12);
    expect(out.ledger.stats.trades).toBe(1);
    expect(out.ledger.stats.wins).toBe(0);
    expect(out.ledger.markers.at(-1)).toMatchObject({ label: '止损', time: 1_700_000_600 });
  });

  it('a take-profit exit is not a 爆仓 either', () => {
    const led = unwrap(updateStops(openedLong(), bar({ close: 100 }), null, 110));
    const out = applyBarExits(led, bar({ open: 101, high: 112, low: 99, close: 108 }));
    expect(out.liquidated).toBe(false);
    expect(out.ledger.position).toBeNull();
    expect(out.ledger.account.equity).toBeCloseTo(1020, 12);
    expect(out.ledger.stats.wins).toBe(1);
    expect(out.ledger.markers.at(-1)).toMatchObject({ label: '止盈' });
  });

  it('short 爆仓 zeroes the equity and reports liquidated', () => {
    const out = applyBarExits(fullSize('short'), bar({ time: 2, open: 105, high: 115, low: 104, close: 114 }));
    expect(out.liquidated).toBe(true);
    expect(out.ledger.position).toBeNull();
    expect(out.ledger.account.equity).toBe(0);
    expect(out.ledger.stats.trades).toBe(1);
    expect(out.ledger.markers.at(-1)).toMatchObject({ label: '强平' });
  });
});

describe('buildPostmortem', () => {
  it('long: measures the adverse excursion from the entry across the supplied bars', () => {
    const pm = buildPostmortem(fullSize('long').position!, 1000, [
      bar({ open: 100, high: 101, low: 95, close: 96 }),
      bar({ open: 96, high: 97, low: 70, close: 72 }),
      bar({ open: 72, high: 90, low: 71, close: 88 }),
    ]);
    expect(pm.direction).toBe('long');
    expect(pm.entryPrice).toBe(100);
    expect(pm.adverseExcursion).toBeCloseTo(0.3, 12);
    expect(pm.usedMargin).toBeCloseTo(1000, 12);
  });

  it('short: the adverse excursion is the highest high, and the max survivable size inverts it', () => {
    const worstBar = bar({ open: 104, high: 130, low: 103, close: 128 });
    const pm = buildPostmortem(fullSize('short').position!, 1000, [
      bar({ open: 100, high: 105, low: 99, close: 104 }),
      worstBar,
    ]);
    expect(pm.direction).toBe('short');
    expect(pm.adverseExcursion).toBeCloseTo(0.3, 12);
    // N <= entry·B / (worst·(1 + mmr) − entry) = 100 x 1000 / 30.65, then / leverage
    expect(pm.maxSurvivableMargin!).toBeCloseTo(326.2643, 4);
    expect(pm.maxSurvivableFraction!).toBeCloseTo(pm.maxSurvivableMargin! / 1000, 12);

    // re-open at exactly that size: the 强平价 lands on the worst high, so a hair under survives
    const atLimit = unwrap(
      marketOpen(emptyLedger(1000, 0), bar({ close: 100 }), 'short', pm.maxSurvivableMargin!, 10),
    );
    expect(liquidationPrice(atLimit.account, atLimit.position)!).toBeCloseTo(130, 9);
    expect(applyBarExits(atLimit, worstBar).liquidated).toBe(true);
    const under = unwrap(
      marketOpen(emptyLedger(1000, 0), bar({ close: 100 }), 'short', pm.maxSurvivableMargin! * 0.99, 10),
    );
    expect(applyBarExits(under, worstBar).liquidated).toBe(false);
  });

  it('reports no max survivable size when no size could ever be liquidated', () => {
    // price never trades back to the entry: the liquidation identity has no positive solution
    const pm = buildPostmortem(fullSize('long').position!, 1000, [
      bar({ open: 106, high: 120, low: 105, close: 118 }),
    ]);
    expect(pm.adverseExcursion).toBe(0);
    expect(pm.maxSurvivableMargin).toBeNull();
    expect(pm.maxSurvivableFraction).toBeNull();
    expect(pm.usedMargin).toBeCloseTo(1000, 12);
  });

  it('an empty bar list yields zero excursion in both directions', () => {
    expect(buildPostmortem(fullSize('long').position!, 1000, []).adverseExcursion).toBe(0);
    expect(buildPostmortem(fullSize('short').position!, 1000, []).adverseExcursion).toBe(0);
  });

  it('usedMargin follows the committed margin, not the notional', () => {
    const led = unwrap(marketOpen(emptyLedger(1000, 0), bar({ close: 100 }), 'long', 250, 10));
    const pm = buildPostmortem(led.position!, 1000, [bar({ open: 100, high: 100, low: 80, close: 82 })]);
    expect(pm.usedMargin).toBeCloseTo(250, 12);
    expect(pm.adverseExcursion).toBeCloseTo(0.2, 12);
  });
});
