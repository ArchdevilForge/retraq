import { describe, expect, it } from 'vitest';
import type { Kline } from '../../services/api';
import type { Ledger, SimResult } from './sim';
import {
  applyStopsOnBar,
  availableEquity,
  baseToUsdt,
  emptyLedger,
  marketAdd,
  marketClose,
  marketOpen,
  requiredMargin,
  unrealizedPnl,
  updateStops,
  usdtToBase,
  usedMargin,
} from './sim';
import type { SimPosition } from './types';
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

/** Long 20 USDT @ 100 (qty 0.2), lev 10, fee-free unless feeRate given. */
function openedLong(feeRate = 0, startEquity = 1000): Ledger {
  return unwrap(marketOpen(emptyLedger(startEquity, feeRate), bar({ close: 100 }), 'long', 20, 10));
}

function openedShort(feeRate = 0, startEquity = 1000): Ledger {
  return unwrap(marketOpen(emptyLedger(startEquity, feeRate), bar({ close: 100 }), 'short', 20, 10));
}

describe('usdtToBase / baseToUsdt', () => {
  it('converts notional to base qty and back', () => {
    expect(usdtToBase(20, 100)).toBeCloseTo(0.2, 12);
    expect(baseToUsdt(0.2, 100)).toBeCloseTo(20, 12);
    expect(baseToUsdt(usdtToBase(37.5, 250), 250)).toBeCloseTo(37.5, 12);
  });

  it('returns 0 for non-positive price or notional', () => {
    expect(usdtToBase(20, 0)).toBe(0);
    expect(usdtToBase(20, -100)).toBe(0);
    expect(usdtToBase(0, 100)).toBe(0);
    expect(usdtToBase(-5, 100)).toBe(0);
  });

  it('baseToUsdt is unsigned', () => {
    expect(baseToUsdt(-0.2, 100)).toBe(20);
  });
});

describe('margin / pnl helpers', () => {
  it('requiredMargin divides notional by clamped leverage', () => {
    expect(requiredMargin(100, 1, 10)).toBeCloseTo(10, 12);
    expect(requiredMargin(100, 1, 1)).toBeCloseTo(100, 12);
  });

  it('clamps leverage into [1, MAX_LEVERAGE]', () => {
    expect(requiredMargin(100, 1, 1000)).toBeCloseTo(100 / MAX_LEVERAGE, 12);
    expect(requiredMargin(100, 1, 0)).toBeCloseTo(100, 12);
    expect(requiredMargin(100, 1, -50)).toBeCloseTo(100, 12);
  });

  it('unrealizedPnl signs by direction', () => {
    const long: SimPosition = {
      direction: 'long',
      qty: 0.2,
      entryPrice: 100,
      leverage: 10,
      stopLoss: null,
      takeProfit: null,
      cyclePnl: 0,
      cycleFees: 0,
    };
    const short: SimPosition = { ...long, direction: 'short' };
    expect(unrealizedPnl(long, 120)).toBeCloseTo(4, 12);
    expect(unrealizedPnl(long, 80)).toBeCloseTo(-4, 12);
    expect(unrealizedPnl(short, 120)).toBeCloseTo(-4, 12);
    expect(unrealizedPnl(short, 80)).toBeCloseTo(4, 12);
  });

  it('usedMargin is 0 without a position and uses the entry price otherwise', () => {
    expect(usedMargin(null)).toBe(0);
    const pos = openedLong().position;
    expect(pos).not.toBeNull();
    expect(usedMargin(pos)).toBeCloseTo(2, 12);
  });

  it('availableEquity = equity + unrealized - usedMargin', () => {
    const led = openedLong();
    expect(availableEquity(led.account, led.position, 120)).toBeCloseTo(1000 + 4 - 2, 12);
    expect(availableEquity(led.account, null, 120)).toBeCloseTo(1000, 12);
  });
});

