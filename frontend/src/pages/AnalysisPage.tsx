import { useEffect, useMemo, useState } from 'react';
import { useDataset } from '../context/DatasetContext';
import { fetchTrades } from '../services/api';
import type { Trade } from '../services/api';
import {
  analyzeTimePatterns,
  analyzeBehavior,
  analyzeRisk,
  analyzeSymbols,
  type TimeAnalysis,
} from '../utils/tradeAnalysis';

type TabId = 'overview' | 'behavior' | 'time' | 'risk';

const fmt$ = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`card card-border border-white/[0.08] bg-base-200/80 shadow-none ${className}`}>
      <div className="card-body gap-3 p-4 sm:p-5">
        <h2 className="card-title font-display text-base font-semibold text-base-content/90">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function useCoreAnalysis(trades: Trade[]) {
  return useMemo(() => {
    const rows = trades.filter((t) => typeof t.profit === 'number');
    const wins = rows.filter((t) => (t.profit ?? 0) > 0);
    const losses = rows.filter((t) => (t.profit ?? 0) < 0);
    const winSum = wins.reduce((s, t) => s + (t.profit ?? 0), 0);
    const lossSum = losses.reduce((s, t) => s + (t.profit ?? 0), 0);
    const totalPnl = winSum + lossSum;
    const avgWin = wins.length ? winSum / wins.length : null;
    const avgLoss = losses.length ? lossSum / losses.length : null;
    const winRate = wins.length + losses.length > 0 ? wins.length / (wins.length + losses.length) : null;
    const profitFactor = lossSum !== 0 ? winSum / Math.abs(lossSum) : null;
    const payoff = avgWin != null && avgLoss != null ? avgWin / Math.abs(avgLoss) : null;
    const expectancy =
      winRate != null && avgWin != null && avgLoss != null ? winRate * avgWin + (1 - winRate) * avgLoss : null;

    const sorted = [...rows].sort((a, b) => a.entry_time - b.entry_time);
    let peak = -Infinity;
    let maxDd = 0;
    let cum = 0;
    sorted.forEach((t) => {
      cum += t.profit ?? 0;
      peak = Math.max(peak, cum);
      maxDd = Math.min(maxDd, cum - peak);
    });

    const days = new Set<number>();
    rows.forEach((t) => {
      const d = new Date(t.entry_time);
      days.add(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    });

    return {
      totalPnl,
      winRate,
      profitFactor,
      payoff,
      expectancy,
      maxDrawdown: maxDd,
      totalTrades: rows.length,
      winTrades: wins.length,
      lossTrades: losses.length,
      tradesPerDay: days.size > 0 ? rows.length / days.size : null,
      best: wins.reduce<Trade | null>((b, t) => (!b || (t.profit ?? 0) > (b.profit ?? 0) ? t : b), null),
      worst: losses.reduce<Trade | null>((w, t) => (!w || (t.profit ?? 0) < (w.profit ?? 0) ? t : w), null),
    };
  }, [trades]);
}

function HourStrip({ stats }: { stats: TimeAnalysis['hourlyStats'] }) {
  const max = Math.max(...stats.map((h) => h.trades), 1);
  return (
    <div className="grid grid-cols-12 gap-1">
      {stats.map((h) => (
        <div
          key={h.hour}
          title={`${h.hour}:00 · ${h.trades}笔 · 胜率${(h.winRate * 100).toFixed(0)}%`}
          className="flex h-12 items-end justify-center rounded-sm bg-base-300/40"
        >
          <div
            className={`w-full rounded-t-sm ${h.winRate >= 0.5 ? 'bg-success/70' : h.trades ? 'bg-error/60' : 'bg-transparent'}`}
            style={{ height: `${Math.max(10, (h.trades / max) * 100)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

export default function AnalysisPage() {
  const { activeDatasetId } = useDataset();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('overview');

  useEffect(() => {
    if (activeDatasetId == null) return;
    setLoading(true);
    setError(null);
    fetchTrades(undefined, { limit: 2000, maxPages: 5 })
      .then(setTrades)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [activeDatasetId]);

  const core = useCoreAnalysis(trades);
  const time = useMemo(() => analyzeTimePatterns(trades), [trades]);
  const behavior = useMemo(() => analyzeBehavior(trades), [trades]);
  const risk = useMemo(() => analyzeRisk(trades), [trades]);
  const symbols = useMemo(() => analyzeSymbols(trades), [trades]);

  const recentLosses = useMemo(
    () =>
      [...trades]
        .filter((t) => (t.profit ?? 0) < 0)
        .sort((a, b) => b.entry_time - a.entry_time)
        .slice(0, 12),
    [trades],
  );

  const pnlTone = core.totalPnl >= 0 ? 'text-success' : 'text-error';
  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: '总览' },
    { id: 'behavior', label: '行为' },
    { id: 'time', label: '时间' },
    { id: 'risk', label: '风险' },
  ];

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="loading loading-spinner loading-md text-[#D97757]" />
      </div>
    );
  }
  if (error) {
    return <div className="p-4 text-base text-error">{error}</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden p-4">
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 overflow-y-auto">
        <header>
          <h1 className="font-display text-2xl font-semibold tracking-tight">分析</h1>
          <p className="mt-1 text-sm text-base-content/55">基于当前数据集的交割单统计</p>
        </header>

        <div role="tablist" className="tabs tabs-boxed w-full justify-start rounded-xl border border-white/[0.08] bg-base-300/25 p-1 sm:w-fit">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className={`tab flex-1 text-[0.9375rem] sm:flex-none ${tab === t.id ? 'tab-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="flex flex-col gap-4">
            <div className="stats stats-vertical w-full rounded-xl border border-white/[0.08] bg-base-200/80 shadow-none lg:stats-horizontal">
              <div className="stat px-4 py-3">
                <div className="stat-title text-xs">样本</div>
                <div className="stat-value font-mono text-2xl">{core.totalTrades} 笔</div>
              </div>
              <div className="stat px-4 py-3">
                <div className="stat-title text-xs">累计盈亏</div>
                <div className={`stat-value font-mono text-2xl ${pnlTone}`}>{fmt$(core.totalPnl)}</div>
              </div>
              <div className="stat px-4 py-3">
                <div className="stat-title text-xs">胜率</div>
                <div className="stat-value font-mono text-2xl">{fmtPct(core.winRate)}</div>
              </div>
              <div className="stat px-4 py-3">
                <div className="stat-title text-xs">盈亏比</div>
                <div className="stat-value font-mono text-2xl">{core.payoff == null ? '—' : core.payoff.toFixed(2)}</div>
              </div>
              <div className="stat px-4 py-3">
                <div className="stat-title text-xs">期望值</div>
                <div className="stat-value font-mono text-2xl">{fmt$(core.expectancy)}</div>
              </div>
              <div className="stat px-4 py-3">
                <div className="stat-title text-xs">最大回撤</div>
                <div className="stat-value font-mono text-2xl text-error">{fmt$(core.maxDrawdown)}</div>
              </div>
              <div className="stat px-4 py-3">
                <div className="stat-title text-xs">利润因子</div>
                <div className="stat-value font-mono text-2xl">{core.profitFactor?.toFixed(2) ?? '—'}</div>
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
            <Card title="概要">
              <ul className="space-y-2 text-sm text-base-content/80">
                <li className="flex justify-between gap-4">
                  <span>胜 / 负</span>
                  <span className="font-mono">
                    {core.winTrades} / {core.lossTrades}
                  </span>
                </li>
                <li className="flex justify-between gap-4">
                  <span>日均笔数</span>
                  <span className="font-mono">{core.tradesPerDay?.toFixed(1) ?? '—'}</span>
                </li>
                <li className="flex justify-between gap-4">
                  <span>多空胜率</span>
                  <span className="font-mono text-right">
                    多 {fmtPct(symbols.directionStats.longWinRate)} · 空 {fmtPct(symbols.directionStats.shortWinRate)}
                  </span>
                </li>
              </ul>
            </Card>
            <Card title="极值交易">
              <div className="space-y-2">
                <div className="flex justify-between rounded-lg bg-success/10 px-3 py-2.5 text-sm">
                  <span className="font-mono">{core.best?.symbol ?? '—'}</span>
                  <span className="font-mono text-success">{fmt$(core.best?.profit)}</span>
                </div>
                <div className="flex justify-between rounded-lg bg-error/10 px-3 py-2.5 text-sm">
                  <span className="font-mono">{core.worst?.symbol ?? '—'}</span>
                  <span className="font-mono text-error">{fmt$(core.worst?.profit)}</span>
                </div>
              </div>
            </Card>
            <Card title="交易对" className="lg:col-span-2">
              <div className="overflow-x-auto">
                <table className="table table-zebra table-sm">
                  <thead>
                    <tr className="text-base-content/55">
                      <th>对</th>
                      <th className="text-right">笔数</th>
                      <th className="text-right">胜率</th>
                      <th className="text-right">盈亏</th>
                    </tr>
                  </thead>
                  <tbody>
                    {symbols.symbolStats.slice(0, 12).map((s) => (
                      <tr key={s.symbol}>
                        <td className="font-mono">{s.symbol}</td>
                        <td className="text-right">{s.trades}</td>
                        <td className={`text-right ${s.winRate >= 0.5 ? 'text-success' : 'text-error'}`}>
                          {fmtPct(s.winRate)}
                        </td>
                        <td className={`text-right font-mono ${s.totalPnl >= 0 ? 'text-success' : 'text-error'}`}>
                          {fmt$(s.totalPnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            </div>
          </div>
        )}

        {tab === 'behavior' && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="交易频率">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-base-content/55">日均笔数</span>
                  <span className="font-mono">{behavior.avgTradesPerDay.toFixed(1)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/55">单日最高</span>
                  <span className="font-mono">{behavior.maxTradesInDay}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/55">快速再开仓</span>
                  <span className="font-mono">{behavior.revengeTradeCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/55">高频交易日</span>
                  <span className="font-mono">{behavior.overtradingDays.length}</span>
                </div>
              </div>
              <p className="text-xs text-base-content/45">快速再开仓：上一笔亏损后 5 分钟内再次开仓。</p>
            </Card>
            <Card title="盈亏后下一笔">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-success/20 bg-success/5 p-3">
                  <div className="text-xs text-base-content/55">上一笔盈利后</div>
                  <div className="font-mono text-xl">{fmtPct(behavior.postWinStats.nextTradeWinRate)}</div>
                  <div className="text-xs text-base-content/55">均盈亏 {fmt$(behavior.postWinStats.avgNextTradePnl)}</div>
                </div>
                <div className="rounded-lg border border-error/20 bg-error/5 p-3">
                  <div className="text-xs text-base-content/55">上一笔亏损后</div>
                  <div className="font-mono text-xl">{fmtPct(behavior.postLossStats.nextTradeWinRate)}</div>
                  <div className="text-xs text-base-content/55">均盈亏 {fmt$(behavior.postLossStats.avgNextTradePnl)}</div>
                </div>
              </div>
            </Card>
            <Card title="纪律评分">
              <div className="flex flex-wrap items-center gap-6">
                <div className="font-mono text-5xl font-bold tabular-nums">{behavior.disciplineScore}</div>
                <ul className="min-w-[12rem] flex-1 space-y-1 text-sm text-base-content/65">
                  <li className="flex justify-between">
                    <span>仓位一致性</span>
                    <span className="font-mono">{behavior.disciplineFactors.consistentSizing}</span>
                  </li>
                  <li className="flex justify-between">
                    <span>频率控制</span>
                    <span className="font-mono">{behavior.disciplineFactors.noOvertrading}</span>
                  </li>
                  <li className="flex justify-between">
                    <span>快速再开仓</span>
                    <span className="font-mono">{behavior.disciplineFactors.noRevengeTrades}</span>
                  </li>
                  <li className="flex justify-between">
                    <span>持仓时长</span>
                    <span className="font-mono">{behavior.disciplineFactors.properHoldingTime}</span>
                  </li>
                </ul>
              </div>
            </Card>
            <Card title="最近亏损">
              <ul className="max-h-52 space-y-1.5 overflow-y-auto text-sm">
                {recentLosses.length === 0 ? (
                  <li className="text-base-content/45">暂无</li>
                ) : (
                  recentLosses.map((t) => (
                    <li key={t.id} className="flex justify-between rounded-md bg-base-300/25 px-3 py-2">
                      <span className="font-mono">{t.symbol}</span>
                      <span className="font-mono text-error">{fmt$(t.profit)}</span>
                    </li>
                  ))
                )}
              </ul>
            </Card>
          </div>
        )}

        {tab === 'time' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="按小时" className="lg:col-span-2">
              <p className="text-xs text-base-content/45 -mt-1">柱高 = 笔数，颜色 = 胜率</p>
              <HourStrip stats={time.hourlyStats} />
              <p className="text-sm text-base-content/55">
                最佳 {time.bestHour ?? '—'}:00 · 最差 {time.worstHour ?? '—'}:00
              </p>
            </Card>
            <Card title="持仓时长">
              <div className="stats stats-vertical rounded-lg border border-white/[0.06] bg-base-300/20 shadow-none sm:stats-horizontal">
                <div className="stat py-2">
                  <div className="stat-title text-xs">&lt;30 分</div>
                  <div className="stat-value font-mono text-lg">{fmtPct(time.holdingTimeStats.shortTermWinRate)}</div>
                </div>
                <div className="stat py-2">
                  <div className="stat-title text-xs">30 分~4 时</div>
                  <div className="stat-value font-mono text-lg">{fmtPct(time.holdingTimeStats.mediumTermWinRate)}</div>
                </div>
                <div className="stat py-2">
                  <div className="stat-title text-xs">&gt;4 时</div>
                  <div className="stat-value font-mono text-lg">{fmtPct(time.holdingTimeStats.longTermWinRate)}</div>
                </div>
              </div>
              <p className="text-sm text-base-content/55">平均 {Math.round(time.holdingTimeStats.avgHoldingMinutes)} 分钟</p>
            </Card>
            <Card title="按星期">
              <ul className="divide-y divide-white/[0.06]">
                {time.weekdayStats.map((w) => (
                  <li key={w.day} className="flex items-center gap-3 py-2 text-sm first:pt-0 last:pb-0">
                    <span className="w-10 shrink-0">{w.dayName}</span>
                    <span className={`min-w-0 flex-1 font-mono ${w.totalPnl >= 0 ? 'text-success' : 'text-error'}`}>
                      {fmt$(w.totalPnl)}
                    </span>
                    <span className="shrink-0 text-base-content/45">{w.trades} 笔</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}

        {tab === 'risk' && (
          <div className="flex flex-col gap-4">
            <div className="stats stats-vertical w-full rounded-xl border border-white/[0.08] bg-base-200/80 shadow-none sm:stats-horizontal">
              <div className="stat px-4 py-3">
                <div className="stat-title text-xs">最大连胜</div>
                <div className="stat-value font-mono text-2xl">{risk.maxConsecutiveWins}</div>
              </div>
              <div className="stat px-4 py-3">
                <div className="stat-title text-xs">最大连亏</div>
                <div className="stat-value font-mono text-2xl text-error">{risk.maxConsecutiveLosses}</div>
              </div>
              <div className="stat px-4 py-3">
                <div className="stat-title text-xs">夏普比率</div>
                <div className="stat-value font-mono text-2xl">{risk.sharpeRatio?.toFixed(2) ?? '—'}</div>
              </div>
              <div className="stat px-4 py-3">
                <div className="stat-title text-xs">盈利/最大回撤</div>
                <div className="stat-value font-mono text-2xl">{risk.profitToMaxDrawdown?.toFixed(2) ?? '—'}</div>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Card title="盈亏分布">
                <p className="font-mono text-lg">中位数 {fmt$(risk.pnlDistribution.median)}</p>
                <p className="text-sm text-base-content/55">标准差 {fmt$(risk.pnlDistribution.stdDev)}</p>
              </Card>
              <Card title="当前连续">
                {risk.currentStreak.type === 'none' ? (
                  <span className="text-base-content/45">—</span>
                ) : (
                  <p className="text-lg">
                    {risk.currentStreak.type === 'win' ? '连胜' : '连亏'}{' '}
                    <span className="font-mono font-semibold">{risk.currentStreak.count}</span> 笔
                  </p>
                )}
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}