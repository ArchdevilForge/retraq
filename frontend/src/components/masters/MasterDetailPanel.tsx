import { useState, useEffect, useCallback } from 'react';
import {
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Clock,
  Sparkles,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import type { MasterTrader, MasterPosition, MasterQuote } from '../../services/api';
import {
  fetchMasterPositions,
  fetchMasterQuotes,
  syncMasterTrader,
} from '../../services/api';
import { fmtMoney, fmtDateTime, fmtDurationMs } from '../../utils/format';
import { useToast } from '../ToastHost';
import AnnotationEditor from '../AnnotationEditor';

interface Props {
  trader: MasterTrader | null;
  selectedPosition: MasterPosition | null;
  onSelectPosition: (pos: MasterPosition) => void;
  onHide?: () => void;
}

type TabKey = 'positions' | 'equity' | 'wisdom' | 'notes';

export default function MasterDetailPanel({
  trader,
  selectedPosition,
  onSelectPosition,
  onHide,
}: Props) {
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<TabKey>('positions');
  const [positions, setPositions] = useState<MasterPosition[]>([]);
  const [totalPositions, setTotalPositions] = useState(0);
  const [posPage, setPosPage] = useState(1);
  const [posLoading, setPosLoading] = useState(false);
  const [posSortBy, setPosSortBy] = useState<'opened_at' | 'roi' | 'pnl'>('opened_at');
  const [posSortOrder, setPosSortOrder] = useState<'desc' | 'asc'>('desc');
  const [sideFilter, setSideFilter] = useState<string>('');
  const [symbolSearch, setSymbolSearch] = useState('');
  const [syncing, setSyncing] = useState(false);

  // Master Quotes State
  const [quotes, setQuotes] = useState<MasterQuote[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(false);

  // Load Positions when trader / filters change
  const loadPositions = useCallback(async () => {
    if (!trader) {
      setPositions([]);
      setTotalPositions(0);
      return;
    }
    setPosLoading(true);
    try {
      const res = await fetchMasterPositions(trader.id, {
        symbol: symbolSearch.trim() || undefined,
        side: sideFilter || undefined,
        sort_by: posSortBy,
        sort_order: posSortOrder,
        page: posPage,
        limit: 50,
      });
      setPositions(res.data);
      setTotalPositions(res.total);
      // Auto-select first position if none selected
      if (!selectedPosition && res.data.length > 0) {
        onSelectPosition(res.data[0]);
      }
    } catch {
      setPositions([]);
    } finally {
      setPosLoading(false);
    }
  }, [trader, symbolSearch, sideFilter, posSortBy, posSortOrder, posPage, selectedPosition, onSelectPosition]);

  useEffect(() => {
    loadPositions();
  }, [loadPositions]);

  // Load Quotes
  useEffect(() => {
    if (activeTab === 'wisdom' && quotes.length === 0) {
      setQuotesLoading(true);
      fetchMasterQuotes()
        .then(setQuotes)
        .catch(() => setQuotes([]))
        .finally(() => setQuotesLoading(false));
    }
  }, [activeTab, quotes.length]);

  // Live Sync from Binance
  const handleSync = async () => {
    if (!trader) return;
    setSyncing(true);
    try {
      const res = await syncMasterTrader(trader.id);
      toast(`已从币安同步最新交割单：新增 ${res.new_count} 笔，共 ${res.total_positions} 笔仓位！`, 'success');
      await loadPositions();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : '从币安同步交割单失败', 'error');
    } finally {
      setSyncing(false);
    }
  };

  // Clone to User Dataset removed: datasets are owner-scoped (self | master:* | sim)
  // and master replay happens in-place on the unified workbench (docs/PRODUCT.md §五).

  if (!trader) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-[var(--oc-text-faint)]">
        请从左侧选择一位合约交易员
      </div>
    );
  }

  const isPositiveRoi = (trader.roi ?? 0) >= 0;
  const isPositivePnl = (trader.pnl ?? 0) >= 0;
  const posPages = Math.max(1, Math.ceil(totalPositions / 50));

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--oc-surface-0)]">
      {/* Header Profile */}
      <div className="shrink-0 border-b border-[var(--oc-border)] p-4 bg-[var(--oc-surface-1)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-[var(--oc-border)] bg-[var(--oc-surface-2)]">
              {trader.avatar_url ? (
                <img
                  src={trader.avatar_url}
                  alt={trader.nickname}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLElement).style.display = 'none';
                  }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center font-mono text-base font-bold text-[var(--oc-text-muted)]">
                  {trader.nickname.slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-base font-bold text-[var(--oc-text-base)]">
                  {trader.nickname}
                </h2>
                {trader.badge && (
                  <span className="rounded bg-[var(--oc-accent)] px-1.5 py-0.2 font-mono text-[10px] font-semibold text-[var(--oc-bg)]">
                    {trader.badge}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px] text-[var(--oc-text-muted)]">
                <span className="rounded bg-[var(--oc-surface-2)] px-1.5 py-0.5 font-mono text-[10px]">
                  币安合约实盘
                </span>
                {trader.detail_url && (
                  <a
                    href={trader.detail_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-0.5 text-[var(--oc-accent)] hover:underline"
                  >
                    <span>币安主页</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="oc-btn oc-btn--sm oc-btn--secondary shrink-0 flex items-center gap-1 text-[11px]"
              onClick={handleSync}
              disabled={syncing}
              title="连接币安实盘公开接口，拉取该交易员最新交割单与画像"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? '同步中…' : '更新最新交割单'}</span>
            </button>
            {onHide && (
              <button
                type="button"
                className="oc-btn oc-btn--sm oc-btn--ghost p-1 text-[var(--oc-text-muted)]"
                onClick={onHide}
                aria-label="收起详情"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Key Metrics Grid */}
        <div className="mt-3.5 grid grid-cols-3 gap-2 rounded-lg border border-[var(--oc-border)] bg-[var(--oc-surface-0)] p-2.5">
          <div>
            <div className="text-[10px] text-[var(--oc-text-faint)]">收益率 (ROI)</div>
            <div
              className={`font-mono text-[13px] font-bold ${
                isPositiveRoi ? 'oc-text-profit' : 'oc-text-loss'
              }`}
            >
              {trader.roi != null
                ? `${trader.roi >= 0 ? '+' : ''}${trader.roi.toFixed(2)}%`
                : '—'}
            </div>
          </div>

          <div>
            <div className="text-[10px] text-[var(--oc-text-faint)]">结算盈亏 (PnL)</div>
            <div
              className={`font-mono text-[13px] font-bold ${
                isPositivePnl ? 'oc-text-profit' : 'oc-text-loss'
              }`}
            >
              {trader.pnl != null ? `${trader.pnl >= 0 ? '+' : ''}${fmtMoney(trader.pnl)}` : '—'}
            </div>
          </div>

          <div>
            <div className="text-[10px] text-[var(--oc-text-faint)]">胜率 (Win Rate)</div>
            <div className="font-mono text-[13px] font-bold text-[var(--oc-text-base)]">
              {trader.win_rate != null ? `${trader.win_rate.toFixed(1)}%` : '—'}
            </div>
          </div>

          <div>
            <div className="text-[10px] text-[var(--oc-text-faint)]">最大回撤 (MDD)</div>
            <div className="font-mono text-[12px] text-[var(--oc-text-muted)]">
              {trader.mdd != null ? `${trader.mdd.toFixed(2)}%` : '—'}
            </div>
          </div>

          <div>
            <div className="text-[10px] text-[var(--oc-text-faint)]">夏普比率</div>
            <div className="font-mono text-[12px] text-[var(--oc-text-muted)]">
              {trader.sharp_ratio != null ? trader.sharp_ratio.toFixed(2) : '—'}
            </div>
          </div>

          <div>
            <div className="text-[10px] text-[var(--oc-text-faint)]">交割单 / 天数</div>
            <div className="font-mono text-[12px] text-[var(--oc-text-muted)]">
              {trader.position_count} 笔 / {trader.trading_days || '—'} 天
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 border-b border-[var(--oc-border)] bg-[var(--oc-surface-1)] px-4">
        <button
          type="button"
          className={`border-b-2 py-2 px-3 text-[12px] font-medium transition-colors ${
            activeTab === 'positions'
              ? 'border-[var(--oc-accent)] text-[var(--oc-accent)] font-semibold'
              : 'border-transparent text-[var(--oc-text-muted)] hover:text-[var(--oc-text-base)]'
          }`}
          onClick={() => setActiveTab('positions')}
        >
          合约交割单 ({totalPositions})
        </button>

        <button
          type="button"
          className={`border-b-2 py-2 px-3 text-[12px] font-medium transition-colors ${
            activeTab === 'equity'
              ? 'border-[var(--oc-accent)] text-[var(--oc-accent)] font-semibold'
              : 'border-transparent text-[var(--oc-text-muted)] hover:text-[var(--oc-text-base)]'
          }`}
          onClick={() => setActiveTab('equity')}
        >
          净值走势
        </button>

        <button
          type="button"
          className={`border-b-2 py-2 px-3 text-[12px] font-medium transition-colors ${
            activeTab === 'wisdom'
              ? 'border-[var(--oc-accent)] text-[var(--oc-accent)] font-semibold'
              : 'border-transparent text-[var(--oc-text-muted)] hover:text-[var(--oc-text-base)]'
          }`}
          onClick={() => setActiveTab('wisdom')}
        >
          实战心法
        </button>

        <button
          type="button"
          className={`border-b-2 py-2 px-3 text-[12px] font-medium transition-colors ${
            activeTab === 'notes'
              ? 'border-[var(--oc-accent)] text-[var(--oc-accent)] font-semibold'
              : 'border-transparent text-[var(--oc-text-muted)] hover:text-[var(--oc-text-base)]'
          }`}
          onClick={() => setActiveTab('notes')}
        >
          笔记
        </button>
      </div>

      {/* Tab Contents */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Tab 1: Positions */}
        {activeTab === 'positions' && (
          <div className="flex h-full flex-col">
            {/* Filter Sub-bar */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--oc-border)] p-2.5 bg-[var(--oc-surface-0)]">
              <input
                type="text"
                className="oc-input text-[11px] py-1 px-2 max-w-[140px]"
                placeholder="过滤标的 (如 ETH)…"
                value={symbolSearch}
                onChange={(e) => {
                  setSymbolSearch(e.target.value);
                  setPosPage(1);
                }}
              />

              <div className="flex items-center gap-1.5">
                <select
                  className="oc-select text-[11px] py-0.5 px-1.5"
                  value={`${posSortBy}_${posSortOrder}`}
                  onChange={(e) => {
                    const [by, order] = e.target.value.split('_');
                    setPosSortBy(by as 'opened_at' | 'roi' | 'pnl');
                    setPosSortOrder(order as 'desc' | 'asc');
                    setPosPage(1);
                  }}
                  title="交割单排序"
                >
                  <option value="opened_at_desc">时间 (最新)</option>
                  <option value="roi_desc">收益率 (高→低)</option>
                  <option value="pnl_desc">盈亏额 (高→低)</option>
                  <option value="roi_asc">收益率 (低→高)</option>
                  <option value="pnl_asc">盈亏额 (低→高)</option>
                </select>

                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      sideFilter === ''
                        ? 'bg-[var(--oc-surface-2)] text-[var(--oc-text-base)]'
                        : 'text-[var(--oc-text-muted)] hover:text-[var(--oc-text-base)]'
                    }`}
                    onClick={() => {
                      setSideFilter('');
                      setPosPage(1);
                    }}
                  >
                    全部
                  </button>
                  <button
                    type="button"
                    className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      sideFilter === 'LONG'
                        ? 'bg-[var(--oc-surface-2)] oc-text-profit font-semibold'
                        : 'text-[var(--oc-text-muted)] hover:text-[var(--oc-text-base)]'
                    }`}
                    onClick={() => {
                      setSideFilter('LONG');
                      setPosPage(1);
                    }}
                  >
                    多
                  </button>
                  <button
                    type="button"
                    className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      sideFilter === 'SHORT'
                        ? 'bg-[var(--oc-surface-2)] oc-text-loss font-semibold'
                        : 'text-[var(--oc-text-muted)] hover:text-[var(--oc-text-base)]'
                    }`}
                    onClick={() => {
                      setSideFilter('SHORT');
                      setPosPage(1);
                    }}
                  >
                    空
                  </button>
                </div>
              </div>
            </div>

            {/* Position List */}
            <div className="flex-1 min-h-0 overflow-y-auto p-2">
              {posLoading && (
                <div className="flex h-32 items-center justify-center">
                  <span className="oc-spinner oc-spinner--sm" aria-label="加载交割单中…" />
                </div>
              )}

              {!posLoading && positions.length === 0 && (
                <div className="py-12 text-center text-xs text-[var(--oc-text-faint)]">
                  暂无匹配的合约交割单
                </div>
              )}

              {!posLoading && positions.length > 0 && (
                <div className="space-y-1.5">
                  {positions.map((pos) => {
                    const isSelected = selectedPosition?.id === pos.id;
                    const isLong = pos.side === 'LONG';
                    const isProfit = (pos.pnl ?? 0) >= 0;
                    const durationMs = pos.closed_at ? pos.closed_at - pos.opened_at : 0;

                    return (
                      <button
                        key={pos.id}
                        type="button"
                        className={`w-full rounded-md border p-2.5 text-left transition-all ${
                          isSelected
                            ? 'border-[var(--oc-accent)] bg-[var(--oc-surface-2)] shadow-xs'
                            : 'border-[var(--oc-border)] bg-[var(--oc-surface-1)] hover:bg-[var(--oc-surface-2)]'
                        }`}
                        onClick={() => onSelectPosition(pos)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`flex items-center gap-0.5 rounded px-1.5 py-0.2 font-mono text-[11px] font-bold ${
                                isLong
                                  ? 'bg-[var(--oc-surface-success)] text-[var(--oc-pnl-up,#30D158)]'
                                  : 'bg-[var(--oc-surface-error)] text-[var(--oc-pnl-down,#FF3B30)]'
                              }`}
                            >
                              {isLong ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                              {isLong ? '多' : '空'} {pos.leverage}x
                            </span>
                            <span className="font-mono text-[13px] font-bold text-[var(--oc-text-base)]">
                              {pos.symbol}
                            </span>
                          </div>

                          <div className="text-right">
                            <span
                              className={`font-mono text-[13px] font-bold tabular-nums ${
                                isProfit ? 'oc-text-profit' : 'oc-text-loss'
                              }`}
                            >
                              {pos.pnl != null
                                ? `${pos.pnl >= 0 ? '+' : ''}${fmtMoney(pos.pnl)}U`
                                : '—'}
                            </span>
                            {pos.roi != null && (
                              <span
                                className={`ml-1.5 font-mono text-[11px] ${
                                  pos.roi >= 0 ? 'oc-text-profit' : 'oc-text-loss'
                                }`}
                              >
                                ({pos.roi >= 0 ? '+' : ''}
                                {pos.roi.toFixed(1)}%)
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mt-1.5 flex items-center justify-between text-[11px] text-[var(--oc-text-muted)]">
                          <div className="flex items-center gap-2 font-mono">
                            <span>开: {fmtMoney(pos.entry_price)}</span>
                            {pos.close_price && <span>平: {fmtMoney(pos.close_price)}</span>}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-[var(--oc-text-faint)]">
                            <Clock className="h-3 w-3" />
                            <span>{fmtDurationMs(durationMs)}</span>
                          </div>
                        </div>

                        <div className="mt-1 font-mono text-[10px] text-[var(--oc-text-faint)]">
                          {fmtDateTime(pos.opened_at)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pagination */}
            {posPages > 1 && (
              <div className="flex shrink-0 items-center justify-between border-t border-[var(--oc-border)] px-3 py-2 text-[11px] text-[var(--oc-text-muted)] bg-[var(--oc-surface-1)]">
                <span>
                  第 {posPage} / {posPages} 页
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="oc-btn oc-btn--sm oc-btn--secondary py-0.5 px-2"
                    disabled={posPage <= 1 || posLoading}
                    onClick={() => setPosPage((p) => Math.max(1, p - 1))}
                  >
                    上一页
                  </button>
                  <button
                    type="button"
                    className="oc-btn oc-btn--sm oc-btn--secondary py-0.5 px-2"
                    disabled={posPage >= posPages || posLoading}
                    onClick={() => setPosPage((p) => Math.min(posPages, p + 1))}
                  >
                    下一页
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Equity Curve */}
        {activeTab === 'equity' && (
          <div className="p-4 space-y-4">
            <div>
              <div className="flex items-center justify-between pb-2">
                <span className="font-mono text-xs font-semibold text-[var(--oc-text-base)]">
                  7日收益曲线走势
                </span>
                <span className="font-mono text-xs font-bold oc-text-profit">
                  {trader.roi != null ? `${trader.roi >= 0 ? '+' : ''}${trader.roi.toFixed(1)}%` : ''}
                </span>
              </div>

              {trader.equity_chart && trader.equity_chart.length > 0 ? (
                <div className="rounded-lg border border-[var(--oc-border)] bg-[var(--oc-surface-1)] p-3">
                  <div className="space-y-1.5 font-mono text-[11px]">
                    {trader.equity_chart.map((pt, idx) => (
                      <div key={idx} className="flex items-center justify-between text-[var(--oc-text-muted)]">
                        <span>{fmtDateTime(pt.time)}</span>
                        <span
                          className={`font-semibold ${
                            pt.value >= 0 ? 'oc-text-profit' : 'oc-text-loss'
                          }`}
                        >
                          {pt.value >= 0 ? '+' : ''}
                          {pt.value.toFixed(2)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-[var(--oc-text-faint)]">
                  暂无收益曲线数据
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 4: Notes — annotation bound to the selected delivery slip */}
        {activeTab === 'notes' && (
          <div className="p-3">
            <AnnotationEditor subjectType="master_position" subjectId={selectedPosition?.id ?? null} />
          </div>
        )}

        {/* Tab 3: Contract Wisdom */}
        {activeTab === 'wisdom' && (
          <div className="p-3 space-y-3">
            {quotesLoading && (
              <div className="flex h-32 items-center justify-center">
                <span className="oc-spinner oc-spinner--sm" aria-label="加载合约心法中…" />
              </div>
            )}

            {!quotesLoading &&
              quotes.map((q) => (
                <div
                  key={q.id}
                  className="rounded-lg border border-[var(--oc-border)] bg-[var(--oc-surface-1)] p-3.5 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-[var(--oc-accent)]" />
                        <span className="font-bold text-[13px] text-[var(--oc-text-base)]">
                          {q.author}
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--oc-text-faint)]">{q.title}</div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {q.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-[var(--oc-surface-2)] px-1.5 py-0.2 font-mono text-[10px] text-[var(--oc-text-muted)]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <p className="text-[11px] leading-relaxed text-[var(--oc-text-muted)] bg-[var(--oc-surface-0)] p-2 rounded border border-[var(--oc-border)]">
                    {q.summary}
                  </p>

                  <div className="space-y-1.5">
                    {q.quotes.map((item, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-[11px] leading-relaxed">
                        <span className="text-[var(--oc-accent)] font-bold">›</span>
                        <span className="text-[var(--oc-text-base)]">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