describe('marketOpen', () => {
  it('deducts the fee, seeds stats.fees and sets cycleFees', () => {
    const led = unwrap(marketOpen(emptyLedger(100, 0.001), bar({ close: 100 }), 'long', 20, 10));
    expect(led.account.equity).toBeCloseTo(100 - 0.02, 12);
    expect(led.stats.fees).toBeCloseTo(0.02, 12);
    expect(led.position?.cycleFees).toBeCloseTo(0.02, 12);
    expect(led.position?.cyclePnl).toBe(0);
    expect(led.position?.qty).toBeCloseTo(0.2, 12);
    expect(led.position?.entryPrice).toBe(100);
    expect(led.markers).toHaveLength(1);
    expect(led.markers[0]).toMatchObject({ side: 'entry', direction: 'long', label: '开仓', price: 100 });
    expect(led.stats.trades).toBe(0);
  });

  it('rejects an underfunded open with 保证金不足', () => {
    const r = marketOpen(emptyLedger(1, 0.001), bar({ close: 100 }), 'long', 100, 1);
    expect(errMessage(r)).toBe('保证金不足');
  });

  it('counts the fee against the margin budget at the boundary', () => {
    // margin 2 + fee 0.02 = 2.02 of equity
    expect(marketOpen(emptyLedger(2.02, 0.001), bar({ close: 100 }), 'long', 20, 10).ok).toBe(true);
    expect(
      errMessage(marketOpen(emptyLedger(2.01, 0.001), bar({ close: 100 }), 'long', 20, 10)),
    ).toBe('保证金不足');
  });

  it('rejects a same-direction open against an existing position', () => {
    expect(errMessage(marketOpen(openedLong(), bar({ close: 100 }), 'long', 20, 10))).toBe(
      '已有仓位，请使用加仓',
    );
  });

  it('rejects a reverse-direction open with 反向须先平仓', () => {
    expect(errMessage(marketOpen(openedLong(), bar({ close: 100 }), 'short', 20, 10))).toBe(
      '反向须先平仓',
    );
    expect(errMessage(marketOpen(openedShort(), bar({ close: 100 }), 'long', 20, 10))).toBe(
      '反向须先平仓',
    );
  });

  it('rejects a non-positive notional', () => {
    expect(errMessage(marketOpen(emptyLedger(100, 0), bar({ close: 100 }), 'long', 0, 10))).toBe(
      '金额须大于 0',
    );
  });

  it('clamps the stored leverage to MAX_LEVERAGE', () => {
    const led = unwrap(marketOpen(emptyLedger(1000, 0), bar({ close: 100 }), 'long', 20, 1000));
    expect(led.position?.leverage).toBe(MAX_LEVERAGE);
    expect(usedMargin(led.position)).toBeCloseTo(20 / MAX_LEVERAGE, 12);
  });
});

describe('wrong-side stop levels are rejected where they are SET', () => {
  it('rejects a short whose stop-loss sits below the mark', () => {
    // The exploit: short @100 with sl 95 would "stop out" into profit.
    const r = marketOpen(emptyLedger(1000, 0), bar({ close: 100 }), 'short', 20, 10, 95);
    expect(errMessage(r)).toBe('止损价须高于现价');
  });

  it('rejects a long whose stop-loss sits above the mark', () => {
    const r = marketOpen(emptyLedger(1000, 0), bar({ close: 100 }), 'long', 20, 10, 105);
    expect(errMessage(r)).toBe('止损价须低于现价');
  });

  it('rejects wrong-side take-profit levels', () => {
    expect(
      errMessage(marketOpen(emptyLedger(1000, 0), bar({ close: 100 }), 'long', 20, 10, null, 95)),
    ).toBe('止盈价须高于现价');
    expect(
      errMessage(marketOpen(emptyLedger(1000, 0), bar({ close: 100 }), 'short', 20, 10, null, 105)),
    ).toBe('止盈价须低于现价');
  });

  it('rejects a level equal to the mark', () => {
    expect(
      errMessage(marketOpen(emptyLedger(1000, 0), bar({ close: 100 }), 'long', 20, 10, 100)),
    ).toBe('止损价须低于现价');
  });

  it('updateStops refuses to move a stop to the wrong side and leaves the position untouched', () => {
    const led = openedShort();
    const r = updateStops(led, bar({ close: 100 }), 95);
    expect(errMessage(r)).toBe('止损价须高于现价');
    expect(led.position?.stopLoss).toBeNull();

    const r2 = updateStops(openedLong(), bar({ close: 100 }), 105);
    expect(errMessage(r2)).toBe('止损价须低于现价');
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
    expect(errMessage(updateStops(emptyLedger(100, 0), bar({ close: 100 }), 95))).toBe('当前无仓位');
  });
});

