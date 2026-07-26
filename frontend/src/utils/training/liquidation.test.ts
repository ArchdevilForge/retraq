import { describe, expect, it } from 'vitest';
import {
  applyBarExits,
  buildPostmortem,
  emptyLedger,
  liquidationPrice,
  marketClose,
  marketOpen,
  maxOpenableMargin,
  replayExits,
} from './sim';
import type { Kline } from '../../services/api';

const bar = (o: Partial<Kline>): Kline => ({ time: 1, open: 100, high: 100, low: 100, close: 100, volume: 0, ...o });

function opened(equity: number, margin: number, lev: number) {
  const l = emptyLedger(equity, 0);
  const r = marketOpen(l, bar({ close: 100 }), 'long', margin, lev);
  if (!r.ok) throw new Error(r.message);
  return r.value;
}

describe('cross-margin liquidation', () => {
  it('cross margin: liq distance tracks notional/equity, not leverage', () => {
    for (const [margin, lev, expected] of [[250, 10, 0.397], [500, 10, 0.198], [1000, 10, 0.0995], [1000, 20, 0.0498]] as const) {
      const led = opened(1000, margin, lev);
      const liq = liquidationPrice(led.account, led.position)!;
      expect((100 - liq) / 100).toBeCloseTo(expected, 2);
    }
  });

  it('满仓 at leverage L leaves ~1/L of room, and quarter size quadruples it', () => {
    const full = liquidationPrice(opened(1000, 1000, 10).account, opened(1000, 1000, 10).position)!;
    const quarter = liquidationPrice(opened(1000, 250, 10).account, opened(1000, 250, 10).position)!;
    // Maintenance is charged on the MARK notional, which shrinks as price falls,
    // so the exact room is slightly wider than the equity/notional approximation.
    expect((100 - full) / 100).toBeCloseTo(0.09548, 5);
    expect((100 - quarter) / 100).toBeCloseTo(0.39698, 5);
  });

  it('a long can be unliquidatable when the balance covers the notional', () => {
    expect(liquidationPrice(opened(1000, 50, 1).account, opened(1000, 50, 1).position)).toBeNull();
  });

  it('爆仓 zeroes equity and reports liquidated', () => {
    const led = opened(1000, 1000, 10);
    const out = applyBarExits(led, bar({ time: 2, open: 95, high: 96, low: 88, close: 89 }));
    expect(out.liquidated).toBe(true);
    expect(out.ledger.account.equity).toBe(0);
    expect(out.ledger.position).toBeNull();
    expect(out.ledger.markers.at(-1)!.label).toBe('强平');
  });

  it('a stop tighter than the 强平价 fires first and prevents the 爆仓', () => {
    const base = opened(1000, 1000, 10);
    const led = { ...base, position: { ...base.position!, stopLoss: 95 } };
    const out = applyBarExits(led, bar({ time: 2, open: 99, high: 99, low: 88, close: 89 }));
    expect(out.liquidated).toBe(false);
    expect(out.ledger.markers.at(-1)!.label).toBe('止损');
  });

  it('max survivable size inverts the liquidation identity', () => {
    const led = opened(1000, 1000, 10);
    const after = [bar({ time: 2, low: 70, high: 101, open: 100, close: 71 })];
    const pm = buildPostmortem(led.position!, 1000, after);
    expect(pm.adverseExcursion).toBeCloseTo(0.30, 6);
    // re-open at exactly that size and confirm it survives the same bar
    // The supremum is exact but not attained: at that size the liq price lands ON
    // the worst low, and touching it liquidates. A hair under it survives.
    const atLimit = opened(1000, pm.maxSurvivableMargin!, 10);
    expect(liquidationPrice(atLimit.account, atLimit.position)!).toBeCloseTo(70, 6);
    expect(applyBarExits(atLimit, after[0]).liquidated).toBe(true);
    const under = opened(1000, pm.maxSurvivableMargin! * 0.99, 10);
    expect(applyBarExits(under, after[0]).liquidated).toBe(false);
    // and one notch over it definitely dies
    const over = opened(1000, pm.maxSurvivableMargin! * 1.01, 10);
    expect(applyBarExits(over, after[0]).liquidated).toBe(true);
  });
});

describe('揭晓 cannot outrun a 爆仓', () => {
  const at = (t: number, o: number, h: number, l: number, c: number): Kline => ({
    time: t, open: o, high: h, low: l, close: c, volume: 0,
  });

  it('replays the masked bars in order instead of settling at the last close', () => {
    // 满仓 10x: 强平价 90.45. Price dips to 88 mid-scenario, then fully recovers.
    const led = opened(1000, 1000, 10);
    const rest = [at(2, 100, 101, 99, 99), at(3, 99, 99, 88, 89), at(4, 89, 105, 89, 104)];
    const out = replayExits(led, rest);
    expect(out.liquidation).not.toBeNull();
    expect(out.ledger.account.equity).toBe(0);
    // Settling naively at the final close would have shown a profit instead.
    const naive = marketClose(led, rest[rest.length - 1]!);
    expect(naive.ok && naive.value.account.equity).toBeGreaterThan(1000);
  });

  it('still settles normally when nothing was breached', () => {
    const led = opened(1000, 250, 10);
    const out = replayExits(led, [at(2, 100, 102, 98, 101), at(3, 101, 103, 100, 102)]);
    expect(out.liquidation).toBeNull();
    expect(out.ledger.position).not.toBeNull();
  });

  it('满仓 is actually openable — the lesson needs the mistake to be reachable', () => {
    const l = emptyLedger(1000, 0.0005);
    const max = maxOpenableMargin(1000, 10, 0.0005);
    expect(marketOpen(l, bar({ close: 100 }), 'long', max, 10).ok).toBe(true);
    // and one notch past it is correctly refused
    const over = marketOpen(l, bar({ close: 100 }), 'long', max * 1.01, 10);
    expect(over.ok).toBe(false);
    expect(over.ok === false && over.message).toBe('保证金不足');
  });
});
