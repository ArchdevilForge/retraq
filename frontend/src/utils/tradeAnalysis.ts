import type { Trade } from '../services/api';

// ============================================
// Types
// ============================================

export interface TimeAnalysis {
  // Hourly performance (0-23)
  hourlyStats: Array<{
    hour: number;
    trades: number;
    winRate: number;
    totalPnl: number;
    avgPnl: number;
  }>;
  // Day of week performance (0=Sunday, 6=Saturday)
  weekdayStats: Array<{
    day: number;
    dayName: string;
    trades: number;
    winRate: number;
    totalPnl: number;
  }>;
  // Monthly heatmap data
  dailyPnl: Array<{
    date: string;
    pnl: number;
    trades: number;
  }>;
  // Holding time analysis
  holdingTimeStats: {
    avgHoldingMinutes: number;
    shortTermWinRate: number; // < 30 min
    mediumTermWinRate: number; // 30min - 4h
    longTermWinRate: number; // > 4h
    optimalHoldingRange: string;
  };
  // Best/worst periods
  bestHour: number | null;
  worstHour: number | null;
  bestWeekday: string | null;
  worstWeekday: string | null;
}

export interface BehaviorAnalysis {
  // Revenge trading detection
  revengeTrades: Array<{
    trade: Trade;
    previousLoss: Trade;
    timeSinceLastLoss: number; // minutes
  }>;
  revengeTradeCount: number;
  revengeTradeWinRate: number;
  // Overtrading detection
  overtradingDays: Array<{
    date: string;
    tradeCount: number;
    pnl: number;
  }>;
  avgTradesPerDay: number;
  maxTradesInDay: number;
  // Post-win vs post-loss behavior
  postWinStats: {
    nextTradeWinRate: number;
    avgNextTradePnl: number;
    tendToOversize: boolean;
  };
  postLossStats: {
    nextTradeWinRate: number;
    avgNextTradePnl: number;
    tendToRevenge: boolean;
  };
  // Discipline score (0-100)
  disciplineScore: number;
  disciplineFactors: {
    consistentSizing: number;
    noRevengeTrades: number;
    noOvertrading: number;
    properHoldingTime: number;
  };
}

export interface RiskAnalysis {
  // Consecutive losses/wins
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  currentStreak: { type: 'win' | 'loss' | 'none'; count: number };
  // Sharpe & Sortino
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  // PnL distribution
  pnlDistribution: {
    buckets: Array<{ range: string; count: number; percentage: number }>;
    median: number;
    stdDev: number;
    skewness: number; // positive = more big wins, negative = more big losses
  };
  // Drawdown analysis
  maxDrawdown: number;
  maxDrawdownPercent: number;
  avgDrawdownRecoveryTrades: number;
  currentDrawdown: number;
  // Risk-adjusted metrics
  calmarRatio: number | null;
  profitToMaxDrawdown: number | null;
}

export interface SymbolAnalysis {
  symbolStats: Array<{
    symbol: string;
    trades: number;
    winRate: number;
    totalPnl: number;
    avgPnl: number;
    profitFactor: number;
    isStrength: boolean; // true if above average
  }>;
  directionStats: {
    longTrades: number;
    longWinRate: number;
    longPnl: number;
    shortTrades: number;
    shortWinRate: number;
    shortPnl: number;
    betterDirection: 'long' | 'short' | 'equal';
  };
  bestSymbols: string[];
  worstSymbols: string[];
}