describe('marketAdd', () => {
  it('computes the weighted-average entry price', () => {
    const led = unwrap(marketAdd(openedLong(), bar({ close: 150 }), 30));
    // 0.2 @ 100 + 0.2 @ 150 -> 0.4 @ 125
    expect(led.position?.qty).toBeCloseTo(0.4, 12);
    expect(led.position?.entryPrice).toBeCloseTo(125, 12);
    expect(led.markers.at(-1)).toMatchObject({ side: 'entry', label: '加仓', price: 150 });
  });

  it('accrues the add fee into cycleFees and stats.fees', () => {
    const led = unwrap(marketAdd(openedLong(0.001), bar({ close: 100 }), 20));
    expect(led.stats.fees).toBeCloseTo(0.04, 12);
    expect(led.position?.cycleFees).toBeCloseTo(0.04, 12);
    expect(led.account.equity).toBeCloseTo(1000 - 0.04, 12);
  });

  it('is gated by availableEquity, not by raw equity', () => {
    // equity 5, open 20 @100 x10 -> usedMargin 2, free 3. Adding 40 needs margin 4 > 3.
    const led = unwrap(marketOpen(emptyLedger(5, 0), bar({ close: 100 }), 'long', 20, 10));
    expect(led.account.equity).toBe(5);
    expect(errMessage(marketAdd(led, bar({ close: 100 }), 40))).toBe('保证金不足');
    expect(marketAdd(led, bar({ close: 100 }), 29).ok).toBe(true);
  });

  it('lets unrealized profit widen the add budget', () => {
    const led = unwrap(marketOpen(emptyLedger(5, 0), bar({ close: 100 }), 'long', 20, 10));
    // at 200 the position is +20 unrealized: free = 5 + 20 - 2 = 23
    expect(marketAdd(led, bar({ close: 200 }), 220).ok).toBe(true);
    expect(errMessage(marketAdd(led, bar({ close: 200 }), 240))).toBe('保证金不足');
  });

  it('rejects without a position and for a non-positive notional', () => {
    expect(errMessage(marketAdd(emptyLedger(100, 0), bar({ close: 100 }), 10))).toBe('无仓位可加');
    expect(errMessage(marketAdd(openedLong(), bar({ close: 100 }), 0))).toBe('金额须大于 0');
  });
});

