import { describe, it, expect } from 'vitest';
import { analyzeBehavior, analyzeRisk, analyzeSymbols, analyzeTimePatterns, localDateKey } from './tradeAnalysis';
import type { Trade } from '../services/api';

// vitest.config.ts pins TZ=Asia/Shanghai (UTC+8); every epoch below is built with Date.UTC
// so the local calendar day is unambiguous regardless of the developer's machine.
const HOUR = 3_600_000;

let nextId = 1;

function makeTrade(overrides: Partial<Trade> & { entry_time: number }): Trade {
  const entry = overrides.entry_time;
  return {
    id: nextId++,
    symbol: 'BTCUSDT',
    direction: 'long',
    leverage: 1,
    entry_price: 100,
    exit_price: 110,
    profit: 0,
    profit_rate: 0,
    margin: 1000,
    exit_time: entry + HOUR,
    ...overrides,
  };
}

/** Trades laid out in order, one hour apart, starting 2024-03-05 10:00 local. */
function seriesFromProfits(profits: number[], startMs = Date.UTC(2024, 2, 5, 2, 0)): Trade[] {
  return profits.map((profit, i) => makeTrade({ entry_time: startMs + i * HOUR, profit }));
}

describe('localDateKey', () => {
  it('uses the local calendar day, not the UTC one', () => {
    // 2024-03-05 00:30 Asia/Shanghai === 2024-03-04 16:30 UTC
    expect(localDateKey(Date.UTC(2024, 2, 4, 16, 30))).toBe('2024-03-05');
    // 2024-03-05 23:30 Asia/Shanghai === 2024-03-05 15:30 UTC
    expect(localDateKey(Date.UTC(2024, 2, 5, 15, 30))).toBe('2024-03-05');
  });

  it('zero-pads month and day', () => {
    expect(localDateKey(Date.UTC(2024, 0, 1, 4, 0))).toBe('2024-01-01');
  });
});

describe('local-vs-UTC day bucketing', () => {
  // 00:30 local sits on the previous UTC day; the daily buckets must agree with the
  // local hour reported by hourlyStats, otherwise the trade is filed one day early.
  const earlyMorning = Date.UTC(2024, 2, 4, 16, 30); // 2024-03-05 00:30 local
  const sameDayLater = Date.UTC(2024, 2, 5, 2, 0); // 2024-03-05 10:00 local

  it('analyzeTimePatterns files a 00:30 local trade under its local day', () => {
    const trades = [
      makeTrade({ entry_time: earlyMorning, profit: 100 }),
      makeTrade({ entry_time: sameDayLater, profit: 50 }),
    ];
    const result = analyzeTimePatterns(trades);

    expect(result.hourlyStats[0].trades).toBe(1);
    expect(result.hourlyStats[10].trades).toBe(1);
    expect(result.dailyPnl).toEqual([{ date: '2024-03-05', pnl: 150, trades: 2 }]);
  });

  it('analyzeBehavior counts both trades in the same local day', () => {
    const trades = [
      makeTrade({ entry_time: earlyMorning, profit: 100 }),
      makeTrade({ entry_time: sameDayLater, profit: 50 }),
    ];
    const result = analyzeBehavior(trades);

    expect(result.maxTradesInDay).toBe(2);
    expect(result.avgTradesPerDay).toBe(2);
  });

  it('still separates trades that fall on different local days', () => {
    const trades = [
      makeTrade({ entry_time: Date.UTC(2024, 2, 4, 15, 30), profit: 100 }), // 03-04 23:30 local
      makeTrade({ entry_time: earlyMorning, profit: 50 }), // 03-05 00:30 local
    ];

    expect(analyzeTimePatterns(trades).dailyPnl.map((d) => d.date)).toEqual(['2024-03-04', '2024-03-05']);
    expect(analyzeBehavior(trades).maxTradesInDay).toBe(1);
  });
});