// ============================================
// Time Analysis Functions
// ============================================

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function analyzeTimePatterns(trades: Trade[]): TimeAnalysis {
  const profitTrades = trades.filter((t) => typeof t.profit === 'number' && t.exit_time != null);

  // Hourly stats
  const hourlyMap = new Map<number, { wins: number; losses: number; pnl: number }>();
  for (let h = 0; h < 24; h++) {
    hourlyMap.set(h, { wins: 0, losses: 0, pnl: 0 });
  }

  profitTrades.forEach((t) => {
    const hour = new Date(t.entry_time).getHours();
    const stats = hourlyMap.get(hour)!;
    stats.pnl += t.profit!;
    if (t.profit! > 0) stats.wins++;
    else stats.losses++;
  });

  const hourlyStats = Array.from(hourlyMap.entries()).map(([hour, stats]) => {
    const total = stats.wins + stats.losses;
    return {
      hour,
      trades: total,
      winRate: total > 0 ? stats.wins / total : 0,
      totalPnl: stats.pnl,
      avgPnl: total > 0 ? stats.pnl / total : 0,
    };
  });

  // Weekday stats
  const weekdayMap = new Map<number, { wins: number; losses: number; pnl: number }>();
  for (let d = 0; d < 7; d++) {
    weekdayMap.set(d, { wins: 0, losses: 0, pnl: 0 });
  }

  profitTrades.forEach((t) => {
    const day = new Date(t.entry_time).getDay();
    const stats = weekdayMap.get(day)!;
    stats.pnl += t.profit!;
    if (t.profit! > 0) stats.wins++;
    else stats.losses++;
  });

  const weekdayStats = Array.from(weekdayMap.entries()).map(([day, stats]) => {
    const total = stats.wins + stats.losses;
    return {
      day,
      dayName: WEEKDAY_NAMES[day],
      trades: total,
      winRate: total > 0 ? stats.wins / total : 0,
      totalPnl: stats.pnl,
    };
  });

  // Daily PnL for heatmap
  const dailyMap = new Map<string, { pnl: number; trades: number }>();
  profitTrades.forEach((t) => {
    const date = new Date(t.entry_time).toISOString().split('T')[0];
    const existing = dailyMap.get(date) || { pnl: 0, trades: 0 };
    existing.pnl += t.profit!;
    existing.trades++;
    dailyMap.set(date, existing);
  });

  const dailyPnl = Array.from(dailyMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Holding time analysis
  const holdingTimes = profitTrades.map((t) => ({
    minutes: (t.exit_time! - t.entry_time) / 60000,
    isWin: t.profit! > 0,
  }));

  const shortTerm = holdingTimes.filter((h) => h.minutes < 30);
  const mediumTerm = holdingTimes.filter((h) => h.minutes >= 30 && h.minutes < 240);
  const longTerm = holdingTimes.filter((h) => h.minutes >= 240);

  const calcWinRate = (arr: typeof holdingTimes) =>
    arr.length > 0 ? arr.filter((h) => h.isWin).length / arr.length : 0;

  const avgHoldingMinutes =
    holdingTimes.length > 0 ? holdingTimes.reduce((sum, h) => sum + h.minutes, 0) / holdingTimes.length : 0;

  const shortWinRate = calcWinRate(shortTerm);
  const mediumWinRate = calcWinRate(mediumTerm);
  const longWinRate = calcWinRate(longTerm);

  let optimalHoldingRange = '无数据';
  const rates = [
    { range: '短线 (<30分钟)', rate: shortWinRate, count: shortTerm.length },
    { range: '中线 (30分钟-4小时)', rate: mediumWinRate, count: mediumTerm.length },
    { range: '长线 (>4小时)', rate: longWinRate, count: longTerm.length },
  ].filter((r) => r.count >= 5);

  if (rates.length > 0) {
    optimalHoldingRange = rates.reduce((best, curr) => (curr.rate > best.rate ? curr : best)).range;
  }

  // Best/worst periods
  const activeHours = hourlyStats.filter((h) => h.trades >= 3);
  const bestHour = activeHours.length > 0 ? activeHours.reduce((best, curr) => (curr.winRate > best.winRate ? curr : best)).hour : null;
  const worstHour = activeHours.length > 0 ? activeHours.reduce((worst, curr) => (curr.winRate < worst.winRate ? curr : worst)).hour : null;

  const activeWeekdays = weekdayStats.filter((w) => w.trades >= 3);
  const bestWeekday = activeWeekdays.length > 0 ? activeWeekdays.reduce((best, curr) => (curr.winRate > best.winRate ? curr : best)).dayName : null;
  const worstWeekday = activeWeekdays.length > 0 ? activeWeekdays.reduce((worst, curr) => (curr.winRate < worst.winRate ? curr : worst)).dayName : null;

  return {
    hourlyStats,
    weekdayStats,
    dailyPnl,
    holdingTimeStats: {
      avgHoldingMinutes,
      shortTermWinRate: shortWinRate,
      mediumTermWinRate: mediumWinRate,
      longTermWinRate: longWinRate,
      optimalHoldingRange,
    },
    bestHour,
    worstHour,
    bestWeekday,
    worstWeekday,
  };
}

// ============================================
// Behavior Analysis Functions
// ============================================

export function analyzeBehavior(trades: Trade[]): BehaviorAnalysis {
  const profitTrades = trades
    .filter((t) => typeof t.profit === 'number')
    .sort((a, b) => a.entry_time - b.entry_time);

  // Revenge trading detection (trade within 5 minutes after a loss)
  const revengeTrades: BehaviorAnalysis['revengeTrades'] = [];
  for (let i = 1; i < profitTrades.length; i++) {
    const prev = profitTrades[i - 1];
    const curr = profitTrades[i];
    if (prev.profit! < 0) {
      const timeSinceLastLoss = (curr.entry_time - (prev.exit_time || prev.entry_time)) / 60000;
      if (timeSinceLastLoss <= 5) {
        revengeTrades.push({
          trade: curr,
          previousLoss: prev,
          timeSinceLastLoss,
        });
      }
    }
  }

  const revengeWins = revengeTrades.filter((r) => r.trade.profit! > 0).length;
  const revengeTradeWinRate = revengeTrades.length > 0 ? revengeWins / revengeTrades.length : 0;

  // Overtrading detection
  const dailyTradeCount = new Map<string, { count: number; pnl: number }>();
  profitTrades.forEach((t) => {
    const date = new Date(t.entry_time).toISOString().split('T')[0];
    const existing = dailyTradeCount.get(date) || { count: 0, pnl: 0 };
    existing.count++;
    existing.pnl += t.profit!;
    dailyTradeCount.set(date, existing);
  });

  const dailyCounts = Array.from(dailyTradeCount.values()).map((d) => d.count);
  const avgTradesPerDay = dailyCounts.length > 0 ? dailyCounts.reduce((a, b) => a + b, 0) / dailyCounts.length : 0;
  const maxTradesInDay = dailyCounts.length > 0 ? Math.max(...dailyCounts) : 0;
  const stdDev = calculateStdDev(dailyCounts);
  const overtradingThreshold = avgTradesPerDay + 2 * stdDev;

  const overtradingDays = Array.from(dailyTradeCount.entries())
    .filter(([, data]) => data.count > overtradingThreshold)
    .map(([date, data]) => ({ date, tradeCount: data.count, pnl: data.pnl }));

  // Post-win vs post-loss behavior
  const postWinTrades: Trade[] = [];
  const postLossTrades: Trade[] = [];

  for (let i = 1; i < profitTrades.length; i++) {
    const prev = profitTrades[i - 1];
    const curr = profitTrades[i];
    if (prev.profit! > 0) {
      postWinTrades.push(curr);
    } else if (prev.profit! < 0) {
      postLossTrades.push(curr);
    }
  }

  const postWinWins = postWinTrades.filter((t) => t.profit! > 0).length;
  const postLossWins = postLossTrades.filter((t) => t.profit! > 0).length;

  const postWinStats = {
    nextTradeWinRate: postWinTrades.length > 0 ? postWinWins / postWinTrades.length : 0,
    avgNextTradePnl: postWinTrades.length > 0 ? postWinTrades.reduce((sum, t) => sum + t.profit!, 0) / postWinTrades.length : 0,
    tendToOversize: false, // Would need margin data to calculate
  };

  const postLossStats = {
    nextTradeWinRate: postLossTrades.length > 0 ? postLossWins / postLossTrades.length : 0,
    avgNextTradePnl: postLossTrades.length > 0 ? postLossTrades.reduce((sum, t) => sum + t.profit!, 0) / postLossTrades.length : 0,
    tendToRevenge: revengeTrades.length > profitTrades.length * 0.1,
  };

  // Discipline score calculation
  const noRevengeScore = Math.max(0, 100 - revengeTrades.length * 10);
  const noOvertradingScore = Math.max(0, 100 - overtradingDays.length * 15);
  const consistentSizingScore = 70; // Default, would need margin data
  const properHoldingScore = 80; // Default

  const disciplineScore = Math.round(
    (noRevengeScore * 0.3 + noOvertradingScore * 0.3 + consistentSizingScore * 0.2 + properHoldingScore * 0.2)
  );

  return {
    revengeTrades,
    revengeTradeCount: revengeTrades.length,
    revengeTradeWinRate,
    overtradingDays,
    avgTradesPerDay,
    maxTradesInDay,
    postWinStats,
    postLossStats,
    disciplineScore,
    disciplineFactors: {
      consistentSizing: consistentSizingScore,
      noRevengeTrades: noRevengeScore,
      noOvertrading: noOvertradingScore,
      properHoldingTime: properHoldingScore,
    },
  };
}

// ============================================
// Risk Analysis Functions
// ============================================

export function analyzeRisk(trades: Trade[]): RiskAnalysis {
  const profitTrades = trades
    .filter((t) => typeof t.profit === 'number')
    .sort((a, b) => a.entry_time - b.entry_time);

  const profits = profitTrades.map((t) => t.profit!);

  // Consecutive wins/losses
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;

  profitTrades.forEach((t) => {
    if (t.profit! > 0) {
      currentWinStreak++;
      currentLossStreak = 0;
      maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWinStreak);
    } else {
      currentLossStreak++;
      currentWinStreak = 0;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLossStreak);
    }
  });

  const currentStreak: RiskAnalysis['currentStreak'] =
    currentWinStreak > 0
      ? { type: 'win', count: currentWinStreak }
      : currentLossStreak > 0
        ? { type: 'loss', count: currentLossStreak }
        : { type: 'none', count: 0 };

  // Sharpe & Sortino ratios (assuming daily returns, risk-free rate = 0)
  const avgReturn = profits.length > 0 ? profits.reduce((a, b) => a + b, 0) / profits.length : 0;
  const stdDev = calculateStdDev(profits);
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : null; // Annualized

  const negativeProfits = profits.filter((p) => p < 0);
  const downsideStdDev = calculateStdDev(negativeProfits);
  const sortinoRatio = downsideStdDev > 0 ? (avgReturn / downsideStdDev) * Math.sqrt(252) : null;

  // PnL distribution
  const sortedProfits = [...profits].sort((a, b) => a - b);
  const median = sortedProfits.length > 0 ? sortedProfits[Math.floor(sortedProfits.length / 2)] : 0;

  // Calculate skewness
  const n = profits.length;
  const skewness = n > 2 ? calculateSkewness(profits, avgReturn, stdDev) : 0;

  // Create distribution buckets
  const buckets = createDistributionBuckets(profits);

  // Drawdown analysis
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let currentDrawdown = 0;
  const drawdowns: number[] = [];

  profitTrades.forEach((t) => {
    cumulative += t.profit!;
    peak = Math.max(peak, cumulative);
    const dd = cumulative - peak;
    if (dd < maxDrawdown) {
      maxDrawdown = dd;
    }
    if (dd < 0) {
      drawdowns.push(dd);
    }
    currentDrawdown = dd;
  });

  // Calculate recovery trades (optimized O(n) algorithm)
  const recoveryTrades: number[] = [];
  let inDrawdown = false;
  let drawdownStart = 0;
  cumulative = 0;
  peak = 0;

  profitTrades.forEach((t, i) => {
    cumulative += t.profit!;
    if (cumulative > peak) {
      peak = cumulative;
    }

    if (cumulative < peak && !inDrawdown) {
      inDrawdown = true;
      drawdownStart = i;
    } else if (cumulative >= peak && inDrawdown) {
      inDrawdown = false;
      recoveryTrades.push(i - drawdownStart);
    }
  });

  const avgDrawdownRecoveryTrades = recoveryTrades.length > 0 ? recoveryTrades.reduce((a, b) => a + b, 0) / recoveryTrades.length : 0;

  // Risk-adjusted metrics
  const totalPnl = profits.reduce((a, b) => a + b, 0);
  const calmarRatio = maxDrawdown < 0 ? totalPnl / Math.abs(maxDrawdown) : null;
  const profitToMaxDrawdown = maxDrawdown < 0 ? totalPnl / Math.abs(maxDrawdown) : null;

  // Max drawdown percent (simplified - would need account balance)
  const maxDrawdownPercent = peak > 0 ? (maxDrawdown / peak) * 100 : 0;

  return {
    maxConsecutiveWins,
    maxConsecutiveLosses,
    currentStreak,
    sharpeRatio,
    sortinoRatio,
    pnlDistribution: {
      buckets,
      median,
      stdDev,
      skewness,
    },
    maxDrawdown,
    maxDrawdownPercent,
    avgDrawdownRecoveryTrades,
    currentDrawdown,
    calmarRatio,
    profitToMaxDrawdown,
  };
}

