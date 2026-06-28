import { useMemo, useRef, useState, useEffect } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useDataset } from '../context/DatasetContext';
import { fetchSymbolStats, fetchTrades } from '../services/api';
import type { SymbolStats, Trade } from '../services/api';
import { Search, TrendingUp, TrendingDown, X } from 'lucide-react';

gsap.registerPlugin(useGSAP);

interface Props {
  onSelectTrade: (trade: Trade | null) => void;
  onSymbolChange: (symbol: string) => void;
}

const ALL = '';

export default function TradeList({ onSelectTrade, onSymbolChange }: Props) {
  const { activeDatasetId, tradesRevision } = useDataset();
  const listRef = useRef<HTMLDivElement>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState<SymbolStats | null>(null);
  const [symbolFilter, setSymbolFilter] = useState(ALL);
  const [pairSearch, setPairSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

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
    fetchSymbolStats()
      .then(setStats)
      .catch(console.error);
  }, [activeDatasetId, tradesRevision]);

  useEffect(() => {
    if (activeDatasetId == null) return;
    setLoading(true);
    const sym = symbolFilter || undefined;
    fetchTrades(sym ? { symbol: sym } : undefined)
      .then(setTrades)
      .catch(console.error)
      .finally(() => setLoading(false));
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

  const applySymbol = (sym: string) => {
    setSymbolFilter(sym);
    setSelectedId(null);
    onSelectTrade(null);
    onSymbolChange(sym);
  };

  const handleRowClick = (trade: Trade) => {
    setSelectedId(trade.id);
    onSelectTrade(trade);
    if (symbolFilter && trade.symbol !== symbolFilter) {
      applySymbol(trade.symbol);
    } else if (!symbolFilter) {
      onSymbolChange(trade.symbol);
    }
  };

  useGSAP(
    () => {
      if (loading || !listRef.current || trades.length > 80) return;
      const rows = listRef.current.querySelectorAll('[data-trade-row]');
      gsap.fromTo(
        rows,
        { opacity: 0, x: -6 },
        { opacity: 1, x: 0, duration: 0.25, stagger: 0.008, ease: 'power2.out' },
      );
    },
    { dependencies: [loading, trades.length, symbolFilter, activeDatasetId], scope: listRef },
  );

  const totalCount = stats?.trade_count ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="panel-header shrink-0 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold tracking-tight">交易列表</h2>
          <span className="font-mono text-sm text-base-content/50">{totalCount} 笔</span>
        </div>

        <label className="input input-bordered flex h-11 min-h-11 items-center gap-2.5 rounded-lg border-white/[0.08] bg-base-100/40">
          <Search className="h-3.5 w-3.5 opacity-60" />
          <input
            className="grow text-base"
            type="search"
            placeholder="筛选交易对…"
            value={pairSearch}
            onChange={(e) => setPairSearch(e.target.value)}
          />
          {pairSearch ? (
            <button type="button" className="btn btn-ghost btn-xs btn-circle" onClick={() => setPairSearch('')}>
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </label>

        <div className="flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
          <button
            type="button"
            className={`btn btn-sm rounded-full ${symbolFilter === ALL ? 'bg-[#D97757] text-[#141413] border-0 hover:bg-[#D97757]/90' : 'btn-ghost border border-white/[0.08]'}`}
            onClick={() => applySymbol(ALL)}
          >
            全部 {totalCount ? `· ${totalCount}` : ''}
          </button>
          {filteredChips.map(({ sym, count }) => (
            <button
              key={sym}
              type="button"
              className={`btn btn-sm font-mono rounded-full ${
                symbolFilter === sym ? 'bg-[#D97757] text-[#141413] border-0' : 'btn-ghost border border-white/[0.08]'
              }`}
              onClick={() => applySymbol(sym)}
            >
              {sym} · {count}
            </button>
          ))}
        </div>
      </header>

      <div ref={listRef} className="panel-body min-h-0 flex-1 space-y-1 overflow-y-auto">
        {loading ? (
          [...Array(6)].map((_, i) => (
            <div key={i} className="h-[3.25rem] animate-pulse rounded-xl bg-base-300/30" />
          ))
        ) : trades.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-base-content/50">该数据集暂无交易，请在设置中导入表格</p>
        ) : (
          trades.map((trade) => {
            const isSelected = selectedId === trade.id;
            const profitPositive = (trade.profit ?? 0) >= 0;
            return (
              <button
                key={trade.id}
                type="button"
                data-trade-row
                className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  isSelected
                    ? 'border-primary/40 bg-primary/10'
                    : 'border-transparent hover:bg-base-100/40'
                }`}
                onClick={() => handleRowClick(trade)}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
                      trade.direction === 'long' ? 'bg-success/15 text-success' : 'bg-error/15 text-error'
                    }`}
                  >
                    {trade.direction === 'long' ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-base font-medium">{trade.symbol}</span>
                    <span className="block truncate text-sm text-base-content/55">
                      {new Date(trade.entry_time).toLocaleString('zh-CN')}
                    </span>
                  </span>
                </span>
                <span
                  className={`shrink-0 text-base font-semibold tabular-nums ${
                    trade.profit == null ? 'text-base-content/40' : profitPositive ? 'text-success' : 'text-error'
                  }`}
                >
                  {trade.profit == null ? '—' : trade.profit.toFixed(2)}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}