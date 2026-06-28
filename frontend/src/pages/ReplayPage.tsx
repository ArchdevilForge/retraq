import { useCallback, useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { LineChart } from 'lucide-react';
import ChartManager from '../components/ChartManager';
import PositionDetails from '../components/PositionDetails';
import TradeList from '../components/TradeList';
import type { Trade } from '../services/api';

gsap.registerPlugin(useGSAP);

export default function ReplayPage() {
  const shellRef = useRef<HTMLDivElement>(null);
  const [symbol, setSymbol] = useState('');
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);

  useGSAP(
    () => {
      if (!shellRef.current) return;
      gsap.from(shellRef.current, { opacity: 0, y: 8, duration: 0.4, ease: 'power2.out' });
    },
    { scope: shellRef },
  );

  const handleSymbolChange = useCallback((nextSymbol: string) => {
    setSymbol(nextSymbol);
    if (!nextSymbol) setSelectedTrade(null);
  }, []);

  const handleSelectTrade = useCallback((trade: Trade | null) => {
    setSelectedTrade(trade);
    if (trade?.symbol) setSymbol(trade.symbol);
  }, []);

  return (
    <div ref={shellRef} className="flex h-full min-h-0 flex-1 flex-col overflow-hidden p-3">
      <main className="grid min-h-0 flex-1 gap-3 overflow-hidden lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)_minmax(240px,280px)]">
        <aside className="panel flex min-h-0 min-w-0 flex-col overflow-hidden">
          <TradeList onSelectTrade={handleSelectTrade} onSymbolChange={handleSymbolChange} />
        </aside>

        <section className="panel flex min-h-0 min-w-0 flex-col overflow-hidden">
          {symbol ? (
            <ChartManager symbol={symbol} selectedTrade={selectedTrade} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
                <LineChart className="h-8 w-8" strokeWidth={1.5} />
              </div>
              <div className="max-w-md space-y-2">
                <p className="text-lg font-semibold text-base-content/90">从左侧选一笔交易</p>
                <p className="text-base leading-relaxed text-base-content/55">
                  浏览全部交割单，或用搜索筛选交易对。选中后在 K 线上查看买卖标注与仓位详情。
                </p>
              </div>
            </div>
          )}
        </section>

        <aside className="panel flex min-h-0 min-w-0 flex-col overflow-hidden">
          <PositionDetails trade={selectedTrade} />
        </aside>
      </main>
    </div>
  );
}