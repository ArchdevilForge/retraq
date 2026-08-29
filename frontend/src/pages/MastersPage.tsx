import { useCallback, useState } from 'react';
import type { MasterPosition, MasterTrader } from '../services/api';
import MasterList from '../components/masters/MasterList';
import MasterChart from '../components/masters/MasterChart';
import MasterDetailPanel from '../components/masters/MasterDetailPanel';

export default function MastersPage() {
  const [selectedTrader, setSelectedTrader] = useState<MasterTrader | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<MasterPosition | null>(null);
  const [symbol, setSymbol] = useState<string>('BTC-USDT');
  const [listOpen, setListOpen] = useState(true);
  const [detailOpen, setDetailOpen] = useState(true);

  const handleSelectTrader = useCallback((trader: MasterTrader) => {
    setSelectedTrader(trader);
    setSelectedPosition(null);
  }, []);

  const handleSelectPosition = useCallback((position: MasterPosition) => {
    setSelectedPosition(position);
    if (position.symbol) {
      setSymbol(position.symbol);
    }
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden p-2">
      <div
        className="oc-workbench oc-enter-stagger min-h-0 flex-1 overflow-hidden"
        data-list-open={listOpen}
        data-detail-open={detailOpen}
      >
        {/* Left Panel: Master Leaderboard */}
        <aside
          key="masters-list"
          className={`panel flex min-h-0 min-w-0 flex-col overflow-hidden${
            listOpen ? '' : ' panel--collapsed'
          }`}
          aria-hidden={!listOpen}
        >
          <MasterList
            selectedTrader={selectedTrader}
            onSelectTrader={handleSelectTrader}
            onHide={() => setListOpen(false)}
          />
        </aside>

        {/* Center Panel: K-Line Hero Chart */}
        <section
          key="masters-chart"
          className="panel relative flex min-h-0 min-w-0 flex-col overflow-hidden"
        >
          {!listOpen ? (
            <button
              type="button"
              className="oc-panel-rail oc-panel-rail--left"
              aria-label="显示交易员列表"
              onClick={() => setListOpen(true)}
            >
              高手榜
            </button>
          ) : null}

          {!detailOpen ? (
            <button
              type="button"
              className="oc-panel-rail oc-panel-rail--right"
              aria-label="显示持仓详情"
              onClick={() => setDetailOpen(true)}
            >
              交割单
            </button>
          ) : null}

          <MasterChart
            symbol={symbol}
            selectedPosition={selectedPosition}
            selectedTrader={selectedTrader}
          />
        </section>

        {/* Right Panel: Trader Profile & Delivery Slips */}
        <aside
          key="masters-detail"
          className={`panel flex min-h-0 min-w-0 flex-col overflow-hidden${
            detailOpen ? '' : ' panel--collapsed'
          }`}
          aria-hidden={!detailOpen}
        >
          <MasterDetailPanel
            trader={selectedTrader}
            selectedPosition={selectedPosition}
            onSelectPosition={handleSelectPosition}
            onHide={() => setDetailOpen(false)}
          />
        </aside>
      </div>
    </div>
  );
}
