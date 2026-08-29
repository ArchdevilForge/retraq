import { useCallback, useEffect, useMemo, useState } from 'react';
import ChartManager from '../components/ChartManager';
import EmptyDataset from '../components/EmptyDataset';
import PositionDetails from '../components/PositionDetails';
import TradeList from '../components/TradeList';
import DailyReview from '../components/replay/DailyReview';
import MasterList from '../components/masters/MasterList';
import MasterDetailPanel from '../components/masters/MasterDetailPanel';
import { useDataset } from '../context/DatasetContext';
import {
  fetchSymbolStats,
  fetchTradesWithTotal,
  type MasterPosition,
  type MasterTrader,
  type Trade,
} from '../services/api';
import { fmtMoney } from '../utils/format';

type ReplaySource = 'mine' | 'masters';

/** 交割单 → 复盘引擎的持仓叠加（币安仅 position 级数据，无 fills）。 */
function masterPositionToTrade(p: MasterPosition): Trade {
  return {
    id: -p.id,
    symbol: p.symbol,
    direction: p.side === 'LONG' ? 'long' : 'short',
    leverage: p.leverage ?? null,
    entry_price: p.entry_price,
    exit_price: p.close_price ?? null,
    profit: p.pnl ?? null,
    profit_rate: p.roi != null ? p.roi / 100 : null,
    margin:
      p.max_amount && p.max_amount > 0
        ? (p.entry_price * p.max_amount) / (p.leverage || 1)
        : null,
    entry_time: p.opened_at,
    exit_time: p.closed_at ?? null,
  };
}

