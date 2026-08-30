import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AnalysisInsights from '../components/AnalysisInsights';
import EmptyDataset from '../components/EmptyDataset';
import TagAnalysisPanel from '../components/analysis/TagAnalysisPanel';
import EquityCurve from '../components/analysis/EquityCurve';
import { BarRow } from '../components/analysis/BarRow';
import ReviewPanel from '../components/analysis/ReviewPanel';
import { useDataset } from '../context/DatasetContext';
import { fetchTradesWithTotal } from '../services/api';
import type { Trade } from '../services/api';
import { fmtMoney, fmtPct } from '../utils/format';
import {
  analyzeTimePatterns,
  analyzeBehavior,
  analyzeRisk,
  analyzeSymbols,
  localDateKey,
  type TimeAnalysis,
} from '../utils/tradeAnalysis';

type TabId = 'overview' | 'behavior' | 'time' | 'risk' | 'tags' | 'review';

const TAB_IDS: TabId[] = ['overview', 'behavior', 'time', 'risk', 'tags', 'review'];

const PAGE_LIMIT = 2000;
const MAX_PAGES = 5;

function isTabId(v: string | null): v is TabId {
  return v != null && TAB_IDS.includes(v as TabId);
}

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`oc-card oc-card--bordered ${className}`}>
      <h2 className="oc-card__title">{title}</h2>
      {children}
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
    let peak = 0; // anchored at starting equity
    let maxDd = 0;
    let cum = 0;
    sorted.forEach((t) => {
      cum += t.profit ?? 0;
      peak = Math.max(peak, cum);
      maxDd = Math.min(maxDd, cum - peak);
    });

    const days = new Set<string>();
    rows.forEach((t) => {
      days.add(localDateKey(t.entry_time));
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
          className="flex h-12 items-end justify-center rounded-sm bg-[var(--surface-base-active)]"
        >
          <div
            className={`w-full rounded-t-sm ${h.winRate >= 0.5 ? 'bg-[var(--oc-profit)]/70' : h.trades ? 'bg-[var(--oc-loss)]/60' : 'bg-transparent'}`}
            style={{ height: `${Math.max(10, (h.trades / max) * 100)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

export default function AnalysisPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const tabParam = searchParams.get('tab');
  const tab: TabId = isTabId(tabParam) ? tabParam : 'overview';
  const setTab = (next: TabId) => setSearchParams({ tab: next }, { replace: true });
  // §七 下钻：报表行点击 → 复盘引擎锁定该交易/币种
  const drillTrade = (t: Trade) => navigate(`/replay?symbol=${encodeURIComponent(t.symbol)}&trade=${t.id}`);
  const drillSymbol = (symbol: string) => navigate(`/replay?symbol=${encodeURIComponent(symbol)}`);

  const {
    activeDatasetId,
    tradesRevision,
    loading: datasetsLoading,
    error: datasetsError,
  } = useDataset();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (activeDatasetId == null) return;
    // The paged fetch spans several requests; drop its result if the dataset changed.
    let ignore = false;
    setLoading(true);
    setError(null);
    fetchTradesWithTotal(undefined, { limit: PAGE_LIMIT, maxPages: MAX_PAGES })
      .then((res) => {
        if (ignore) return;
        setTrades(res.trades);
        setTotal(res.total);
      })
      .catch((err) => {
        if (!ignore) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [activeDatasetId, tradesRevision]);

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

  const truncated = total > trades.length;
  const pnlTone = core.totalPnl >= 0 ? 'oc-text-profit' : 'oc-text-loss';
  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: '总览' },
    { id: 'behavior', label: '行为' },
    { id: 'time', label: '时间' },
    { id: 'risk', label: '风险' },
    { id: 'tags', label: '标签' },
    { id: 'review', label: '复盘' },
  ];

  if (datasetsLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="oc-spinner oc-spinner--md" aria-label="加载中…" />
      </div>
    );
  }

  if (datasetsError) {
    return (
      <EmptyDataset
        title="表格列表加载失败"
        steps={[datasetsError, '确认后端已启动，然后刷新页面重试']}
      />
    );
  }

  // 标签/复盘 tab 跨数据集聚合（默认 self），不依赖当前数据集（docs/PRODUCT.md §七）
  const datasetDependent = tab !== 'tags' && tab !== 'review';

  if (datasetDependent && activeDatasetId == null) {
    return <EmptyDataset title="导入数据后开始分析" />;
  }

  if (datasetDependent && loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="oc-spinner oc-spinner--md" />
      </div>
    );
  }
  if (datasetDependent && error) {
    return (
      <div className="p-4 text-[14px] oc-text-loss" role="alert">
        加载失败：{error}。请检查后端是否运行，或重新导入数据集。
      </div>
    );
  }

  return (
    <div className="oc-page oc-enter flex h-full min-h-0 flex-1 flex-col overflow-hidden p-2">
      <div className="oc-page__frame mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 overflow-y-auto p-4">
        <header>
          <h1 className="text-[20px] font-medium tracking-tight text-wrap-balance">分析</h1>
          <p className="mt-1 text-[13px] oc-text-faint">
            {core.totalTrades} 笔样本 · 累计 {fmtMoney(core.totalPnl)} U
          </p>
          {truncated && (
            <p className="mt-1 text-[12px] oc-text-faint">
              共 {total} 笔，仅统计最近 {trades.length} 笔交易，更早的记录未纳入本页分析。
            </p>
          )}
        </header>

        <AnalysisInsights
          winRate={core.winRate}
          profitFactor={core.profitFactor}
          expectancy={core.expectancy}
          maxDrawdown={core.maxDrawdown}
          revengeTradeCount={behavior.revengeTradeCount}
          tradesPerDay={core.tradesPerDay}
        />

        <div role="tablist" aria-label="分析维度" className="oc-tabs w-full sm:w-fit">
          {tabs.map((t) => (
            <button
              key={t.id}
              id={`analysis-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`analysis-panel-${t.id}`}
              className={`oc-tab flex-1 sm:flex-none${tab === t.id ? ' oc-tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div id="analysis-panel-overview" role="tabpanel" aria-labelledby="analysis-tab-overview" className="flex flex-col gap-4">
            <div className="oc-stat-grid oc-stat-grid--auto">
              <div className="oc-stat">
                <div className="oc-stat__label">样本</div>
                <div className="oc-stat__value">{core.totalTrades} 笔</div>
              </div>
              <div className="oc-stat">
                <div className="oc-stat__label">累计盈亏</div>
                <div className={`oc-stat__value ${pnlTone}`}>{fmtMoney(core.totalPnl)}</div>
              </div>
              <div className="oc-stat">
                <div className="oc-stat__label">胜率</div>
                <div className="oc-stat__value">{fmtPct(core.winRate)}</div>
              </div>
              <div className="oc-stat">
                <div className="oc-stat__label">盈亏比</div>
                <div className="oc-stat__value">{core.payoff == null ? '—' : core.payoff.toFixed(2)}</div>
              </div>
              <div className="oc-stat">
                <div className="oc-stat__label">期望值</div>
                <div className="oc-stat__value">{fmtMoney(core.expectancy)}</div>
              </div>
              <div className="oc-stat">
                <div className="oc-stat__label">最大回撤</div>
                <div className="oc-stat__value oc-text-loss">{fmtMoney(core.maxDrawdown)}</div>
              </div>
              <div className="oc-stat">
                <div className="oc-stat__label">利润因子</div>
                <div className="oc-stat__value">{core.profitFactor?.toFixed(2) ?? '—'}</div>
              </div>
            </div>
            <Card title="权益曲线（累计盈亏）">
              <EquityCurve trades={trades} />
            </Card>
            <div className="grid gap-4 lg:grid-cols-2">
            <Card title="概要">
              <div className="space-y-3 text-[12px]">
                <div>
                  <div className="mb-1 flex justify-between oc-text-faint">
                    <span>胜 / 负</span>
                    <span className="font-mono">
                      {core.winTrades} / {core.lossTrades}
                    </span>
                  </div>
                  <div className="flex h-4 overflow-hidden bg-[var(--surface-base)]">
                    <div
                      className="h-full bg-[var(--oc-profit)]/70"
                      style={{ width: `${core.totalTrades ? (core.winTrades / core.totalTrades) * 100 : 0}%` }}
                      title={`胜 ${core.winTrades}`}
                    />
                    <div
                      className="h-full bg-[var(--oc-loss)]/60"
                      style={{ width: `${core.totalTrades ? (core.lossTrades / core.totalTrades) * 100 : 0}%` }}
                      title={`负 ${core.lossTrades}`}
                    />
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex justify-between oc-text-faint">
                    <span>多空胜率</span>
                    <span className="font-mono">
                      多 {fmtPct(symbols.directionStats.longWinRate)} · 空 {fmtPct(symbols.directionStats.shortWinRate)}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <BarRow
                      label="多"
                      value={symbols.directionStats.longWinRate ?? 0}
                      maxAbs={1}
                      secondary={fmtPct(symbols.directionStats.longWinRate)}
                      positive={(symbols.directionStats.longWinRate ?? 0) >= 0.5}
                    />
                    <BarRow
                      label="空"
                      value={symbols.directionStats.shortWinRate ?? 0}
                      maxAbs={1}
                      secondary={fmtPct(symbols.directionStats.shortWinRate)}
                      positive={(symbols.directionStats.shortWinRate ?? 0) >= 0.5}
                    />
                  </div>
                </div>
                <div className="flex justify-between oc-text-faint">
                  <span>日均笔数</span>
                  <span className="font-mono">{core.tradesPerDay?.toFixed(1) ?? '—'}</span>
                </div>
              </div>
            </Card>
            <Card title="极值交易">
              <div className="space-y-1.5">
                <BarRow
                  label={core.best?.symbol ?? '—'}
                  value={core.best?.profit ?? 0}
                  maxAbs={Math.max(Math.abs(core.best?.profit ?? 0), Math.abs(core.worst?.profit ?? 0), 1)}
                  secondary={fmtMoney(core.best?.profit)}
                  positive
                  onClick={core.best ? () => drillTrade(core.best!) : undefined}
                />
                <BarRow
                  label={core.worst?.symbol ?? '—'}
                  value={core.worst?.profit ?? 0}
                  maxAbs={Math.max(Math.abs(core.best?.profit ?? 0), Math.abs(core.worst?.profit ?? 0), 1)}
                  secondary={fmtMoney(core.worst?.profit)}
                  positive={false}
                  onClick={core.worst ? () => drillTrade(core.worst!) : undefined}
                />
              </div>
            </Card>
            <Card title="交易对" className="lg:col-span-2">
              <div className="space-y-1.5">
                {symbols.symbolStats.slice(0, 12).map((s) => (
                  <BarRow
                    key={s.symbol}
                    label={s.symbol}
                    value={s.totalPnl}
                    maxAbs={Math.max(...symbols.symbolStats.slice(0, 12).map((x) => Math.abs(x.totalPnl)), 1)}
                    secondary={fmtMoney(s.totalPnl)}
                    positive={s.totalPnl >= 0}
                    title={`${s.trades} 笔 · 胜率 ${fmtPct(s.winRate)}`}
                    onClick={() => drillSymbol(s.symbol)}
                  />
                ))}
              </div>
            </Card>
            </div>
          </div>
        )}

        {tab === 'behavior' && (
          <div id="analysis-panel-behavior" role="tabpanel" aria-labelledby="analysis-tab-behavior" className="grid gap-4 md:grid-cols-2">
            <Card title="交易频率">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="oc-text-faint">日均笔数</span>
                  <span className="font-mono">{behavior.avgTradesPerDay.toFixed(1)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="oc-text-faint">单日最高</span>
                  <span className="font-mono">{behavior.maxTradesInDay}</span>
                </div>
                <div className="flex justify-between">
                  <span className="oc-text-faint">快速再开仓</span>
                  <span className="font-mono">{behavior.revengeTradeCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="oc-text-faint">高频交易日</span>
                  <span className="font-mono">{behavior.overtradingDays.length}</span>
                </div>
              </div>
              <p className="text-[12px] oc-text-faint">快速再开仓：上一笔亏损后 5 分钟内再次开仓。</p>
            </Card>
            <Card title="盈亏后下一笔">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-[var(--border-weaker-base)] oc-surface-success p-3">
                  <div className="text-[12px] oc-text-faint">上一笔盈利后</div>
                  <div className="font-mono text-[20px]">{fmtPct(behavior.postWinStats.nextTradeWinRate)}</div>
                  <div className="text-[12px] oc-text-faint">均盈亏 {fmtMoney(behavior.postWinStats.avgNextTradePnl)}</div>
                </div>
                <div className="rounded-md border border-[var(--border-weaker-base)] oc-surface-error p-3">
                  <div className="text-[12px] oc-text-faint">上一笔亏损后</div>
                  <div className="font-mono text-[20px]">{fmtPct(behavior.postLossStats.nextTradeWinRate)}</div>
                  <div className="text-[12px] oc-text-faint">均盈亏 {fmtMoney(behavior.postLossStats.avgNextTradePnl)}</div>
                </div>
              </div>
            </Card>
            <Card title="纪律评分">
              <div className="flex flex-wrap items-center gap-6">
                <div className="font-mono text-5xl font-bold tabular-nums">{behavior.disciplineScore}</div>
                <ul className="min-w-[12rem] flex-1 space-y-1 text-[13px] oc-text-muted">
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
                  <li className="oc-text-faint">暂无</li>
                ) : (
                  recentLosses.map((t) => (
                    <li key={t.id} className="flex justify-between rounded-md bg-[var(--surface-base-active)] px-3 py-2">
                      <span className="font-mono">{t.symbol}</span>
                      <span className="font-mono oc-text-loss">{fmtMoney(t.profit)}</span>
                    </li>
                  ))
                )}
              </ul>
            </Card>
          </div>
        )}

        {tab === 'time' && (
          <div id="analysis-panel-time" role="tabpanel" aria-labelledby="analysis-tab-time" className="grid gap-4 lg:grid-cols-2">
            <Card title="按小时" className="lg:col-span-2">
              <p className="-mt-1 text-[12px] oc-text-faint">柱高 = 笔数，颜色 = 胜率</p>
              <HourStrip stats={time.hourlyStats} />
              <p className="text-[13px] oc-text-muted">
                最佳 {time.bestHour ?? '—'}:00 · 最差 {time.worstHour ?? '—'}:00
              </p>
            </Card>
            <Card title="持仓时长">
              <div className="oc-stat-grid oc-stat-grid--cols-4">
                <div className="oc-stat">
                  <div className="oc-stat__label">&lt;30 分</div>
                  <div className="oc-stat__value text-[18px]">{fmtPct(time.holdingTimeStats.shortTermWinRate)}</div>
                </div>
                <div className="oc-stat">
                  <div className="oc-stat__label">30 分~4 时</div>
                  <div className="oc-stat__value text-[18px]">{fmtPct(time.holdingTimeStats.mediumTermWinRate)}</div>
                </div>
                <div className="oc-stat">
                  <div className="oc-stat__label">&gt;4 时</div>
                  <div className="oc-stat__value text-[18px]">{fmtPct(time.holdingTimeStats.longTermWinRate)}</div>
                </div>
              </div>
              <p className="text-[13px] oc-text-muted">平均 {Math.round(time.holdingTimeStats.avgHoldingMinutes)} 分钟</p>
            </Card>
            <Card title="按星期">
              <ul className="divide-y divide-[var(--border-weaker-base)]">
                {time.weekdayStats.map((w) => (
                  <li key={w.day} className="flex items-center gap-3 py-2 text-[13px] first:pt-0 last:pb-0">
                    <span className="w-10 shrink-0">{w.dayName}</span>
                    <span className={`min-w-0 flex-1 font-mono ${w.totalPnl >= 0 ? 'oc-text-profit' : 'oc-text-loss'}`}>
                      {fmtMoney(w.totalPnl)}
                    </span>
                    <span className="shrink-0 oc-text-faint">{w.trades} 笔</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}

        {tab === 'risk' && (
          <div id="analysis-panel-risk" role="tabpanel" aria-labelledby="analysis-tab-risk" className="flex flex-col gap-4">
            <div className="oc-stat-grid oc-stat-grid--cols-4">
              <div className="oc-stat">
                <div className="oc-stat__label">最大连胜</div>
                <div className="oc-stat__value">{risk.maxConsecutiveWins}</div>
              </div>
              <div className="oc-stat">
                <div className="oc-stat__label">最大连亏</div>
                <div className="oc-stat__value oc-text-loss">{risk.maxConsecutiveLosses}</div>
              </div>
              <div className="oc-stat">
                <div className="oc-stat__label">夏普比率</div>
                <div className="oc-stat__value">{risk.sharpeRatio?.toFixed(2) ?? '—'}</div>
              </div>
              <div className="oc-stat">
                <div className="oc-stat__label">盈利/最大回撤</div>
                <div className="oc-stat__value">{risk.profitToMaxDrawdown?.toFixed(2) ?? '—'}</div>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Card title="盈亏分布">
                <p className="font-mono text-lg">中位数 {fmtMoney(risk.pnlDistribution.median)}</p>
                <p className="text-[13px] oc-text-muted">标准差 {fmtMoney(risk.pnlDistribution.stdDev)}</p>
              </Card>
              <Card title="当前连续">
                {risk.currentStreak.type === 'none' ? (
                  <span className="oc-text-faint">—</span>
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
        {tab === 'tags' && (
          <div id="analysis-panel-tags" role="tabpanel" aria-labelledby="analysis-tab-tags" className="flex flex-col gap-4">
            <TagAnalysisPanel />
          </div>
        )}

        {tab === 'review' && (
          <div id="analysis-panel-review" role="tabpanel" aria-labelledby="analysis-tab-review" className="flex flex-col gap-4">
            <ReviewPanel />
          </div>
        )}
      </div>
    </div>
  );
}