describe('analyzeRisk drawdown', () => {
  it('anchors max drawdown at starting equity, not at the first peak', () => {
    const result = analyzeRisk(seriesFromProfits([-800, 300, -200, 900]));
    expect(Math.abs(result.maxDrawdown)).toBe(800);
  });

  it('keeps the opening loss as the max drawdown even when it is fully recovered', () => {
    const result = analyzeRisk(seriesFromProfits([-800, 900]));
    expect(Math.abs(result.maxDrawdown)).toBe(800);
    expect(result.currentDrawdown).toBe(0);
  });

  it('reports the running drawdown at the end of the series', () => {
    const result = analyzeRisk(seriesFromProfits([500, -200]));
    expect(Math.abs(result.maxDrawdown)).toBe(200);
    expect(result.currentDrawdown).toBe(-200);
  });
});

describe('analyzeRisk distribution', () => {
  it('averages the two middle values for an even sample', () => {
    const result = analyzeRisk(seriesFromProfits([-100, 100]));
    expect(result.pnlDistribution.median).toBe(0);
  });

  it('takes the middle value for an odd sample', () => {
    const result = analyzeRisk(seriesFromProfits([-100, 40, 100]));
    expect(result.pnlDistribution.median).toBe(40);
  });

  it('feeds the median into the bucket boundaries', () => {
    const { buckets } = analyzeRisk(seriesFromProfits([-100, 100])).pnlDistribution;
    const totalCount = buckets.reduce((sum, b) => sum + b.count, 0);

    expect(totalCount).toBe(2);
    expect(buckets.reduce((sum, b) => sum + b.percentage, 0)).toBeCloseTo(100, 10);
    // Median 0 must be a boundary, so the loss and the win never share a bucket.
    expect(buckets.some((b) => b.range === '-100 ~ 0')).toBe(true);
  });

  // Regression: the bounds filter used to compare each candidate against the ORIGINAL
  // array's previous element instead of the last kept one, so a value below `min` could
  // follow a dropped one and render a descending bucket like '-100 ~ -926'.
  it('emits buckets whose ranges ascend', () => {
    const { buckets } = analyzeRisk(seriesFromProfits([-100, 100])).pnlDistribution;
    const bounds = buckets.map((b) => b.range.split(' ~ ').map(Number));
    for (const [lo, hi] of bounds) {
      expect(hi).toBeGreaterThanOrEqual(lo);
    }
  });
});