describe('marketClose', () => {
  it('partial close keeps the position open, labels 减仓 and does not count a trade', () => {
    const led = unwrap(marketClose(openedLong(), bar({ close: 120 }), 12));
    expect(led.position).not.toBeNull();
    expect(led.position?.qty).toBeCloseTo(0.1, 12);
    expect(led.position?.entryPrice).toBe(100);
    expect(led.position?.cyclePnl).toBeCloseTo(2, 12);
    expect(led.stats.trades).toBe(0);
    expect(led.stats.wins).toBe(0);
    expect(led.stats.realizedPnl).toBeCloseTo(2, 12);
    expect(led.markers.at(-1)).toMatchObject({ side: 'exit', direction: 'long', label: '减仓' });
  });

  it('full close counts one trade and one win when the cycle is net positive', () => {
    const partial = unwrap(marketClose(openedLong(), bar({ close: 120 }), 12));
    const led = unwrap(marketClose(partial, bar({ close: 120 })));
    expect(led.position).toBeNull();
    expect(led.stats.trades).toBe(1);
    expect(led.stats.wins).toBe(1);
    expect(led.stats.realizedPnl).toBeCloseTo(4, 12);
    expect(led.markers.at(-1)).toMatchObject({ label: '平仓' });
    expect(led.account.equity).toBeCloseTo(1004, 12);
  });

  it('decides the win on cyclePnl - cycleFees: gross profit eaten by fees is a loss', () => {
    const opened = unwrap(marketOpen(emptyLedger(1000, 0.01), bar({ close: 100 }), 'long', 20, 10));
    const led = unwrap(marketClose(opened, bar({ close: 100.5 })));
    expect(led.stats.trades).toBe(1);
    // gross +0.1, fees 0.2 + 0.201 = 0.401 -> net loss
    expect(led.stats.realizedPnl).toBeCloseTo(0.1, 12);
    expect(led.stats.fees).toBeCloseTo(0.401, 12);
    expect(led.stats.wins).toBe(0);
    expect(led.account.equity).toBeLessThan(1000);
  });

  it('counts a win once the gross profit clears the cycle fees', () => {
    const opened = unwrap(marketOpen(emptyLedger(1000, 0.01), bar({ close: 100 }), 'long', 20, 10));
    const led = unwrap(marketClose(opened, bar({ close: 110 })));
    expect(led.stats.trades).toBe(1);
    expect(led.stats.wins).toBe(1);
  });

  it('a partial that consumes the whole position is a full close labelled 平仓', () => {
    const led = unwrap(marketClose(openedLong(), bar({ close: 100 }), 20));
    expect(led.position).toBeNull();
    expect(led.stats.trades).toBe(1);
    expect(led.markers.at(-1)).toMatchObject({ label: '平仓' });
  });

  it('an oversized partial notional is clamped to the position, not rejected', () => {
    const led = unwrap(marketClose(openedLong(), bar({ close: 100 }), 999));
    expect(led.position).toBeNull();
    expect(led.stats.trades).toBe(1);
  });

  it('rejects without a position and for a non-positive notional', () => {
    expect(errMessage(marketClose(emptyLedger(100, 0), bar({ close: 100 })))).toBe('当前无仓位');
    expect(errMessage(marketClose(openedLong(), bar({ close: 100 }), 0))).toBe('金额须大于 0');
  });

  it('short full close realizes the inverse pnl', () => {
    const led = unwrap(marketClose(openedShort(), bar({ close: 80 })));
    expect(led.stats.realizedPnl).toBeCloseTo(4, 12);
    expect(led.stats.wins).toBe(1);
    expect(led.account.equity).toBeCloseTo(1004, 12);
  });
});

