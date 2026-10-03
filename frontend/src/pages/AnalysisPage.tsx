import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AnalysisInsights from '../components/AnalysisInsights';
import EmptyDataset from '../components/EmptyDataset';
import TagAnalysisPanel from '../components/analysis/TagAnalysisPanel';
import EquityCurve from '../components/analysis/EquityCurve';
import { BarRow } from '../components/analysis/BarRow';
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

type TabId = 'overview' | 'behavior' | 'time' | 'risk' | 'tags';

const TAB_IDS: TabId[] = ['overview', 'behavior', 'time', 'risk', 'tags'];

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
          className="flex h-control-nav items-end justify-center rounded-none bg-[var(--surface-base-active)]"
        >
          <div
            className={`w-full rounded-none ${h.winRate >= 0.5 ? 'bg-[var(--oc-profit)]/70' : h.trades ? 'bg-[var(--oc-loss)]/60' : 'bg-transparent'}`}
            style={{ height: `${Math.max(10, (h.trades / max) * 100)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * 日历热力图（P§七 图表化拉满）：tradeAnalysis 已算出 `time.dailyPnl`，
 * 此前从未渲染（死代码）。颜色深度 = 当日盈亏绝对值，绿盈红亏。
 */
function CalendarHeatmap({ days }: { days: TimeAnalysis['dailyPnl'] }) {
  const maxAbs = Math.max(...days.map((d) => Math.abs(d.pnl)), 0);
  if (days.length === 0) return <p className="text-oc-12 oc-text-faint">暂无平仓记录</p>;
  return (
    <div className="flex flex-wrap gap-1">
      {days.map((d) => {
        const ratio = maxAbs > 0 ? Math.abs(d.pnl) / maxAbs : 0;
        const alpha = 0.18 + ratio * 0.82;
        const bg = d.pnl >= 0 ? `rgba(48, 209, 88, ${alpha})` : `rgba(255, 59, 48, ${alpha})`;
        return (
          <div
            key={d.date}
            title={`${d.date} · ${d.trades} 笔 · ${fmtMoney(d.pnl)} U`}
            className="h-control-sm w-control-sm shrink-0 rounded-none border border-[var(--border-weaker-base)]"
            style={{ background: bg }}
          />
        );
      })}
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
  // 分布桶按最高占比归一（横条图以最大桶为满宽）
  const maxBucketPct = useMemo(
    () => Math.max(...risk.pnlDistribution.buckets.map((b) => b.percentage), 0),
    [risk],
  );
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

  // 标签 tab 跨数据集聚合（默认 self），不依赖当前数据集（docs/PRODUCT.md §七）
  const datasetDependent = tab !== 'tags';

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
      <div className="p-4 text-oc-14 oc-text-loss" role="alert">
        加载失败：{error}。请检查后端是否运行，或重新导入数据集。
      </div>
    );
  }

  return (
    <div className="oc-page oc-enter flex h-full min-h-0 flex-1 flex-col overflow-hidden p-2">
      {/* §2.1 单视口：全部信息落在一屏内，禁止页面级/框架级滚动。
          去掉 max-w-6xl：1440px 下曾白掉 272px 横向空间，密度反而更低。 */}
      <div className="oc-page__frame gap-oc-2 flex min-h-0 w-full flex-1 flex-col overflow-hidden p-oc-2">
        <header className="flex shrink-0 flex-wrap items-baseline gap-x-oc-3 gap-y-oc-1">
          <h1 className="text-oc-16 font-medium tracking-tight">分析</h1>
          <p className="text-oc-12 oc-text-faint">
            {core.totalTrades} 笔样本 · 累计 {fmtMoney(core.totalPnl)} U
          </p>
          {truncated && (
            <p className="text-oc-12 oc-text-faint">共 {total} 笔，仅统计最近 {trades.length} 笔。</p>
          )}
          <div role="tablist" aria-label="分析维度" className="oc-tabs oc-tabs--wrap ml-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                id={`analysis-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`analysis-panel-${t.id}`}
                className={`oc-tab${tab === t.id ? ' oc-tab--active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </header>

        <div className="oc-stat-grid oc-stat-grid--cols-7 shrink-0">
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
            <div className="oc-stat__value">{core.payoff == null ? '\u2014' : core.payoff.toFixed(2)}</div>
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
            <div className="oc-stat__value">{core.profitFactor?.toFixed(2) ?? '\u2014'}</div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
        {tab === 'overview' && (
          <div id="analysis-panel-overview" role="tabpanel" aria-labelledby="analysis-tab-overview" className="gap-oc-2 grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-3">
            <div className="oc-card oc-card--bordered min-h-0 overflow-hidden lg:col-span-2">
              <h2 className="oc-card__title">权益曲线（累计盈亏）</h2>
              <EquityCurve trades={trades} fill />
            </div>

            <div className="oc-fill-grid gap-oc-2 grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden">
              <Card title="极值交易">
                <div className="space-y-1">
                  <BarRow
                    label={core.best?.symbol ?? '\u2014'}
                    value={core.best?.profit ?? 0}
                    maxAbs={Math.max(Math.abs(core.best?.profit ?? 0), Math.abs(core.worst?.profit ?? 0), 1)}
                    secondary={fmtMoney(core.best?.profit)}
                    positive
                    onClick={core.best ? () => drillTrade(core.best!) : undefined}
                  />
                  <BarRow
                    label={core.worst?.symbol ?? '\u2014'}
                    value={core.worst?.profit ?? 0}
                    maxAbs={Math.max(Math.abs(core.best?.profit ?? 0), Math.abs(core.worst?.profit ?? 0), 1)}
                    secondary={fmtMoney(core.worst?.profit)}
                    positive={false}
                    onClick={core.worst ? () => drillTrade(core.worst!) : undefined}
                  />
                </div>
              </Card>
              <Card title="概要">
                <div className="space-y-oc-2 text-oc-12">
                  <div>
                    <div className="mb-1 flex justify-between oc-text-faint">
                      <span>胜 / 负</span>
                      <span className="font-mono">
                        {core.winTrades} / {core.lossTrades}
                      </span>
                    </div>
                    <div className="flex h-3 overflow-hidden bg-[var(--surface-base)]">
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
                    <span className="font-mono">{core.tradesPerDay?.toFixed(1) ?? '\u2014'}</span>
                  </div>
                </div>
              </Card>
              <Card title="交易对" className="min-h-0 overflow-hidden">
                <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
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
          <div id="analysis-panel-behavior" role="tabpanel" aria-labelledby="analysis-tab-behavior" className="gap-oc-2 grid min-h-0 flex-1 auto-rows-fr grid-cols-1 md:grid-cols-2">
            <Card title="交易频率">
              <AnalysisInsights
                winRate={core.winRate}
                profitFactor={core.profitFactor}
                expectancy={core.expectancy}
                maxDrawdown={core.maxDrawdown}
                revengeTradeCount={behavior.revengeTradeCount}
                tradesPerDay={core.tradesPerDay}
              />
              <div className="grid grid-cols-2 gap-x-oc-4 gap-y-oc-2 text-oc-13">
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
            </Card>
            <Card title="盈亏后下一笔">
              <div className="grid grid-cols-1 gap-oc-2 sm:grid-cols-2">
                <div className="rounded-none border border-[var(--border-weaker-base)] oc-surface-success p-oc-2">
                  <div className="text-oc-12 oc-text-faint">上一笔盈利后</div>
                  <div className="font-mono text-oc-20">{fmtPct(behavior.postWinStats.nextTradeWinRate)}</div>
                  <div className="text-oc-12 oc-text-faint">
                    均盈亏 {fmtMoney(behavior.postWinStats.avgNextTradePnl)}
                    {behavior.postWinStats.tendToOversize ? ' · 倾向加大仓位' : ''}
                  </div>
                </div>
                <div className="rounded-none border border-[var(--border-weaker-base)] oc-surface-error p-oc-2">
                  <div className="text-oc-12 oc-text-faint">上一笔亏损后</div>
                  <div className="font-mono text-oc-20">{fmtPct(behavior.postLossStats.nextTradeWinRate)}</div>
                  <div className="text-oc-12 oc-text-faint">
                    均盈亏 {fmtMoney(behavior.postLossStats.avgNextTradePnl)}
                    {behavior.postLossStats.tendToRevenge ? ' · 倾向报复性再开仓' : ''}
                  </div>
                </div>
              </div>
            </Card>
            <Card title="纪律评分">
              <div className="flex flex-wrap items-center gap-oc-5">
                <div className="font-mono text-oc-display font-bold tabular-nums">{behavior.disciplineScore}</div>
                <ul className="min-w-[12rem] flex-1 space-y-1 text-oc-13 oc-text-muted">
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
            <Card title="最近亏损" className="min-h-0 overflow-hidden">
              <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto text-oc-13">
                {recentLosses.length === 0 ? (
                  <li className="oc-text-faint">暂无</li>
                ) : (
                  recentLosses.map((t) => (
                    <li key={t.id} className="flex justify-between rounded-none bg-[var(--surface-base-active)] px-oc-3 py-1">
                      <span className="font-mono">{t.symbol}</span>
                      <span className="font-mono oc-text-loss">{fmtMoney(t.profit)}</span>
                    </li>
                  ))
                )}
              </ul>
            </Card>

            {/* 报复性交易逐笔：行为分析已算出（含距上次亏损分钟数），此前从未渲染 */}
            <Card title={`报复性交易（亏损后 5 分钟内再开仓 · 胜率 ${fmtPct(behavior.revengeTradeWinRate)}）`} className="min-h-0 overflow-hidden">
              <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto text-oc-13">
                {behavior.revengeTrades.length === 0 ? (
                  <li className="oc-text-faint">没有亏损后立即再开仓的记录。</li>
                ) : (
                  behavior.revengeTrades.map((r) => (
                    <li
                      key={r.trade.id}
                      className="flex items-center justify-between gap-oc-2 rounded-none bg-[var(--surface-base-active)] px-oc-3 py-1"
                    >
                      <span className="min-w-0 truncate font-mono">
                        {r.trade.symbol} · 距上次亏损 {Math.round(r.timeSinceLastLoss)} 分
                      </span>
                      <span className={`shrink-0 font-mono ${(r.trade.profit ?? 0) >= 0 ? 'oc-text-profit' : 'oc-text-loss'}`}>
                        {fmtMoney(r.trade.profit)}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </Card>

            {/* 高频交易日：overtradingDays 已算出（日期/笔数/盈亏），此前只用了 .length */}
            <Card title={`高频交易日（共 ${behavior.overtradingDays.length} 天）`} className="min-h-0 overflow-hidden">
              <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto text-oc-13">
                {behavior.overtradingDays.length === 0 ? (
                  <li className="oc-text-faint">没有异常高频的交易日。</li>
                ) : (
                  behavior.overtradingDays.map((d) => (
                    <li
                      key={d.date}
                      className="flex items-center justify-between rounded-none bg-[var(--surface-base-active)] px-oc-3 py-1"
                    >
                      <span className="font-mono">{d.date}</span>
                      <span className="font-mono oc-text-faint">{d.tradeCount} 笔</span>
                      <span className={`font-mono ${d.pnl >= 0 ? 'oc-text-profit' : 'oc-text-loss'}`}>
                        {fmtMoney(d.pnl)}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </Card>
          </div>
        )}

        {tab === 'time' && (
          <div id="analysis-panel-time" role="tabpanel" aria-labelledby="analysis-tab-time" className="gap-oc-2 grid min-h-0 flex-1 auto-rows-fr grid-cols-1 lg:grid-cols-3">
            <Card title="按小时" className="lg:col-span-3">
              <p className="text-oc-12 oc-text-faint">柱高 = 笔数，颜色 = 胜率</p>
              <HourStrip stats={time.hourlyStats} />
              <p className="text-oc-13 oc-text-muted">
                最佳 {time.bestHour ?? '\u2014'}:00 · 最差 {time.worstHour ?? '\u2014'}:00
              </p>
            </Card>
            <Card title="交易日历（颜色深浅 = 当日盈亏幅度）" className="lg:col-span-3">
              <CalendarHeatmap days={time.dailyPnl} />
            </Card>
            <Card title="持仓时长" className="lg:col-span-2">
              <div className="oc-stat-grid oc-stat-grid--cols-3">
                <div className="oc-stat">
                  <div className="oc-stat__label">&lt;30 分</div>
                  <div className="oc-stat__value text-oc-16">{fmtPct(time.holdingTimeStats.shortTermWinRate)}</div>
                </div>
                <div className="oc-stat">
                  <div className="oc-stat__label">30 分~4 时</div>
                  <div className="oc-stat__value text-oc-16">{fmtPct(time.holdingTimeStats.mediumTermWinRate)}</div>
                </div>
                <div className="oc-stat">
                  <div className="oc-stat__label">&gt;4 时</div>
                  <div className="oc-stat__value text-oc-16">{fmtPct(time.holdingTimeStats.longTermWinRate)}</div>
                </div>
              </div>
              <p className="text-oc-13 oc-text-muted">平均 {Math.round(time.holdingTimeStats.avgHoldingMinutes)} 分钟</p>
            </Card>
            <Card title={`按星期（最佳 ${time.bestWeekday ?? '\u2014'} · 最差 ${time.worstWeekday ?? '\u2014'}）`} className="min-h-0 overflow-hidden">
              <ul className="min-h-0 flex-1 divide-y divide-[var(--border-weaker-base)] overflow-y-auto">
                {time.weekdayStats.map((w) => (
                  <li key={w.day} className="flex items-center gap-oc-3 py-1 text-oc-13">
                    <span className="w-10 shrink-0">{w.dayName}</span>
                    <span className={`min-w-0 flex-1 font-mono ${w.totalPnl >= 0 ? 'oc-text-profit' : 'oc-text-loss'}`}>
                      {fmtMoney(w.totalPnl)}
                    </span>
                    <span className="shrink-0 font-mono oc-text-faint">
                      {w.classifiedTrades > 0 ? fmtPct(w.winRate) : '\u2014'}
                    </span>
                    <span className="shrink-0 oc-text-faint">{w.trades} 笔</span>
                  </li>
                ))}
              </ul>
            </Card>

            {/* 时段明细：hourlyStats 的 winRate/avgPnl 此前只用于柱状图 tooltip，未列表呈现
                （P§七 图表化拉满，但精确数值仍需可读表格） */}
            <Card title="时段明细（按累计盈亏）" className="min-h-0 overflow-hidden lg:col-span-3">
              <div className="min-h-0 flex-1 overflow-y-auto">
                <ul className="divide-y divide-[var(--border-weaker-base)]">
                  {[...time.hourlyStats]
                    .filter((h) => h.trades > 0)
                    .sort((a, b) => b.totalPnl - a.totalPnl)
                    .map((h) => (
                      <li key={h.hour} className="flex items-center gap-oc-3 py-1 text-oc-13">
                        <span className="w-12 shrink-0 font-mono">{String(h.hour).padStart(2, '0')}:00</span>
                        <span className={`w-24 shrink-0 text-right font-mono ${h.totalPnl >= 0 ? 'oc-text-profit' : 'oc-text-loss'}`}>
                          {fmtMoney(h.totalPnl)}
                        </span>
                        <span className="w-20 shrink-0 text-right font-mono oc-text-faint">
                          {h.classifiedTrades > 0 ? fmtPct(h.winRate) : '\u2014'}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-oc-12 oc-text-faint">
                          {h.trades} 笔 · 均 {fmtMoney(h.avgPnl)}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            </Card>
          </div>
        )}

        {tab === 'risk' && (
          <div id="analysis-panel-risk" role="tabpanel" aria-labelledby="analysis-tab-risk" className="gap-oc-2 grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] max-lg:overflow-y-auto">
            <div className="oc-stat-grid oc-stat-grid--cols-7">
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
                <div className="oc-stat__value">{risk.sharpeRatio?.toFixed(2) ?? '\u2014'}</div>
              </div>
              <div className="oc-stat">
                <div className="oc-stat__label">索提诺比率</div>
                <div className="oc-stat__value">{risk.sortinoRatio?.toFixed(2) ?? '\u2014'}</div>
              </div>
              <div className="oc-stat">
                <div className="oc-stat__label">卡玛比率</div>
                <div className="oc-stat__value">{risk.calmarRatio?.toFixed(2) ?? '\u2014'}</div>
              </div>
              <div className="oc-stat">
                <div className="oc-stat__label">盈利/最大回撤</div>
                <div className="oc-stat__value">{risk.profitToMaxDrawdown?.toFixed(2) ?? '\u2014'}</div>
              </div>
              <div className="oc-stat">
                <div className="oc-stat__label">当前连续</div>
                <div className="oc-stat__value">
                  {risk.currentStreak.type === 'none'
                    ? '\u2014'
                    : `${risk.currentStreak.type === 'win' ? '连胜' : '连亏'} ${risk.currentStreak.count}`}
                </div>
              </div>
            </div>

            <Card title="回撤曲线（相对历史峰值）" className="min-h-0 overflow-hidden">
              <EquityCurve trades={trades} series="drawdown" fill emptyHint="平仓不足两笔，暂无法绘制回撤曲线。" />
            </Card>

            <div className="gap-oc-2 grid min-h-0 grid-cols-1 lg:grid-cols-3">
              <Card title="盈亏分布（按笔数）" className="lg:col-span-2">
                <div className="space-y-1">
                  {risk.pnlDistribution.buckets.map((b) => (
                    <div key={b.range} className="flex items-center gap-oc-2 text-oc-12">
                      <span className="w-16 shrink-0 font-mono oc-text-faint">{b.range}</span>
                      <span className="h-3 min-w-0 flex-1 bg-[var(--surface-base-active)]">
                        <span
                          className={`block h-full ${b.range.trim().startsWith('-') ? 'bg-[var(--oc-loss)]/60' : 'bg-[var(--oc-profit)]/70'}`}
                          style={{ width: `${maxBucketPct ? (b.percentage / maxBucketPct) * 100 : 0}%` }}
                        />
                      </span>
                      <span className="w-20 shrink-0 text-right font-mono tabular-nums">
                        {b.count} 笔 · {b.percentage.toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </Card>

              <Card title="分布形态">
                <div className="space-y-oc-2 text-oc-13">
                  <div className="flex justify-between">
                    <span className="oc-text-faint">中位数</span>
                    <span className="font-mono">{fmtMoney(risk.pnlDistribution.median)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="oc-text-faint">标准差</span>
                    <span className="font-mono">{fmtMoney(risk.pnlDistribution.stdDev)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="oc-text-faint">偏度</span>
                    <span className="font-mono">
                      {risk.pnlDistribution.skewness.toFixed(2)}
                      <span className="ml-1 oc-text-faint">
                        {risk.pnlDistribution.skewness > 0 ? '右偏（大赢多）' : risk.pnlDistribution.skewness < 0 ? '左偏（大亏多）' : '对称'}
                      </span>
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="oc-text-faint">最大回撤</span>
                    <span className="font-mono oc-text-loss">{fmtMoney(risk.maxDrawdown)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="oc-text-faint">回撤幅度</span>
                    <span className="font-mono">{fmtPct(risk.maxDrawdownPercent)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="oc-text-faint">回撤修复</span>
                    <span className="font-mono">
                      {risk.avgDrawdownRecoveryTrades > 0 ? `${Math.round(risk.avgDrawdownRecoveryTrades)} 笔` : '\u2014'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="oc-text-faint">当前回撤</span>
                    <span className="font-mono">{fmtMoney(risk.currentDrawdown)}</span>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        )}

        {tab === 'tags' && (
          <div id="analysis-panel-tags" role="tabpanel" aria-labelledby="analysis-tab-tags" className="flex min-h-0 flex-1 flex-col">
            <TagAnalysisPanel />
          </div>
        )}

        </div>
      </div>
    </div>
  );
}