export default function ReplayPage() {
  const { activeDatasetId, loading: datasetsLoading, error: datasetsError } = useDataset();
  const [source, setSource] = useState<ReplaySource>('mine');
  const [symbol, setSymbol] = useState('');
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [selectedTrader, setSelectedTrader] = useState<MasterTrader | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<MasterPosition | null>(null);
  const [listOpen, setListOpen] = useState(true);
  const [detailOpen, setDetailOpen] = useState(true);

  const masterTrade = useMemo(
    () => (selectedPosition ? masterPositionToTrade(selectedPosition) : null),
    [selectedPosition],
  );
  const activeTrade = source === 'mine' ? selectedTrade : masterTrade;
  const activeSymbol = activeTrade?.symbol ?? symbol;

  // P§五.2 对照：高手持仓时段内「我的」同期持仓，叠加在同一张图上
  const [selfCompareTrades, setSelfCompareTrades] = useState<Trade[] | null>(null);
  const [compareOpen, setCompareOpen] = useState(true);
  const compareKey = `${source}:${activeTrade?.id ?? '-'}:${activeTrade?.symbol ?? ''}`;
  useEffect(() => {
    if (source !== 'masters' || !activeTrade || !activeTrade.symbol) {
      setSelfCompareTrades(null);
      return;
    }
    let ignore = false;
    setSelfCompareTrades(null);
    const windowBufferMs = 2 * 60 * 60 * 1000;
    fetchTradesWithTotal({
      symbol: activeTrade.symbol,
      start_date: activeTrade.entry_time - windowBufferMs,
      end_date: (activeTrade.exit_time ?? activeTrade.entry_time) + windowBufferMs,
    })
      .then(({ trades }) => {
        if (!ignore) setSelfCompareTrades(trades);
      })
      .catch(() => {
        if (!ignore) setSelfCompareTrades(null);
      });
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareKey]);
  const selfComparePnl = useMemo(
    () => (selfCompareTrades ?? []).reduce((sum, t) => sum + (t.profit ?? 0), 0),
    [selfCompareTrades],
  );

  // §1 图表绝对主角：进入复盘页即有图——默认加载持仓最多的币种，交易列表退为筛选器
  const [autoSymbolDone, setAutoSymbolDone] = useState(false);
  useEffect(() => {
    if (activeDatasetId == null || autoSymbolDone) return;
    let ignore = false;
    fetchSymbolStats()
      .then((stats) => {
        if (ignore) return;
        const top = Object.entries(stats.symbol_distribution).sort(([, a], [, b]) => b - a)[0];
        if (top) {
          setSymbol((cur) => cur || top[0]);
          setAutoSymbolDone(true);
        }
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, [activeDatasetId, autoSymbolDone]);

  const handleSymbolChange = useCallback((nextSymbol: string) => {
    setSymbol(nextSymbol);
    if (!nextSymbol) setSelectedTrade(null);
  }, []);

  const handleSelectTrade = useCallback((trade: Trade | null) => {
    setSelectedTrade(trade);
    if (trade?.symbol) setSymbol(trade.symbol);
  }, []);

  const handleSelectTrader = useCallback((trader: MasterTrader) => {
    setSelectedTrader(trader);
    setSelectedPosition(null);
  }, []);

  const handleSelectPosition = useCallback((position: MasterPosition) => {
    setSelectedPosition(position);
  }, []);

  const switchSource = useCallback((next: ReplaySource) => {
    setSource(next);
    setSelectedTrade(null);
    setSelectedTrader(null);
    setSelectedPosition(null);
    setSymbol('');
  }, []);

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

  const noDataset = source === 'mine' && activeDatasetId == null;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden p-2">
      <div className="oc-canvas oc-enter-stagger">
        {/* Hero chart — the background layer (docs/DESIGN.md §2.1) */}
        <div className="oc-canvas__chart">
          {activeSymbol && !noDataset ? (
            <ChartManager
              symbol={activeSymbol}
              selectedTrade={activeTrade}
              noFills={source === 'masters'}
              selfCompareTrades={source === 'masters' && compareOpen ? selfCompareTrades : null}
              toolbarExtra={<DailyReview />}
            />
          ) : noDataset ? (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4">
              <EmptyDataset />
            </div>
          ) : (
            <div className="oc-empty">
              <p className="oc-empty__title">
                {source === 'mine' ? '从左侧选一笔交易' : '从左侧选一位高手并复盘其交割单'}
              </p>
            </div>
          )}
        </div>

        {/* Left floating panel: 我的 / 高手 */}
        <aside
          className={`oc-float-panel oc-float-panel--left${listOpen ? '' : ' oc-float-panel--hidden'}`}
          aria-hidden={!listOpen}
        >
          <div className="oc-tabs oc-tabs--fill shrink-0 border-b-2 border-[var(--border-strong-base)]">
            <button
              type="button"
              className={`oc-tab${source === 'mine' ? ' oc-tab--active' : ''}`}
              onClick={() => switchSource('mine')}
            >
              我的
            </button>
            <button
              type="button"
              className={`oc-tab${source === 'masters' ? ' oc-tab--active' : ''}`}
              onClick={() => switchSource('masters')}
            >
              高手
            </button>
          </div>
          {source === 'mine' ? (
            <TradeList onSelectTrade={handleSelectTrade} onSymbolChange={handleSymbolChange} onHide={() => setListOpen(false)} />
          ) : (
            <MasterList selectedTrader={selectedTrader} onSelectTrader={handleSelectTrader} onHide={() => setListOpen(false)} />
          )}
        </aside>

        {/* Right floating panel: 持仓详情 / 交割单 */}
        <aside
          className={`oc-float-panel oc-float-panel--right${detailOpen ? '' : ' oc-float-panel--hidden'}`}
          aria-hidden={!detailOpen}
        >
          {source === 'mine' ? (
            <PositionDetails trade={selectedTrade} onHide={() => setDetailOpen(false)} />
          ) : (
            <MasterDetailPanel
              trader={selectedTrader}
              selectedPosition={selectedPosition}
              onSelectPosition={handleSelectPosition}
              onHide={() => setDetailOpen(false)}
            />
          )}
        </aside>

        {/* Rails when panels are collapsed */}
        {!listOpen ? (
          <button
            type="button"
            className="oc-panel-rail oc-panel-rail--left"
            aria-label="显示列表"
            onClick={() => setListOpen(true)}
          >
            列表
          </button>
        ) : null}
        {!detailOpen ? (
          <button
            type="button"
            className="oc-panel-rail oc-panel-rail--right"
            aria-label="显示详情"
            onClick={() => setDetailOpen(true)}
          >
            详情
          </button>
        ) : null}

        {/* P§五.2 同期「他 vs 我」对照 chip */}
        {source === 'masters' && activeTrade && selfCompareTrades ? (
          <div
            className="panel-card absolute left-1/2 top-[62px] z-20 flex -translate-x-1/2 items-center gap-2 px-3 py-1.5 text-[12px]"
            data-testid="self-compare-chip"
          >
            <span className="oc-text-faint">同期我的持仓</span>
            <span className={`font-mono tabular-nums ${selfComparePnl >= 0 ? 'oc-text-profit' : 'oc-text-loss'}`}>
              {selfCompareTrades.length} 笔 · {selfComparePnl >= 0 ? '+' : ''}{fmtMoney(selfComparePnl)} U
            </span>
            <button
              type="button"
              className="oc-btn oc-btn--sm oc-btn--secondary"
              onClick={() => setCompareOpen((v) => !v)}
            >
              {compareOpen ? '隐藏对照' : '显示对照'}
            </button>
          </div>
        ) : null}

      </div>
    </div>
  );
}
