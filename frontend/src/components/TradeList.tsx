import { memo, useMemo, useState, useEffect, useCallback } from 'react';
import { useDataset } from '../context/DatasetContext';
import { fetchSymbolStats, fetchTrades } from '../services/api';
import type { SymbolStats, Trade } from '../services/api';
import { fmtDateTime, fmtMoney } from '../utils/format';
import { Search, TrendingUp, TrendingDown, X, ChevronLeft } from 'lucide-react';

interface Props {
  onSelectTrade: (trade: Trade | null) => void;
  onSymbolChange: (symbol: string) => void;
  onHide?: () => void;
}

const ALL = '';

/** 传输层失败（fetch 抛 TypeError，没有 HTTP 状态）不该把英文原文塞进中文提示。 */
function describeApiError(err: unknown): string {
  if (err instanceof TypeError) return '无法连接后端服务，请确认后端已启动';
  if (err instanceof Error) return err.message;
  return String(err);
}

const TradeRow = memo(function TradeRow({
  trade,
  selected,
  onClick,
}: {
  trade: Trade;
  selected: boolean;
  onClick: (trade: Trade) => void;
}) {
  const profitPositive = (trade.profit ?? 0) >= 0;
  return (
    <button
      type="button"
      data-trade-row
      className={`oc-list-item${selected ? ' oc-list-item--active' : ''}`}
      onClick={() => onClick(trade)}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${
            trade.direction === 'long' ? 'oc-surface-success' : 'oc-surface-error'
          }`}
        >
          {trade.direction === 'long' ? (
            <TrendingUp className="h-4 w-4" aria-hidden />
          ) : (
            <TrendingDown className="h-4 w-4" aria-hidden />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-mono text-[14px]">{trade.symbol}</span>
          <span className="block truncate text-[12px] oc-text-faint">{fmtDateTime(trade.entry_time)}</span>
        </span>
      </span>
      <span
        className={`shrink-0 text-[14px] font-medium tabular-nums ${
          trade.profit == null ? 'oc-text-faint' : profitPositive ? 'oc-text-profit' : 'oc-text-loss'
        }`}
      >
        {trade.profit == null ? '—' : fmtMoney(trade.profit)}
      </span>
    </button>
  );
});

function TradeList({ onSelectTrade, onSymbolChange, onHide }: Props) {
  const { activeDatasetId, tradesRevision } = useDataset();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState<SymbolStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [symbolFilter, setSymbolFilter] = useState(ALL);
  const [pairSearch, setPairSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (activeDatasetId == null) return;
    setSymbolFilter(ALL);
    setPairSearch('');
    setSelectedId(null);
    onSelectTrade(null);
    onSymbolChange('');
  }, [activeDatasetId, onSelectTrade, onSymbolChange]);

  useEffect(() => {
    if (activeDatasetId == null) return;
    let ignore = false;
    setStatsError(null);
    fetchSymbolStats()
      .then((data) => {
        if (!ignore) setStats(data);
      })
      .catch((err: unknown) => {
        console.error(err);
        if (ignore) return;
        setStats(null);
        setStatsError(describeApiError(err));
      });
    return () => {
      ignore = true;
    };
  }, [activeDatasetId, tradesRevision]);

  useEffect(() => {
    if (activeDatasetId == null) return;
    let ignore = false;
    setLoading(true);
    setError(null);
    const sym = symbolFilter || undefined;
    fetchTrades(sym ? { symbol: sym } : undefined)
      .then((data) => {
        if (!ignore) setTrades(data);
      })
      .catch((err: unknown) => {
        if (ignore) return;
        setTrades([]);
        setError(describeApiError(err));
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [activeDatasetId, symbolFilter, tradesRevision]);

  const symbolChips = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.symbol_distribution)
      .sort(([, a], [, b]) => b - a)
      .map(([sym, count]) => ({ sym, count }));
  }, [stats]);

  const filteredChips = useMemo(() => {
    const q = pairSearch.trim().toLowerCase();
    if (!q) return symbolChips;
    return symbolChips.filter((c) => c.sym.toLowerCase().includes(q));
  }, [pairSearch, symbolChips]);

  const applySymbol = useCallback(
    (sym: string) => {
      setSymbolFilter(sym);
      setSelectedId(null);
      onSelectTrade(null);
      onSymbolChange(sym);
    },
    [onSelectTrade, onSymbolChange],
  );

  const handleRowClick = useCallback(
    (trade: Trade) => {
      setSelectedId(trade.id);
      onSelectTrade(trade);
      if (symbolFilter && trade.symbol !== symbolFilter) {
        applySymbol(trade.symbol);
      } else if (!symbolFilter) {
        onSymbolChange(trade.symbol);
      }
    },
    [symbolFilter, onSelectTrade, onSymbolChange, applySymbol],
  );

  const totalCount = stats?.trade_count ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="panel-header shrink-0 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="oc-panel__title">交易列表</h2>
          <div className="flex shrink-0 items-center gap-1">
            <span className="font-mono text-[13px] tabular-nums oc-text-faint">{totalCount} 笔</span>
            {onHide ? (
              <button
                type="button"
                className="oc-icon-btn oc-icon-btn--sm oc-panel-hide"
                aria-label="隐藏交易列表"
                onClick={onHide}
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
        </div>

        <div className="oc-input-wrap">
          <Search className="h-3.5 w-3.5 oc-text-faint" aria-hidden />
          <label htmlFor="trade-pair-search" className="sr-only">
            筛选交易对
          </label>
          <input
            id="trade-pair-search"
            name="pairSearch"
            className="oc-input"
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="筛选交易对…"
            value={pairSearch}
            onChange={(e) => setPairSearch(e.target.value)}
          />
          {pairSearch ? (
            <button
              type="button"
              className="oc-icon-btn oc-icon-btn--sm"
              aria-label="清除筛选"
              onClick={() => setPairSearch('')}
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
          <button
            type="button"
            className={`oc-chip${symbolFilter === ALL ? ' oc-chip--active' : ''}`}
            onClick={() => applySymbol(ALL)}
          >
            全部 {totalCount ? `· ${totalCount}` : ''}
          </button>
          {filteredChips.map(({ sym, count }) => (
            <button
              key={sym}
              type="button"
              className={`oc-chip${symbolFilter === sym ? ' oc-chip--active' : ''}`}
              onClick={() => applySymbol(sym)}
            >
              {sym} · {count}
            </button>
          ))}
        </div>

        {statsError ? (
          <p className="text-[12px] oc-text-loss" role="alert">
            交易对统计加载失败：{statsError}
          </p>
        ) : null}
      </header>

      <div className="panel-body min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {loading ? (
          [...Array(6)].map((_, i) => (
            <div key={i} className="h-12 oc-skeleton" />
          ))
        ) : error ? (
          <p className="px-2 py-8 text-center text-[13px] oc-text-loss" role="alert">
            交易加载失败：{error}
          </p>
        ) : trades.length === 0 ? (
          <p className="px-2 py-8 text-center text-[13px] oc-text-faint">该数据集暂无交易，请导入表格</p>
        ) : (
          trades.map((trade) => (
            <TradeRow
              key={trade.id}
              trade={trade}
              selected={selectedId === trade.id}
              onClick={handleRowClick}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default memo(TradeList);
