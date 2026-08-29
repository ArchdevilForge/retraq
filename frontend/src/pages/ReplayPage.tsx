import { useCallback, useMemo, useState } from 'react';
import ChartManager from '../components/ChartManager';
import EmptyDataset from '../components/EmptyDataset';
import PositionDetails from '../components/PositionDetails';
import TradeList from '../components/TradeList';
import MasterList from '../components/masters/MasterList';
import MasterDetailPanel from '../components/masters/MasterDetailPanel';
import { useDataset } from '../context/DatasetContext';
import type { MasterPosition, MasterTrader, Trade } from '../services/api';

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
            <ChartManager symbol={activeSymbol} selectedTrade={activeTrade} noFills={source === 'masters'} />
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
      </div>
    </div>
  );
}