// ============================================
// Symbol Analysis Functions
// ============================================

export function analyzeSymbols(trades: Trade[]): SymbolAnalysis {
  const profitTrades = trades.filter((t) => typeof t.profit === 'number');

  // Symbol stats
  const symbolMap = new Map<string, { wins: number; losses: number; pnl: number; winPnl: number; lossPnl: number }>();

  profitTrades.forEach((t) => {
    const existing = symbolMap.get(t.symbol) || { wins: 0, losses: 0, pnl: 0, winPnl: 0, lossPnl: 0 };
    existing.pnl += t.profit!;
    if (t.profit! > 0) {
      existing.wins++;
      existing.winPnl += t.profit!;
    } else {
      existing.losses++;
      existing.lossPnl += Math.abs(t.profit!);
    }
    symbolMap.set(t.symbol, existing);
  });

  const overallWinRate = profitTrades.length > 0 ? profitTrades.filter((t) => t.profit! > 0).length / profitTrades.length : 0;

  const symbolStats = Array.from(symbolMap.entries())
    .map(([symbol, stats]) => {
      const total = stats.wins + stats.losses;
      const winRate = total > 0 ? stats.wins / total : 0;
      const profitFactor = stats.lossPnl > 0 ? stats.winPnl / stats.lossPnl : stats.winPnl > 0 ? Infinity : 0;
      return {
        symbol,
        trades: total,
        winRate,
        totalPnl: stats.pnl,
        avgPnl: total > 0 ? stats.pnl / total : 0,
        profitFactor,
        isStrength: winRate > overallWinRate,
      };
    })
    .sort((a, b) => b.totalPnl - a.totalPnl);

  // Direction stats
  const longTrades = profitTrades.filter((t) => t.direction.toLowerCase() === 'long');
  const shortTrades = profitTrades.filter((t) => t.direction.toLowerCase() === 'short');

  const longWins = longTrades.filter((t) => t.profit! > 0).length;
  const shortWins = shortTrades.filter((t) => t.profit! > 0).length;

  const directionStats = {
    longTrades: longTrades.length,
    longWinRate: longTrades.length > 0 ? longWins / longTrades.length : 0,
    longPnl: longTrades.reduce((sum, t) => sum + t.profit!, 0),
    shortTrades: shortTrades.length,
    shortWinRate: shortTrades.length > 0 ? shortWins / shortTrades.length : 0,
    shortPnl: shortTrades.reduce((sum, t) => sum + t.profit!, 0),
    betterDirection: 'equal' as 'long' | 'short' | 'equal',
  };

  if (directionStats.longWinRate > directionStats.shortWinRate + 0.05) {
    directionStats.betterDirection = 'long';
  } else if (directionStats.shortWinRate > directionStats.longWinRate + 0.05) {
    directionStats.betterDirection = 'short';
  }

  // Best/worst symbols (min 3 trades)
  const qualifiedSymbols = symbolStats.filter((s) => s.trades >= 3);
  const bestSymbols = qualifiedSymbols.filter((s) => s.isStrength).slice(0, 3).map((s) => s.symbol);
  const worstSymbols = qualifiedSymbols.filter((s) => !s.isStrength).slice(-3).reverse().map((s) => s.symbol);

  return {
    symbolStats,
    directionStats,
    bestSymbols,
    worstSymbols,
  };
}