describe('breakeven trades count as neither win nor loss', () => {
  it('excludes them from analyzeSymbols win rate and the >= 3 significance gate', () => {
    const trades = [
      makeTrade({ entry_time: Date.UTC(2024, 2, 5, 2, 0), symbol: 'BTCUSDT', profit: 100 }),
      makeTrade({ entry_time: Date.UTC(2024, 2, 5, 3, 0), symbol: 'BTCUSDT', profit: 100 }),
      makeTrade({ entry_time: Date.UTC(2024, 2, 5, 4, 0), symbol: 'BTCUSDT', profit: 0 }),
      makeTrade({ entry_time: Date.UTC(2024, 2, 5, 5, 0), symbol: 'ETHUSDT', profit: 100 }),
      makeTrade({ entry_time: Date.UTC(2024, 2, 5, 6, 0), symbol: 'ETHUSDT', profit: 100 }),
      makeTrade({ entry_time: Date.UTC(2024, 2, 5, 7, 0), symbol: 'ETHUSDT', profit: -50 }),
    ];
    const result = analyzeSymbols(trades);
    const btc = result.symbolStats.find((s) => s.symbol === 'BTCUSDT')!;
    const eth = result.symbolStats.find((s) => s.symbol === 'ETHUSDT')!;

    expect(btc.trades).toBe(3);
    expect(btc.classifiedTrades).toBe(2);
    expect(btc.winRate).toBe(1);
    expect(eth.classifiedTrades).toBe(3);
    expect(eth.winRate).toBeCloseTo(2 / 3, 10);
    // Overall win rate is 4/5 = 0.8, so BTC is a strength and ETH is not...
    expect(btc.isStrength).toBe(true);
    expect(eth.isStrength).toBe(false);
    // ...but BTC only has 2 classified trades, so it never reaches the ranked lists.
    expect(result.bestSymbols).toEqual([]);
    expect(result.worstSymbols).toEqual(['ETHUSDT']);
  });

  it('excludes them from the direction win rates', () => {
    const trades = [
      makeTrade({ entry_time: Date.UTC(2024, 2, 5, 2, 0), direction: 'long', profit: 100 }),
      makeTrade({ entry_time: Date.UTC(2024, 2, 5, 3, 0), direction: 'long', profit: -100 }),
      makeTrade({ entry_time: Date.UTC(2024, 2, 5, 4, 0), direction: 'long', profit: 0 }),
      makeTrade({ entry_time: Date.UTC(2024, 2, 5, 5, 0), direction: 'short', profit: 100 }),
    ];
    const { directionStats } = analyzeSymbols(trades);

    expect(directionStats.longTrades).toBe(3);
    expect(directionStats.longWinRate).toBe(0.5);
    expect(directionStats.longPnl).toBe(0);
    expect(directionStats.shortWinRate).toBe(1);
    expect(directionStats.betterDirection).toBe('short');
  });

  it('excludes them from hourly and weekday win rates and gates', () => {
    // All three trades sit at 10:00 local on Tuesday 2024-03-05.
    const trades = [
      makeTrade({ entry_time: Date.UTC(2024, 2, 5, 2, 0), profit: 100 }),
      makeTrade({ entry_time: Date.UTC(2024, 2, 5, 2, 10), profit: -50 }),
      makeTrade({ entry_time: Date.UTC(2024, 2, 5, 2, 20), profit: 0 }),
    ];
    const result = analyzeTimePatterns(trades);
    const hour10 = result.hourlyStats[10];
    const tuesday = result.weekdayStats[2];

    expect(hour10.trades).toBe(3);
    expect(hour10.classifiedTrades).toBe(2);
    expect(hour10.winRate).toBe(0.5);
    expect(hour10.totalPnl).toBe(50);
    expect(hour10.avgPnl).toBeCloseTo(50 / 3, 10);

    expect(tuesday.dayName).toBe('周二');
    expect(tuesday.trades).toBe(3);
    expect(tuesday.classifiedTrades).toBe(2);
    expect(tuesday.winRate).toBe(0.5);

    // Only 2 classified trades, so the >= 3 significance gate rejects the bucket.
    expect(result.bestHour).toBeNull();
    expect(result.worstHour).toBeNull();
    expect(result.bestWeekday).toBeNull();
    expect(result.worstWeekday).toBeNull();
  });

  it('opens the >= 3 gate once three classified trades exist', () => {
    const trades = [
      makeTrade({ entry_time: Date.UTC(2024, 2, 5, 2, 0), profit: 100 }),
      makeTrade({ entry_time: Date.UTC(2024, 2, 5, 2, 10), profit: -50 }),
      makeTrade({ entry_time: Date.UTC(2024, 2, 5, 2, 20), profit: 0 }),
      makeTrade({ entry_time: Date.UTC(2024, 2, 5, 2, 30), profit: 25 }),
    ];
    const result = analyzeTimePatterns(trades);

    expect(result.hourlyStats[10].classifiedTrades).toBe(3);
    expect(result.bestHour).toBe(10);
    expect(result.worstHour).toBe(10);
    expect(result.bestWeekday).toBe('周二');
  });

  it('is transparent to the analyzeRisk streaks', () => {
    const wins = analyzeRisk(seriesFromProfits([1, 1, 0, 1]));
    expect(wins.maxConsecutiveWins).toBe(3);
    expect(wins.maxConsecutiveLosses).toBe(0);
    expect(wins.currentStreak).toEqual({ type: 'win', count: 3 });

    const losses = analyzeRisk(seriesFromProfits([-1, -1, 0, -1]));
    expect(losses.maxConsecutiveLosses).toBe(3);
    expect(losses.maxConsecutiveWins).toBe(0);
    expect(losses.currentStreak).toEqual({ type: 'loss', count: 3 });
  });
});

