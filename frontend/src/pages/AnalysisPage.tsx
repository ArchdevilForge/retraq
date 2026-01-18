import { useEffect, useMemo, useState } from 'react';
import { fetchTrades } from '../services/api';
import type { Trade } from '../services/api';
import {
  analyzeTimePatterns,
  analyzeBehavior,
  analyzeRisk,
  analyzeSymbols,
  generateInsights,
  type TimeAnalysis,
  type BehaviorAnalysis,
  type RiskAnalysis,
  type SymbolAnalysis,
  type SmartInsight,
} from '../utils/tradeAnalysis';

// ============================================
// Formatting Utilities
// ============================================

const formatMoney = (value: number | null | undefined) =>
  value == null ? '—' : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatPercent = (value: number | null | undefined) =>
  value == null ? '—' : `${(value * 100).toFixed(2)}%`;

const formatRatio = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '—' : value.toFixed(2);

// @ts-expect-error Reserved for future use
const _formatDuration = (ms: number | null) => {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} 分钟`;
  return `${hours} 小时 ${minutes} 分钟`;
};

// ============================================
// Icon Components
// ============================================

const TrendingUpIcon = ({ className = 'w-5 h-5' }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
  </svg>
);

// @ts-expect-error Reserved for future use
const _TrendingDownIcon = ({ className = 'w-5 h-5' }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
  </svg>
);

const ClockIcon = ({ className = 'w-5 h-5' }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const BrainIcon = ({ className = 'w-5 h-5' }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
  </svg>
);

const ShieldIcon = ({ className = 'w-5 h-5' }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
  </svg>
);

const LightBulbIcon = ({ className = 'w-5 h-5' }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
  </svg>
);

const WarningIcon = ({ className = 'w-5 h-5' }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

const CheckIcon = ({ className = 'w-5 h-5' }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

const InfoIcon = ({ className = 'w-5 h-5' }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

// ============================================
// Tab Types
// ============================================

type TabType = 'overview' | 'time' | 'behavior';

// ============================================
// Sub-Components
// ============================================

function InsightCard({ insight }: { insight: SmartInsight }) {
  const typeStyles = {
    warning: 'bg-warning/10 border-warning/30 text-warning',
    success: 'bg-success/10 border-success/30 text-success',
    info: 'bg-info/10 border-info/30 text-info',
    tip: 'bg-primary/10 border-primary/30 text-primary',
  };

  const icons = {
    warning: <WarningIcon className="w-4 h-4" />,
    success: <CheckIcon className="w-4 h-4" />,
    info: <InfoIcon className="w-4 h-4" />,
    tip: <LightBulbIcon className="w-4 h-4" />,
  };

  return (
    <div className={`p-3 rounded-lg border ${typeStyles[insight.type]} transition-all hover:scale-[1.01] cursor-pointer`}>
      <div className="flex items-start gap-2">
        <div className="mt-0.5">{icons[insight.type]}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-semibold text-sm text-base-content">{insight.title}</h4>
            {insight.metric && (
              <span className="badge badge-sm badge-ghost shrink-0">{insight.metric}</span>
            )}
          </div>
          <p className="text-xs text-base-content/70 mt-1">{insight.description}</p>
        </div>
      </div>
    </div>
  );
}

function HourlyHeatmap({ hourlyStats }: { hourlyStats: TimeAnalysis['hourlyStats'] }) {
  const maxTrades = Math.max(...hourlyStats.map((h) => h.trades), 1);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-12 gap-0.5">
        {hourlyStats.slice(0, 12).map((stat) => {
          const intensity = stat.trades / maxTrades;
          const winRateColor = stat.trades > 0
            ? stat.winRate >= 0.5 ? `rgba(34, 197, 94, ${0.3 + intensity * 0.7})` : `rgba(239, 68, 68, ${0.3 + intensity * 0.7})`
            : 'rgba(100, 100, 100, 0.1)';

          return (
            <div
              key={stat.hour}
              className="aspect-square rounded flex items-center justify-center text-[10px] font-mono tooltip cursor-pointer"
              style={{ backgroundColor: winRateColor }}
              data-tip={`${stat.hour}:00 - ${stat.trades}笔 胜率${(stat.winRate * 100).toFixed(0)}%`}
            >
              {stat.hour}
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-12 gap-0.5">
        {hourlyStats.slice(12, 24).map((stat) => {
          const intensity = stat.trades / maxTrades;
          const winRateColor = stat.trades > 0
            ? stat.winRate >= 0.5 ? `rgba(34, 197, 94, ${0.3 + intensity * 0.7})` : `rgba(239, 68, 68, ${0.3 + intensity * 0.7})`
            : 'rgba(100, 100, 100, 0.1)';

          return (
            <div
              key={stat.hour}
              className="aspect-square rounded flex items-center justify-center text-xs font-mono tooltip cursor-pointer"
              style={{ backgroundColor: winRateColor }}
              data-tip={`${stat.hour}:00 - ${stat.trades}笔 胜率${(stat.winRate * 100).toFixed(0)}%`}
            >
              {stat.hour}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-center gap-4 text-xs text-base-content/60 mt-2">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-success/50"></div>
          <span>胜率 ≥50%</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-error/50"></div>
          <span>胜率 &lt;50%</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-base-300"></div>
          <span>无交易</span>
        </div>
      </div>
    </div>
  );
}

function WeekdayChart({ weekdayStats }: { weekdayStats: TimeAnalysis['weekdayStats'] }) {
  const maxPnl = Math.max(...weekdayStats.map((w) => Math.abs(w.totalPnl)), 1);

  return (
    <div className="space-y-2">
      {weekdayStats.map((stat) => {
        const width = Math.abs(stat.totalPnl) / maxPnl * 100;
        const isPositive = stat.totalPnl >= 0;

        return (
          <div key={stat.day} className="flex items-center gap-3">
            <span className="w-8 text-sm font-medium">{stat.dayName}</span>
            <div className="flex-1 h-6 bg-base-300 rounded-full overflow-hidden relative">
              <div
                className={`h-full rounded-full transition-all ${isPositive ? 'bg-success' : 'bg-error'}`}
                style={{ width: `${width}%` }}
              />
              <span className="absolute inset-0 flex items-center justify-center text-xs font-mono">
                {stat.trades > 0 ? `${stat.trades}笔 ${(stat.winRate * 100).toFixed(0)}%` : '—'}
              </span>
            </div>
            <span className={`w-24 text-right text-sm font-mono ${isPositive ? 'text-success' : 'text-error'}`}>
              {formatMoney(stat.totalPnl)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DisciplineGauge({ score, factors }: { score: number; factors: BehaviorAnalysis['disciplineFactors'] }) {
  const getScoreColor = (s: number) => {
    if (s >= 80) return 'text-success';
    if (s >= 60) return 'text-warning';
    return 'text-error';
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className={`radial-progress ${getScoreColor(score)}`}
        style={{ '--value': score, '--size': '8rem', '--thickness': '0.8rem' } as React.CSSProperties}
        role="progressbar"
      >
        <div className="text-center">
          <div className="text-2xl font-bold">{score}</div>
          <div className="text-xs opacity-70">纪律分</div>
        </div>
      </div>
      <div className="w-full space-y-2">
        {[
          { label: '无复仇交易', value: factors.noRevengeTrades },
          { label: '无过度交易', value: factors.noOvertrading },
          { label: '仓位一致性', value: factors.consistentSizing },
          { label: '持仓时间', value: factors.properHoldingTime },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <span className="text-xs text-base-content/70 w-20">{item.label}</span>
            <progress
              className={`progress flex-1 ${item.value >= 80 ? 'progress-success' : item.value >= 60 ? 'progress-warning' : 'progress-error'}`}
              value={item.value}
              max="100"
            />
            <span className="text-xs font-mono w-8">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PnLDistributionChart({ buckets }: { buckets: RiskAnalysis['pnlDistribution']['buckets'] }) {
  const maxPercentage = Math.max(...buckets.map((b) => b.percentage), 1);
  const MIN_BAR_WIDTH = 6;
  const medianIndex = Math.floor((buckets.length - 1) / 2);

  return (
    <div className="space-y-1">
      {buckets.map((bucket, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-xs font-mono w-28 text-right truncate" title={bucket.range}>
            {bucket.range}
          </span>
          <div className="relative flex-1 h-5 bg-base-300 rounded overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-base-300/60 to-transparent opacity-40" />
            <div className="absolute inset-y-0 left-1/2 w-px bg-base-content/20" />
            {bucket.percentage > 0 && (
              <div
                className={`absolute inset-y-0 left-0 rounded transition-all ${bucket.range.includes('-') && !bucket.range.startsWith('-') ? 'bg-info' : parseFloat(bucket.range) < 0 ? 'bg-error' : 'bg-success'}`}
                style={{
                  width: `${Math.max(
                    MIN_BAR_WIDTH,
                    (Math.log1p(bucket.percentage) / Math.log1p(maxPercentage)) * 100
                  )}%`,
                }}
              />
            )}
          </div>
          <span className={`text-xs font-mono w-12 ${i === medianIndex ? 'text-info' : ''}`}>
            {bucket.percentage.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function SymbolRanking({ symbolStats, limit = 5 }: { symbolStats: SymbolAnalysis['symbolStats']; limit?: number }) {
  const topSymbols = symbolStats.slice(0, limit);

  return (
    <div className="overflow-x-auto">
      <table className="table table-xs">
        <thead className="text-[11px]">
          <tr>
            <th>交易对</th>
            <th className="text-right">交易数</th>
            <th className="text-right">胜率</th>
            <th className="text-right">盈亏</th>
          </tr>
        </thead>
        <tbody>
          {topSymbols.map((stat) => (
            <tr key={stat.symbol} className="hover">
              <td className="font-mono">{stat.symbol}</td>
              <td className="text-right">{stat.trades}</td>
              <td className={`text-right ${stat.winRate >= 0.5 ? 'text-success' : 'text-error'}`}>
                {(stat.winRate * 100).toFixed(1)}%
              </td>
              <td className={`text-right font-mono ${stat.totalPnl >= 0 ? 'text-success' : 'text-error'}`}>
                {formatMoney(stat.totalPnl)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================
// Tab Components
// ============================================

interface OverviewTabProps {
  analysis: {
    totalPnl: number;
    winRate: number | null;
    profitFactor: number | null;
    payoffRatio: number | null;
    avgWin: number | null;
    avgLoss: number | null;
    maxDrawdown: number;
    expectancy: number | null;
    totalTrades: number;
    winTrades: number;
    lossTrades: number;
    tradesPerDay: number | null;
    avgHoldMs: number | null;
    bestTrade: Trade | null;
    worstTrade: Trade | null;
  };
  symbolAnalysis: SymbolAnalysis;
  insights: SmartInsight[];
}

function OverviewTab({ analysis, symbolAnalysis, insights }: OverviewTabProps) {
  const topInsights = insights.slice(0, 2);

  return (
    <div className="space-y-3">
      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card bg-base-200 border border-base-300">
          <div className="card-body p-3">
            <div className="text-xs text-base-content/60">总交易数</div>
            <div className="text-xl font-bold">{analysis.totalTrades}</div>
            <div className="text-xs text-base-content/60">
              胜 {analysis.winTrades} / 负 {analysis.lossTrades}
            </div>
          </div>
        </div>
        <div className="card bg-base-200 border border-base-300">
          <div className="card-body p-3">
            <div className="text-xs text-base-content/60">盈亏比</div>
            <div className="text-xl font-bold text-info">{formatRatio(analysis.payoffRatio)}</div>
            <div className="text-xs text-base-content/60">平均盈利/平均亏损</div>
          </div>
        </div>
        <div className="card bg-base-200 border border-base-300">
          <div className="card-body p-3">
            <div className="text-xs text-base-content/60">利润因子</div>
            <div className="text-xl font-bold text-warning">{formatRatio(analysis.profitFactor)}</div>
            <div className="text-xs text-base-content/60">总盈利/总亏损</div>
          </div>
        </div>
        <div className="card bg-base-200 border border-base-300">
          <div className="card-body p-3">
            <div className="text-xs text-base-content/60">期望值</div>
            <div className={`text-xl font-bold ${analysis.expectancy && analysis.expectancy >= 0 ? 'text-success' : 'text-error'}`}>
              {formatMoney(analysis.expectancy)}
            </div>
            <div className="text-xs text-base-content/60">单笔期望收益</div>
          </div>
        </div>
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Symbol Performance */}
        <div className="card bg-base-200 border border-base-300">
          <div className="card-body">
            <h3 className="card-title text-base">交易对表现</h3>
            <SymbolRanking symbolStats={symbolAnalysis.symbolStats} limit={4} />

            {/* Direction Stats */}
            <div className="divider my-2"></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="text-center p-2 bg-success/10 rounded-lg">
                <div className="text-xs text-base-content/60">做多</div>
                <div className="text-lg font-bold text-success">
                  {(symbolAnalysis.directionStats.longWinRate * 100).toFixed(1)}%
                </div>
                <div className="text-xs">{symbolAnalysis.directionStats.longTrades} 笔</div>
              </div>
              <div className="text-center p-2 bg-error/10 rounded-lg">
                <div className="text-xs text-base-content/60">做空</div>
                <div className="text-lg font-bold text-error">
                  {(symbolAnalysis.directionStats.shortWinRate * 100).toFixed(1)}%
                </div>
                <div className="text-xs">{symbolAnalysis.directionStats.shortTrades} 笔</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Quick Insights + Best/Worst */}
        <div className="space-y-3">
          {/* Top Insights */}
          {topInsights.length > 0 && (
            <div className="card bg-base-200 border border-base-300">
              <div className="card-body">
                <h3 className="card-title text-base">重要洞察</h3>
                <div className="space-y-3">
                  {topInsights.map((insight, i) => (
                    <InsightCard key={i} insight={insight} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Best/Worst Trades */}
          <div className="card bg-base-200 border border-base-300">
            <div className="card-body">
              <h3 className="card-title text-base">极值交易</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2 bg-success/10 rounded-lg">
                  <div>
                    <div className="text-xs text-base-content/60">最佳交易</div>
                    <div className="font-mono text-sm">{analysis.bestTrade?.symbol ?? '—'}</div>
                  </div>
                  <div className="text-base font-bold text-success">{formatMoney(analysis.bestTrade?.profit)}</div>
                </div>
                <div className="flex items-center justify-between p-2 bg-error/10 rounded-lg">
                  <div>
                    <div className="text-xs text-base-content/60">最差交易</div>
                    <div className="font-mono text-sm">{analysis.worstTrade?.symbol ?? '—'}</div>
                  </div>
                  <div className="text-base font-bold text-error">{formatMoney(analysis.worstTrade?.profit)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TimeTab({ timeAnalysis }: { timeAnalysis: TimeAnalysis }) {
  return (
    <div className="space-y-3">
      {/* Time Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card bg-base-200 border border-base-300">
          <div className="card-body p-3">
            <div className="text-xs text-base-content/60">最佳时段</div>
            <div className="text-xl font-bold text-success">
              {timeAnalysis.bestHour !== null ? `${timeAnalysis.bestHour}:00` : '—'}
            </div>
          </div>
        </div>
        <div className="card bg-base-200 border border-base-300">
          <div className="card-body p-3">
            <div className="text-xs text-base-content/60">最差时段</div>
            <div className="text-xl font-bold text-error">
              {timeAnalysis.worstHour !== null ? `${timeAnalysis.worstHour}:00` : '—'}
            </div>
          </div>
        </div>
        <div className="card bg-base-200 border border-base-300">
          <div className="card-body p-3">
            <div className="text-xs text-base-content/60">最佳星期</div>
            <div className="text-xl font-bold text-success">{timeAnalysis.bestWeekday ?? '—'}</div>
          </div>
        </div>
        <div className="card bg-base-200 border border-base-300">
          <div className="card-body p-3">
            <div className="text-xs text-base-content/60">最优持仓</div>
            <div className="text-base font-bold">{timeAnalysis.holdingTimeStats.optimalHoldingRange}</div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="card bg-base-200 border border-base-300">
          <div className="card-body">
            <h3 className="card-title text-base">
              <ClockIcon className="w-5 h-5" />
              24小时交易热力图
            </h3>
            <p className="text-xs text-base-content/60 mb-2">颜色深浅表示交易量，绿色=胜率≥50%，红色=胜率&lt;50%</p>
            <HourlyHeatmap hourlyStats={timeAnalysis.hourlyStats} />
          </div>
        </div>

        <div className="card bg-base-200 border border-base-300">
          <div className="card-body">
            <h3 className="card-title text-base">星期盈亏分布</h3>
            <p className="text-xs text-base-content/60 mb-2">每个星期几的交易表现</p>
            <WeekdayChart weekdayStats={timeAnalysis.weekdayStats} />
          </div>
        </div>
      </div>

      {/* Holding Time Analysis */}
      <div className="card bg-base-200 border border-base-300">
        <div className="card-body">
          <h3 className="card-title text-base">持仓时长分析</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <div className="text-center p-3 bg-base-300/50 rounded-lg">
              <div className="text-xs text-base-content/60 mb-1">短线 (&lt;30分钟)</div>
              <div className={`text-xl font-bold ${timeAnalysis.holdingTimeStats.shortTermWinRate >= 0.5 ? 'text-success' : 'text-error'}`}>
                {(timeAnalysis.holdingTimeStats.shortTermWinRate * 100).toFixed(1)}%
              </div>
            </div>
            <div className="text-center p-3 bg-base-300/50 rounded-lg">
              <div className="text-xs text-base-content/60 mb-1">中线 (30分钟-4小时)</div>
              <div className={`text-xl font-bold ${timeAnalysis.holdingTimeStats.mediumTermWinRate >= 0.5 ? 'text-success' : 'text-error'}`}>
                {(timeAnalysis.holdingTimeStats.mediumTermWinRate * 100).toFixed(1)}%
              </div>
            </div>
            <div className="text-center p-3 bg-base-300/50 rounded-lg">
              <div className="text-xs text-base-content/60 mb-1">长线 (&gt;4小时)</div>
              <div className={`text-xl font-bold ${timeAnalysis.holdingTimeStats.longTermWinRate >= 0.5 ? 'text-success' : 'text-error'}`}>
                {(timeAnalysis.holdingTimeStats.longTermWinRate * 100).toFixed(1)}%
              </div>
            </div>
          </div>
          <div className="text-center mt-3 text-xs text-base-content/60">
            平均持仓时长: <span className="font-mono">{Math.round(timeAnalysis.holdingTimeStats.avgHoldingMinutes)} 分钟</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BehaviorTab({ behaviorAnalysis }: { behaviorAnalysis: BehaviorAnalysis }) {
  return (
    <div className="space-y-3">
      {/* Discipline Score */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card bg-base-200 border border-base-300">
          <div className="card-body">
            <h3 className="card-title text-base">
              <BrainIcon className="w-5 h-5" />
              交易纪律评分
            </h3>
            <DisciplineGauge score={behaviorAnalysis.disciplineScore} factors={behaviorAnalysis.disciplineFactors} />
          </div>
        </div>

        {/* Behavior Warnings */}
        <div className="lg:col-span-2 space-y-3">
          {/* Revenge Trading */}
          <div className="card bg-base-200 border border-base-300">
            <div className="card-body">
              <div className="flex items-center justify-between">
                <h3 className="card-title text-base">
                  <WarningIcon className="w-5 h-5 text-warning" />
                  复仇交易检测
                </h3>
                <span className={`badge ${behaviorAnalysis.revengeTradeCount > 0 ? 'badge-warning' : 'badge-success'}`}>
                  {behaviorAnalysis.revengeTradeCount} 次
                </span>
              </div>
              <p className="text-xs text-base-content/60">
                亏损后5分钟内开仓被视为复仇交易，通常胜率较低
              </p>
              {behaviorAnalysis.revengeTradeCount > 0 && (
                <div className="mt-2 p-3 bg-warning/10 rounded-lg">
                  <div className="text-xs">
                    复仇交易胜率: <span className="font-bold text-warning">{(behaviorAnalysis.revengeTradeWinRate * 100).toFixed(1)}%</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Overtrading */}
          <div className="card bg-base-200 border border-base-300">
            <div className="card-body">
              <div className="flex items-center justify-between">
                <h3 className="card-title text-base">
                  <WarningIcon className="w-5 h-5 text-error" />
                  过度交易检测
                </h3>
                <span className={`badge ${behaviorAnalysis.overtradingDays.length > 0 ? 'badge-error' : 'badge-success'}`}>
                  {behaviorAnalysis.overtradingDays.length} 天
                </span>
              </div>
              <p className="text-xs text-base-content/60">
                日均 {behaviorAnalysis.avgTradesPerDay.toFixed(1)} 笔，最高 {behaviorAnalysis.maxTradesInDay} 笔/天
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Post-Win vs Post-Loss Behavior */}
      <div className="card bg-base-200 border border-base-300">
        <div className="card-body">
          <h3 className="card-title text-base">盈亏后行为对比</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
            <div className="p-3 bg-success/10 rounded-lg border border-success/20">
              <div className="text-xs font-semibold text-success mb-2">盈利后</div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-xs text-base-content/70">下一笔胜率</span>
                  <span className="font-mono">{(behaviorAnalysis.postWinStats.nextTradeWinRate * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-base-content/70">下一笔平均盈亏</span>
                  <span className={`font-mono ${behaviorAnalysis.postWinStats.avgNextTradePnl >= 0 ? 'text-success' : 'text-error'}`}>
                    {formatMoney(behaviorAnalysis.postWinStats.avgNextTradePnl)}
                  </span>
                </div>
              </div>
            </div>
            <div className="p-3 bg-error/10 rounded-lg border border-error/20">
              <div className="text-xs font-semibold text-error mb-2">亏损后</div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-xs text-base-content/70">下一笔胜率</span>
                  <span className="font-mono">{(behaviorAnalysis.postLossStats.nextTradeWinRate * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-base-content/70">下一笔平均盈亏</span>
                  <span className={`font-mono ${behaviorAnalysis.postLossStats.avgNextTradePnl >= 0 ? 'text-success' : 'text-error'}`}>
                    {formatMoney(behaviorAnalysis.postLossStats.avgNextTradePnl)}
                  </span>
                </div>
                {behaviorAnalysis.postLossStats.tendToRevenge && (
                  <div className="text-xs text-warning mt-2">⚠️ 存在复仇交易倾向</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// @ts-expect-error Reserved for future use
function _RiskTab({ riskAnalysis, analysis }: { riskAnalysis: RiskAnalysis; analysis: { maxDrawdown: number; totalPnl: number } }) {
  return (
    <div className="space-y-3">
      {/* Risk Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card bg-base-200 border border-base-300">
          <div className="card-body p-3">
            <div className="text-xs text-base-content/60">夏普比率</div>
            <div className={`text-xl font-bold ${riskAnalysis.sharpeRatio && riskAnalysis.sharpeRatio > 1 ? 'text-success' : 'text-warning'}`}>
              {riskAnalysis.sharpeRatio?.toFixed(2) ?? '—'}
            </div>
          </div>
        </div>
        <div className="card bg-base-200 border border-base-300">
          <div className="card-body p-3">
            <div className="text-xs text-base-content/60">索提诺比率</div>
            <div className={`text-xl font-bold ${riskAnalysis.sortinoRatio && riskAnalysis.sortinoRatio > 1 ? 'text-success' : 'text-warning'}`}>
              {riskAnalysis.sortinoRatio?.toFixed(2) ?? '—'}
            </div>
          </div>
        </div>
        <div className="card bg-base-200 border border-base-300">
          <div className="card-body p-3">
            <div className="text-xs text-base-content/60">最大回撤</div>
            <div className="text-xl font-bold text-error">{formatMoney(analysis.maxDrawdown)}</div>
          </div>
        </div>
        <div className="card bg-base-200 border border-base-300">
          <div className="card-body p-3">
            <div className="text-xs text-base-content/60">盈利/回撤比</div>
            <div className={`text-xl font-bold ${riskAnalysis.profitToMaxDrawdown && riskAnalysis.profitToMaxDrawdown > 1 ? 'text-success' : 'text-warning'}`}>
              {riskAnalysis.profitToMaxDrawdown?.toFixed(2) ?? '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Streak Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="card bg-base-200 border border-base-300">
          <div className="card-body">
            <h3 className="card-title text-base">
              <ShieldIcon className="w-5 h-5" />
              连续交易分析
            </h3>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div className="text-center p-3 bg-success/10 rounded-lg">
                <div className="text-xs text-base-content/60">最大连胜</div>
                <div className="text-2xl font-bold text-success">{riskAnalysis.maxConsecutiveWins}</div>
              </div>
              <div className="text-center p-3 bg-error/10 rounded-lg">
                <div className="text-xs text-base-content/60">最大连亏</div>
                <div className="text-2xl font-bold text-error">{riskAnalysis.maxConsecutiveLosses}</div>
              </div>
            </div>
            {riskAnalysis.currentStreak.type !== 'none' && (
              <div className={`mt-3 p-3 rounded-lg ${riskAnalysis.currentStreak.type === 'win' ? 'bg-success/10' : 'bg-error/10'}`}>
                <div className="text-xs">
                  当前状态: <span className={`font-bold ${riskAnalysis.currentStreak.type === 'win' ? 'text-success' : 'text-error'}`}>
                    {riskAnalysis.currentStreak.type === 'win' ? '连胜' : '连亏'} {riskAnalysis.currentStreak.count} 笔
                  </span>
                </div>
              </div>
            )}
            <div className="text-xs text-base-content/60 mt-2">
              平均回撤恢复: <span className="font-mono">{riskAnalysis.avgDrawdownRecoveryTrades.toFixed(1)} 笔</span>
            </div>
          </div>
        </div>

        {/* PnL Distribution */}
        <div className="card bg-base-200 border border-base-300">
          <div className="card-body">
            <h3 className="card-title text-base">盈亏分布</h3>
            <div className="text-xs text-base-content/60 mb-2">
              中位数: {formatMoney(riskAnalysis.pnlDistribution.median)} |
              标准差: {formatMoney(riskAnalysis.pnlDistribution.stdDev)} |
              偏度: {riskAnalysis.pnlDistribution.skewness.toFixed(2)}
            </div>
            <PnLDistributionChart buckets={riskAnalysis.pnlDistribution.buckets} />
          </div>
        </div>
      </div>
    </div>
  );
}

// @ts-expect-error Reserved for future use
function _InsightsTab({ insights }: { insights: SmartInsight[] }) {
  const categories = {
    time: insights.filter((i) => i.category === 'time'),
    behavior: insights.filter((i) => i.category === 'behavior'),
    risk: insights.filter((i) => i.category === 'risk'),
    symbol: insights.filter((i) => i.category === 'symbol'),
  };

  if (insights.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-base-content/60">
        <LightBulbIcon className="w-12 h-12 mb-4 opacity-50" />
        <p>暂无智能洞察</p>
        <p className="text-sm">需要更多交易数据来生成建议</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* All Insights by Category */}
      {Object.entries(categories).map(([category, categoryInsights]) => {
        if (categoryInsights.length === 0) return null;
        const displayInsights = categoryInsights.slice(0, 2);

        const categoryLabels: Record<string, { label: string; icon: React.ReactNode }> = {
          time: { label: '时间相关', icon: <ClockIcon className="w-5 h-5" /> },
          behavior: { label: '行为相关', icon: <BrainIcon className="w-5 h-5" /> },
          risk: { label: '风险相关', icon: <ShieldIcon className="w-5 h-5" /> },
          symbol: { label: '标的相关', icon: <TrendingUpIcon className="w-5 h-5" /> },
        };

        const { label, icon } = categoryLabels[category] || { label: category, icon: null };

        return (
          <div key={category} className="card bg-base-200 border border-base-300">
            <div className="card-body p-4">
              <h3 className="card-title text-base gap-2">
                {icon}
                {label}
                <span className="badge badge-sm">{categoryInsights.length}</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                {displayInsights.map((insight, i) => (
                  <InsightCard key={i} insight={insight} />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// Main Component
// ============================================

export default function AnalysisPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchTrades(undefined, { maxPages: 200, limit: 500 })
      .then(setTrades)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  // Compute all analyses
  const analysis = useMemo(() => {
    const profitTrades = trades.filter((t) => typeof t.profit === 'number');
    const sorted = [...profitTrades].sort((a, b) => a.entry_time - b.entry_time);

    let cumulative = 0;
    const pnlSeries = sorted.map((trade) => {
      cumulative += trade.profit ?? 0;
      return { time: trade.entry_time, value: cumulative };
    });

    const wins = profitTrades.filter((t) => (t.profit ?? 0) > 0);
    const losses = profitTrades.filter((t) => (t.profit ?? 0) < 0);
    const winSum = wins.reduce((sum, t) => sum + (t.profit ?? 0), 0);
    const lossSum = losses.reduce((sum, t) => sum + (t.profit ?? 0), 0);
    const totalPnl = winSum + lossSum;

    const avgWin = wins.length ? winSum / wins.length : null;
    const avgLoss = losses.length ? lossSum / losses.length : null;
    const winRate = wins.length + losses.length > 0 ? wins.length / (wins.length + losses.length) : null;
    const profitFactor = lossSum !== 0 ? winSum / Math.abs(lossSum) : null;
    const payoffRatio = avgWin != null && avgLoss != null ? avgWin / Math.abs(avgLoss) : null;
    const expectancy = winRate != null && avgWin != null && avgLoss != null
      ? winRate * avgWin + (1 - winRate) * avgLoss
      : null;

    let peak = -Infinity;
    let maxDrawdown = 0;
    pnlSeries.forEach((point) => {
      peak = Math.max(peak, point.value);
      maxDrawdown = Math.min(maxDrawdown, point.value - peak);
    });

    const closedTrades = profitTrades.filter((t) => t.exit_time != null);
    const avgHoldMs = closedTrades.length > 0
      ? closedTrades.reduce((sum, t) => sum + (t.exit_time! - t.entry_time), 0) / closedTrades.length
      : null;

    const daySet = new Set<number>();
    profitTrades.forEach((t) => {
      const d = new Date(t.entry_time);
      daySet.add(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    });
    const tradesPerDay = daySet.size > 0 ? profitTrades.length / daySet.size : null;

    const bestTrade = wins.reduce<Trade | null>((best, t) => {
      if (!best) return t;
      return (t.profit ?? 0) > (best.profit ?? 0) ? t : best;
    }, null);

    const worstTrade = losses.reduce<Trade | null>((worst, t) => {
      if (!worst) return t;
      return (t.profit ?? 0) < (worst.profit ?? 0) ? t : worst;
    }, null);

    return {
      pnlSeries,
      totalPnl,
      winRate,
      profitFactor,
      payoffRatio,
      avgWin,
      avgLoss,
      maxDrawdown,
      bestTrade,
      worstTrade,
      totalTrades: profitTrades.length,
      winTrades: wins.length,
      lossTrades: losses.length,
      expectancy,
      avgHoldMs,
      tradesPerDay,
    };
  }, [trades]);

  // Advanced analyses
  const timeAnalysis = useMemo(() => analyzeTimePatterns(trades), [trades]);
  const behaviorAnalysis = useMemo(() => analyzeBehavior(trades), [trades]);
  const riskAnalysis = useMemo(() => analyzeRisk(trades), [trades]);
  const symbolAnalysis = useMemo(() => analyzeSymbols(trades), [trades]);
  const insights = useMemo(
    () => generateInsights(timeAnalysis, behaviorAnalysis, riskAnalysis, symbolAnalysis),
    [timeAnalysis, behaviorAnalysis, riskAnalysis, symbolAnalysis]
  );

  const pnlTone = analysis.totalPnl >= 0 ? 'text-success' : 'text-error';

  // Tab content renderer
  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return <OverviewTab analysis={analysis} symbolAnalysis={symbolAnalysis} insights={insights} />;
      case 'time':
        return <TimeTab timeAnalysis={timeAnalysis} />;
      case 'behavior':
        return <BehaviorTab behaviorAnalysis={behaviorAnalysis} />;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col flex-grow min-h-0 p-6">
        <div className="flex items-center justify-center h-64">
          <span className="loading loading-spinner loading-lg text-primary"></span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col flex-grow min-h-0 p-6">
        <div className="alert alert-error">
          <WarningIcon />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-grow min-h-0">
      <main className="flex-grow min-h-0 overflow-hidden">
        <div className="h-full overflow-hidden p-4 md:p-6 space-y-3 flex flex-col text-sm">
          {/* Header */}
          <div className="flex flex-col lg:flex-row gap-3 items-start justify-between">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                分析中心
                {insights.length > 0 && (
                  <span className="badge badge-primary badge-sm">{insights.length} 条洞察</span>
                )}
              </h1>
              <p className="text-xs text-base-content/60 mt-1">
                深度分析交易行为、时间模式与风险指标
              </p>
            </div>

            {/* Quick Stats */}
            <div className="stats stats-horizontal shadow bg-base-200 border border-base-300">
              <div className="stat py-2 px-3">
                <div className="stat-title text-[10px]">累计盈亏</div>
                <div className={`stat-value text-base ${pnlTone}`}>{formatMoney(analysis.totalPnl)}</div>
              </div>
              <div className="stat py-2 px-3">
                <div className="stat-title text-[10px]">胜率</div>
                <div className="stat-value text-base">{formatPercent(analysis.winRate)}</div>
              </div>
              <div className="stat py-2 px-3">
                <div className="stat-title text-[10px]">纪律分</div>
                <div className={`stat-value text-base ${behaviorAnalysis.disciplineScore >= 80 ? 'text-success' : behaviorAnalysis.disciplineScore >= 60 ? 'text-warning' : 'text-error'}`}>
                  {behaviorAnalysis.disciplineScore}
                </div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div role="tablist" className="tabs tabs-boxed bg-base-200 p-0.5">
            {[
              { id: 'overview', label: '总览', icon: <TrendingUpIcon className="w-4 h-4" /> },
              { id: 'time', label: '时间分析', icon: <ClockIcon className="w-4 h-4" /> },
              { id: 'behavior', label: '行为洞察', icon: <BrainIcon className="w-4 h-4" /> },
            ].map((tab) => (
              <button
                key={tab.id}
                role="tab"
                className={`tab gap-1 text-xs ${activeTab === tab.id ? 'tab-active' : ''}`}
                onClick={() => setActiveTab(tab.id as TabType)}
              >
                {tab.icon}
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {renderTabContent()}
          </div>
        </div>
      </main>
    </div>
  );
}