describe('applyStopsOnBar', () => {
  it('is a no-op without a position or without levels', () => {
    const flat = emptyLedger(1000, 0);
    expect(applyStopsOnBar(flat, bar({ close: 100, high: 200, low: 1 }))).toBe(flat);
    const led = openedLong();
    expect(applyStopsOnBar(led, bar({ close: 100, high: 200, low: 1 }))).toBe(led);
  });

  it('leaves the position open when the bar touches neither level', () => {
    const led = unwrap(updateStops(openedLong(), bar({ close: 100 }), 95, 110));
    const after = applyStopsOnBar(led, bar({ open: 100, high: 109, low: 96, close: 105 }));
    expect(after.position).not.toBeNull();
    expect(after.stats.trades).toBe(0);
  });

  it('long: a bar hitting BOTH sl and tp from inside resolves SL-first', () => {
    const led = unwrap(updateStops(openedLong(), bar({ close: 100 }), 95, 110));
    const after = applyStopsOnBar(led, bar({ open: 100, high: 115, low: 90, close: 112 }));
    expect(after.position).toBeNull();
    expect(after.markers.at(-1)).toMatchObject({ label: '止损', price: 95 });
    expect(after.stats.realizedPnl).toBeCloseTo((95 - 100) * 0.2, 12);
    expect(after.stats.wins).toBe(0);
    expect(after.stats.trades).toBe(1);
  });

  it('short: a bar hitting BOTH sl and tp from inside resolves SL-first', () => {
    const led = unwrap(updateStops(openedShort(), bar({ close: 100 }), 105, 90));
    const after = applyStopsOnBar(led, bar({ open: 100, high: 110, low: 85, close: 88 }));
    expect(after.position).toBeNull();
    expect(after.markers.at(-1)).toMatchObject({ label: '止损', price: 105 });
    expect(after.stats.realizedPnl).toBeCloseTo((100 - 105) * 0.2, 12);
    expect(after.stats.trades).toBe(1);
  });

  it('long: a gap down through the SL fills at the open, not at the untraded level', () => {
    const led = unwrap(updateStops(openedLong(), bar({ close: 100 }), 95, 110));
    const after = applyStopsOnBar(led, bar({ open: 90, high: 92, low: 88, close: 91 }));
    expect(after.position).toBeNull();
    expect(after.markers.at(-1)).toMatchObject({ label: '止损', price: 90 });
    expect(after.stats.realizedPnl).toBeCloseTo((90 - 100) * 0.2, 12);
  });

  it('long: a gap up through the TP fills at the open', () => {
    const led = unwrap(updateStops(openedLong(), bar({ close: 100 }), 95, 110));
    const after = applyStopsOnBar(led, bar({ open: 115, high: 116, low: 114, close: 116 }));
    expect(after.position).toBeNull();
    expect(after.markers.at(-1)).toMatchObject({ label: '止盈', price: 115 });
    expect(after.stats.realizedPnl).toBeCloseTo((115 - 100) * 0.2, 12);
    expect(after.stats.wins).toBe(1);
  });

  it('short: a gap up through the SL fills at the open', () => {
    const led = unwrap(updateStops(openedShort(), bar({ close: 100 }), 105, 90));
    const after = applyStopsOnBar(led, bar({ open: 112, high: 114, low: 108, close: 110 }));
    expect(after.position).toBeNull();
    expect(after.markers.at(-1)).toMatchObject({ label: '止损', price: 112 });
    expect(after.stats.realizedPnl).toBeCloseTo((100 - 112) * 0.2, 12);
  });

  it('short: a gap down through the TP fills at the open', () => {
    const led = unwrap(updateStops(openedShort(), bar({ close: 100 }), 105, 90));
    const after = applyStopsOnBar(led, bar({ open: 85, high: 86, low: 84, close: 85 }));
    expect(after.position).toBeNull();
    expect(after.markers.at(-1)).toMatchObject({ label: '止盈', price: 85 });
    expect(after.stats.realizedPnl).toBeCloseTo((100 - 85) * 0.2, 12);
  });

  it('long: an intrabar-only TP fills exactly at the level', () => {
    const led = unwrap(updateStops(openedLong(), bar({ close: 100 }), 95, 110));
    const after = applyStopsOnBar(led, bar({ open: 101, high: 112, low: 99, close: 108 }));
    expect(after.markers.at(-1)).toMatchObject({ label: '止盈', price: 110 });
  });

  it('short: an intrabar-only TP fills exactly at the level', () => {
    const led = unwrap(updateStops(openedShort(), bar({ close: 100 }), 105, 90));
    const after = applyStopsOnBar(led, bar({ open: 99, high: 101, low: 88, close: 92 }));
    expect(after.markers.at(-1)).toMatchObject({ label: '止盈', price: 90 });
  });

  it('the stop fill price never leaves the bar range', () => {
    const led = unwrap(updateStops(openedLong(), bar({ close: 100 }), 95, 110));
    const b = bar({ open: 90, high: 92, low: 88, close: 91 });
    const price = applyStopsOnBar(led, b).markers.at(-1)?.price ?? NaN;
    expect(price).toBeGreaterThanOrEqual(b.low);
    expect(price).toBeLessThanOrEqual(b.high);
  });

  it('closes the whole position and stamps the marker at the bar time', () => {
    const led = unwrap(updateStops(openedLong(), bar({ close: 100 }), 95));
    const after = applyStopsOnBar(led, bar({ time: 1_700_000_600, open: 99, high: 99, low: 90, close: 94 }));
    expect(after.position).toBeNull();
    expect(after.markers.at(-1)?.time).toBe(1_700_000_600);
  });
});
