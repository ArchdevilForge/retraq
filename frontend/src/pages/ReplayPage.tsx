import { useCallback, useState } from 'react';
import ChartManager from '../components/ChartManager';
import EmptyDataset from '../components/EmptyDataset';
import PositionDetails from '../components/PositionDetails';
import TradeList from '../components/TradeList';
import { useDataset } from '../context/DatasetContext';
import type { Trade } from '../services/api';

export default function ReplayPage() {
  const { activeDatasetId, loading: datasetsLoading } = useDataset();
  const [symbol, setSymbol] = useState('');
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [listOpen, setListOpen] = useState(true);
  const [detailOpen, setDetailOpen] = useState(true);

  const handleSymbolChange = useCallback((nextSymbol: string) => {
    setSymbol(nextSymbol);
    if (!nextSymbol) setSelectedTrade(null);
  }, []);

  const handleSelectTrade = useCallback((trade: Trade | null) => {
    setSelectedTrade(trade);
    if (trade?.symbol) setSymbol(trade.symbol);
  }, []);

  if (datasetsLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="oc-spinner oc-spinner--md" aria-label="加载中…" />
      </div>
    );
  }

  if (activeDatasetId == null) {
    return <EmptyDataset />;
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden p-2">
      <div
        className="oc-workbench oc-enter-stagger min-h-0 flex-1 overflow-hidden"
        data-list-open={listOpen}
        data-detail-open={detailOpen}
      >
        <aside
          key="replay-list"
          className={`panel flex min-h-0 min-w-0 flex-col overflow-hidden${listOpen ? '' : ' panel--collapsed'}`}
          aria-hidden={!listOpen}
        >
          <TradeList
            onSelectTrade={handleSelectTrade}
            onSymbolChange={handleSymbolChange}
            onHide={() => setListOpen(false)}
          />
        </aside>

        <section key="replay-chart" className="panel relative flex min-h-0 min-w-0 flex-col overflow-hidden">
          {!listOpen ? (
            <button
              type="button"
              className="oc-panel-rail oc-panel-rail--left"
              aria-label="显示交易列表"
              onClick={() => setListOpen(true)}
            >
              列表
            </button>
          ) : null}
          {!detailOpen ? (
            <button
              type="button"
              className="oc-panel-rail oc-panel-rail--right"
              aria-label="显示持仓详情"
              onClick={() => setDetailOpen(true)}
            >
              详情
            </button>
          ) : null}
          {symbol ? (
            <ChartManager symbol={symbol} selectedTrade={selectedTrade} />
          ) : (
            <div className="oc-empty">
              <p className="oc-empty__title">{listOpen ? '从左侧选一笔交易' : '打开列表选一笔交易'}</p>
            </div>
          )}
        </section>

        <aside
          key="replay-detail"
          className={`panel flex min-h-0 min-w-0 flex-col overflow-hidden${detailOpen ? '' : ' panel--collapsed'}`}
          aria-hidden={!detailOpen}
        >
          <PositionDetails trade={selectedTrade} onHide={() => setDetailOpen(false)} />
        </aside>
      </div>
    </div>
  );
}
