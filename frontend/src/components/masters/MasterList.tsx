import { memo, useState, useEffect, useCallback } from 'react';
import { Search, ChevronLeft } from 'lucide-react';
import type { MasterTrader } from '../../services/api';
import { fetchMasterTraders } from '../../services/api';
import { fmtMoney } from '../../utils/format';

interface Props {
  selectedTrader: MasterTrader | null;
  onSelectTrader: (trader: MasterTrader) => void;
  onHide?: () => void;
}

type SortKey = 'roi' | 'pnl' | 'win_rate' | 'position_count' | 'mdd' | 'sharp_ratio';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'sharp_ratio', label: '夏普比率' },
  { key: 'roi', label: '收益率' },
  { key: 'pnl', label: '总盈亏额' },
  { key: 'win_rate', label: '胜率' },
  { key: 'position_count', label: '交割单笔数' },
  { key: 'mdd', label: '最大回撤' },
  { key: 'sharp_ratio', label: '夏普比率' },
];

function Sparkline({ points }: { points: Array<{ time: number; value: number }> }) {
  if (!points || points.length < 2) return null;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 64;
  const height = 24;

  const pathCoords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = height - ((p.value - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const isUp = values[values.length - 1] >= values[0];
  const strokeColor = isUp ? 'var(--oc-pnl-up, #30D158)' : 'var(--oc-pnl-down, #FF3B30)';

  return (
    <svg width={width} height={height} className="shrink-0 overflow-visible" aria-hidden="true">
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pathCoords.join(' ')}
      />
    </svg>
  );
}

const TraderRow = memo(function TraderRow({
  trader,
  selected,
  onClick,
}: {
  trader: MasterTrader;
  selected: boolean;
  onClick: (trader: MasterTrader) => void;
}) {
  const isPositive = (trader.roi ?? 0) >= 0;
  const hasAvatar = !!trader.avatar_url;

  return (
    <button
      type="button"
      className={`oc-list-item text-left w-full${selected ? ' oc-list-item--active' : ''}`}
      onClick={() => onClick(trader)}
    >
      <div className="flex w-full items-center justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md border border-[var(--oc-border)] bg-[var(--oc-surface-1)]">
            {hasAvatar ? (
              <img
                src={trader.avatar_url!}
                alt={trader.nickname}
                className="h-full w-full object-cover"
                loading="lazy"
                onError={(e) => {
                  (e.currentTarget as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center font-mono text-xs font-semibold text-[var(--oc-text-faint)]">
                {trader.nickname.slice(0, 1).toUpperCase()}
              </div>
            )}
            {trader.badge && (
              <span
                className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--oc-accent)] text-[9px] text-[var(--oc-bg)]"
                title={trader.badge}
              >
                ★
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[13px] font-medium text-[var(--oc-text-base)]">
                {trader.nickname}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-[var(--oc-text-faint)]">
              {trader.win_rate != null && (
                <span>胜率 {trader.win_rate.toFixed(0)}%</span>
              )}
              {trader.position_count > 0 && (
                <span className="rounded bg-[var(--oc-surface-2)] px-1 py-0.2 font-mono text-[10px]">
                  {trader.position_count} 笔仓位
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 text-right">
          <Sparkline points={trader.equity_chart} />
          <div>
            <div
              className={`font-mono text-[13px] font-semibold tabular-nums ${
                isPositive ? 'oc-text-profit' : 'oc-text-loss'
              }`}
            >
              {trader.roi != null ? (trader.roi >= 0 ? `+${trader.roi.toFixed(1)}%` : `${trader.roi.toFixed(1)}%`) : '—'}
            </div>
            <div className="font-mono text-[11px] text-[var(--oc-text-faint)] tabular-nums">
              {trader.pnl != null ? fmtMoney(trader.pnl) : '—'}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
});

export default function MasterList({ selectedTrader, onSelectTrader, onHide }: Props) {
  const [traders, setTraders] = useState<MasterTrader[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [hasPositionsOnly, setHasPositionsOnly] = useState(true);
  // 默认按夏普排序：ROI 是幸存者偏差最重的索引（docs/PRODUCT.md §五）
  const [sortBy, setSortBy] = useState<SortKey>('sharp_ratio');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTraders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMasterTraders({
        search: search.trim() || undefined,
        has_positions_only: hasPositionsOnly,
        sort_by: sortBy,
        sort_order: sortOrder,
        page,
        limit: 30,
      });
      setTraders(res.data);
      setTotal(res.total);
      // If no selection or current selection not in list, auto-select first on page 1
      if (!selectedTrader && res.data.length > 0) {
        onSelectTrader(res.data[0]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载高手榜单失败');
    } finally {
      setLoading(false);
    }
  }, [search, hasPositionsOnly, sortBy, sortOrder, page, selectedTrader, onSelectTrader]);

  useEffect(() => {
    loadTraders();
  }, [loadTraders]);

  const totalPages = Math.max(1, Math.ceil(total / 30));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-[var(--oc-border)] p-3">
        <div className="flex items-center justify-between pb-2.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold tracking-wide text-[var(--oc-text-base)]">
              合约高手榜
            </span>
            <span className="rounded bg-[var(--oc-surface-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--oc-text-faint)]">
              {total} 位
            </span>
          </div>
          {onHide && (
            <button
              type="button"
              className="oc-btn oc-btn--sm oc-btn--ghost"
              onClick={onHide}
              aria-label="收起列表"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--oc-text-faint)]" />
          <input
            type="text"
            className="oc-input pl-8 text-[12px]"
            placeholder="搜索交易员昵称或 ID…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        {/* Filters & Sort */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
          <label className="flex cursor-pointer items-center gap-1.5 text-[var(--oc-text-muted)] select-none">
            <input
              type="checkbox"
              className="accent-[var(--oc-accent)]"
              checked={hasPositionsOnly}
              onChange={(e) => {
                setHasPositionsOnly(e.target.checked);
                setPage(1);
              }}
            />
            <span>仅看有交割单</span>
          </label>

          <div className="flex items-center gap-1">
            <select
              className="oc-select text-[11px] py-0.5 px-1.5"
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value as SortKey);
                setPage(1);
              }}
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="oc-btn oc-btn--sm oc-btn--secondary py-0.5 px-1.5 text-[10px]"
              onClick={() => setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
              title={sortOrder === 'desc' ? '当前降序 (高→低)' : '当前升序 (低→高)'}
            >
              {sortOrder === 'desc' ? '↓ 降序' : '↑ 升序'}
            </button>
          </div>
        </div>
      </div>

      {/* Trader List */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {loading && (
          <div className="flex h-32 items-center justify-center">
            <span className="oc-spinner oc-spinner--sm" aria-label="加载高手榜单中…" />
          </div>
        )}

        {error && (
          <div className="p-4 text-center text-xs text-[var(--oc-text-loss)]">
            <p>{error}</p>
            <button
              type="button"
              className="oc-btn oc-btn--sm oc-btn--secondary mt-2"
              onClick={loadTraders}
            >
              重试
            </button>
          </div>
        )}

        {!loading && !error && traders.length === 0 && (
          <div className="py-12 text-center text-xs text-[var(--oc-text-faint)]">
            未找到符合条件的合约交易员
          </div>
        )}

        {!loading && !error && traders.length > 0 && (
          <div className="space-y-1">
            {traders.map((t) => (
              <TraderRow
                key={t.id}
                trader={t}
                selected={selectedTrader?.id === t.id}
                onClick={onSelectTrader}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="flex shrink-0 items-center justify-between border-t border-[var(--oc-border)] px-3 py-2 text-[11px] text-[var(--oc-text-muted)]">
          <span>
            第 {page} / {totalPages} 页
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="oc-btn oc-btn--sm oc-btn--secondary py-0.5 px-2"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </button>
            <button
              type="button"
              className="oc-btn oc-btn--sm oc-btn--secondary py-0.5 px-2"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