// ============================================
// Helper Functions
// ============================================

function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const squareDiffs = values.map((v) => Math.pow(v - avg, 2));
  return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / values.length);
}

function calculateSkewness(values: number[], mean: number, stdDev: number): number {
  if (stdDev === 0 || values.length < 3) return 0;
  const n = values.length;
  const cubedDiffs = values.map((v) => Math.pow((v - mean) / stdDev, 3));
  return (n / ((n - 1) * (n - 2))) * cubedDiffs.reduce((a, b) => a + b, 0);
}

function createDistributionBuckets(profits: number[]): Array<{ range: string; count: number; percentage: number }> {
  if (profits.length === 0) return [];

  const sorted = [...profits].sort((a, b) => a - b);
  const n = sorted.length;
  const median = sorted[Math.floor(n / 2)];

  const deviations = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = deviations[Math.floor(n / 2)];
  const min = sorted[0];
  const max = sorted[n - 1];
  const range = max - min;
  const baseStep = Math.max(mad, range / 40, 1);

  const steps: number[] = [];
  let step = baseStep;
  for (let i = 0; i < 5; i++) {
    steps.push(step);
    step *= 1.6;
  }

  const negativeBounds: number[] = [];
  const positiveBounds: number[] = [];
  let acc = median;
  for (const s of steps) {
    acc -= s;
    negativeBounds.push(acc);
  }
  acc = median;
  for (const s of steps) {
    acc += s;
    positiveBounds.push(acc);
  }

  const bounds = [
    min,
    ...negativeBounds.reverse(),
    median,
    ...positiveBounds,
    max,
  ].filter((v, idx, arr) => idx === 0 || v > arr[idx - 1]);

  const buckets: Array<{ range: string; count: number; percentage: number }> = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const bucketMin = bounds[i];
    const bucketMax = bounds[i + 1];
    const isLast = i === bounds.length - 2;
    const count = sorted.filter((p) => p >= bucketMin && (isLast ? p <= bucketMax : p < bucketMax)).length;
    const rangeLabel = bucketMin === bucketMax
      ? `${bucketMin.toFixed(0)}`
      : `${bucketMin.toFixed(0)} ~ ${bucketMax.toFixed(0)}`;

    buckets.push({
      range: rangeLabel,
      count,
      percentage: (count / n) * 100,
    });
  }

  return buckets;
}
