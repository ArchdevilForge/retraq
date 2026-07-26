import { describe, expect, it } from 'vitest';
import { fmtPrice, isSyntheticFills } from './fills';
import type { Trade, TradeFill } from '../services/api';

function trade(over: Partial<Trade> = {}): Trade {
  return {
    id: 1,
    symbol: 'BTC-USDT',
    direction: 'long',
    leverage: 1,
    entry_price: 100,
    exit_price: 110,
    profit: 10,
    profit_rate: 0.1,
    margin: 100,
    entry_time: 1_700_000_000_000,
    exit_time: 1_700_000_600_000,
    ...over,
  };
}

function fill(over: Partial<TradeFill> = {}): TradeFill {
  return { id: 1, side: 'BUY', price: 100, qty: 1, time_ms: 1_700_000_000_000, realized_pnl: 0, ...over };
}

describe('isSyntheticFills', () => {
  it('flags the importer-generated open/close placeholder pair', () => {
    const fills = [fill({ id: 1, side: 'BUY' }), fill({ id: 2, side: 'SELL', price: 110 })];
    expect(isSyntheticFills(fills, trade())).toBe(true);
  });

  it('flags a single placeholder fill on an open trade', () => {
    expect(isSyntheticFills([fill()], trade({ exit_price: null, exit_time: null }))).toBe(true);
  });

  it('is a whole-trade decision, not per fill', () => {
    // One real qty in the pair disqualifies BOTH fills; a per-fill predicate would
    // disagree with the chart and show two different USDT amounts for the same trade.
    const mixed = [fill({ id: 1, qty: 1 }), fill({ id: 2, qty: 0.35 })];
    expect(isSyntheticFills(mixed, trade())).toBe(false);
  });

  it('rejects real fill sets and trades without margin', () => {
    const real = [fill({ id: 1, qty: 0.2 }), fill({ id: 2, qty: 0.2 }), fill({ id: 3, qty: 0.2 })];
    expect(isSyntheticFills(real, trade())).toBe(false);
    expect(isSyntheticFills([fill()], trade({ margin: null }))).toBe(false);
    expect(isSyntheticFills([], trade())).toBe(false);
  });
});

describe('fmtPrice', () => {
  it('scales precision with magnitude', () => {
    expect(fmtPrice(64231.5)).toBe('64231.50');
    expect(fmtPrice(3.14159)).toBe('3.1416');
  });

  it('keeps sub-cent symbols readable instead of rendering 0.00', () => {
    expect(fmtPrice(0.00001234)).toBe('0.00001234');
    expect(Number(fmtPrice(0.00001234))).toBeCloseTo(0.00001234, 12);
  });

  it('never falls back to scientific notation', () => {
    // toPrecision would emit '1.234e-7' here, which is unreadable in a price column.
    for (const p of [1.234e-7, 9.9e-7, 5e-8, 0.000001]) {
      expect(fmtPrice(p)).not.toMatch(/e/i);
    }
  });

  it('guards non-finite input', () => {
    expect(fmtPrice(Number.NaN)).toBe('—');
    expect(fmtPrice(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