describe('analyzeRisk streaks', () => {
  it('tracks max wins, max losses and the current streak', () => {
    const result = analyzeRisk(seriesFromProfits([1, 1, -1, -1, -1, 1]));
    expect(result.maxConsecutiveWins).toBe(2);
    expect(result.maxConsecutiveLosses).toBe(3);
    expect(result.currentStreak).toEqual({ type: 'win', count: 1 });
  });

  it('sorts by entry_time before walking the sequence', () => {
    const [a, b, c] = seriesFromProfits([1, -1, -1]);
    const result = analyzeRisk([c, a, b]);
    expect(result.maxConsecutiveWins).toBe(1);
    expect(result.maxConsecutiveLosses).toBe(2);
    expect(result.currentStreak).toEqual({ type: 'loss', count: 2 });
  });

  it('reports no streak when every trade is breakeven', () => {
    const result = analyzeRisk(seriesFromProfits([0, 0]));
    expect(result.currentStreak).toEqual({ type: 'none', count: 0 });
  });
});

describe('empty input', () => {
  it('analyzeTimePatterns returns empty buckets without throwing', () => {
    const result = analyzeTimePatterns([]);
    expect(result.hourlyStats).toHaveLength(24);
    expect(result.hourlyStats.every((h) => h.trades === 0 && h.winRate === 0)).toBe(true);
    expect(result.weekdayStats).toHaveLength(7);
    expect(result.dailyPnl).toEqual([]);
    expect(result.bestHour).toBeNull();
    expect(result.worstWeekday).toBeNull();
    expect(result.holdingTimeStats.avgHoldingMinutes).toBe(0);
    expect(result.holdingTimeStats.optimalHoldingRange).toBe('无数据');
  });

  it('analyzeBehavior returns neutral values without throwing', () => {
    const result = analyzeBehavior([]);
    expect(result.revengeTrades).toEqual([]);
    expect(result.revengeTradeCount).toBe(0);
    expect(result.revengeTradeWinRate).toBe(0);
    expect(result.overtradingDays).toEqual([]);
    expect(result.avgTradesPerDay).toBe(0);
    expect(result.maxTradesInDay).toBe(0);
    expect(result.postWinStats.nextTradeWinRate).toBe(0);
    expect(result.postLossStats.avgNextTradePnl).toBe(0);
    expect(Number.isFinite(result.disciplineScore)).toBe(true);
  });

  it('analyzeRisk returns neutral values without throwing', () => {
    const result = analyzeRisk([]);
    expect(result.maxConsecutiveWins).toBe(0);
    expect(result.maxConsecutiveLosses).toBe(0);
    expect(result.currentStreak).toEqual({ type: 'none', count: 0 });
    expect(result.sharpeRatio).toBeNull();
    expect(result.sortinoRatio).toBeNull();
    expect(result.calmarRatio).toBeNull();
    expect(result.profitToMaxDrawdown).toBeNull();
    expect(result.maxDrawdown).toBe(0);
    expect(result.maxDrawdownPercent).toBe(0);
    expect(result.currentDrawdown).toBe(0);
    expect(result.avgDrawdownRecoveryTrades).toBe(0);
    expect(result.pnlDistribution).toEqual({ buckets: [], median: 0, stdDev: 0, skewness: 0 });
  });

  it('analyzeSymbols returns neutral values without throwing', () => {
    const result = analyzeSymbols([]);
    expect(result.symbolStats).toEqual([]);
    expect(result.bestSymbols).toEqual([]);
    expect(result.worstSymbols).toEqual([]);
    expect(result.directionStats.longTrades).toBe(0);
    expect(result.directionStats.shortWinRate).toBe(0);
    expect(result.directionStats.betterDirection).toBe('equal');
  });

  it('ignores trades whose profit is null', () => {
    const trades = [makeTrade({ entry_time: Date.UTC(2024, 2, 5, 2, 0), profit: null })];
    expect(analyzeTimePatterns(trades).dailyPnl).toEqual([]);
    expect(analyzeBehavior(trades).maxTradesInDay).toBe(0);
    expect(analyzeRisk(trades).pnlDistribution.buckets).toEqual([]);
    expect(analyzeSymbols(trades).symbolStats).toEqual([]);
  });
});
