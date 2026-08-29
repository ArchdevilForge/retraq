import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ListFilter, Trophy } from 'lucide-react';
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

/**
 * 复盘工作台（docs/DESIGN.md §2.4 弹层范式）：
 * 图是唯一常驻物；持仓/高手列表为工具条唤起的左侧浮层，
 * 持仓详情为选中驱动的右侧浮卡（× / Esc 关闭）。
 */
export default function ReplayPage() {
  const { activeDatasetId, loading: datasetsLoading, error: datasetsError } = useDataset();
  const [source, setSource] = useState<ReplaySource>('mine');
  const [symbol, setSymbol] = useState('');
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [selectedTrader, setSelectedTrader] = useState<MasterTrader | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<MasterPosition | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

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

  // 弹层关闭：Esc 关最上层浮卡/浮层；点击列表浮层外部关闭（浮卡随选中存续）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (detailOpen) setDetailOpen(false);
      else if (listOpen) setListOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!listOpen) return;
      const t = e.target as Node;
      if (listRef.current?.contains(t) || toolbarRef.current?.contains(t)) return;
      setListOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [listOpen, detailOpen]);


  const handleSymbolChange = useCallback((nextSymbol: string) => {
    setSymbol(nextSymbol);
    if (!nextSymbol) setSelectedTrade(null);
  }, []);

  const handleSelectTrade = useCallback((trade: Trade | null) => {
    setSelectedTrade(trade);
    if (trade?.symbol) setSymbol(trade.symbol);
    // §2.4：选中行 → 列表收起、详情浮卡出现（反馈在图上）
    if (trade) {
      setListOpen(false);
      setDetailOpen(true);
    }
  }, []);

  const handleSelectTrader = useCallback((trader: MasterTrader) => {
    setSelectedTrader(trader);
    setSelectedPosition(null);
    setListOpen(false);
    setDetailOpen(true);
  }, []);

  const handleSelectPosition = useCallback((position: MasterPosition) => {
    setSelectedPosition(position);
  }, []);

  const clearSelections = useCallback(() => {
    setSelectedTrade(null);
    setSelectedTrader(null);
    setSelectedPosition(null);
  }, []);

  const openList = useCallback(
    (next: ReplaySource) => {
      if (listOpen && source === next) {
        setListOpen(false); // 再点同一按钮 = 收起
        return;
      }
      setSource(next);
      clearSelections();
      setListOpen(true);
    },
    [listOpen, source, clearSelections],
  );

  // TV 顶栏式入口按钮：ReplayPage 自有层覆盖在工具栏预留槽上（不进图表子树，零重挂载）
  const toolbarButtons = useMemo(
    () => (
      <div className="flex items-center gap-1">
        <button
          type="button"
          title="我的持仓列表"
          aria-label="打开持仓列表"
          aria-expanded={listOpen && source === 'mine'}
          className={`oc-btn oc-btn--sm h-7 gap-1.5 px-2.5 text-[12px] ${listOpen && source === 'mine' ? 'oc-btn--primary' : 'oc-btn--ghost'}`}
          onClick={() => openList('mine')}
        >
          <ListFilter className="h-3.5 w-3.5" aria-hidden />
          持仓
        </button>
        <button
          type="button"
          title="合约高手榜"
          aria-label="打开高手列表"
          aria-expanded={listOpen && source === 'masters'}
          className={`oc-btn oc-btn--sm h-7 gap-1.5 px-2.5 text-[12px] ${listOpen && source === 'masters' ? 'oc-btn--primary' : 'oc-btn--ghost'}`}
          onClick={() => openList('masters')}
        >
          <Trophy className="h-3.5 w-3.5" aria-hidden />
          高手
        </button>
        <DailyReview />
      </div>
    ),
    [listOpen, source, openList],
  );
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
        <div key="chart" className="oc-canvas__chart">
          {activeSymbol && !noDataset ? (
            <ChartManager
              symbol={activeSymbol}
              selectedTrade={activeTrade}
              noFills={source === 'masters'}
              selfCompareTrades={source === 'masters' && compareOpen ? selfCompareTrades : null}
              toolbarSlotWidth={248}
            />
          ) : noDataset ? (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4">
              <EmptyDataset />
            </div>
          ) : (
            <div className="oc-empty">
              <p className="oc-empty__title">从工具条选择持仓或高手开始复盘</p>
            </div>
          )}
        </div>

        {/* 工具栏右侧按钮层：覆盖在预留槽上（§2.4 TV 顶栏式入口） */}
        <div ref={toolbarRef} className="absolute right-[10px] top-[13px] z-30">
          {toolbarButtons}
        </div>

        {/* 居中列表弹窗：我的 / 高手（§2.4，TV symbol search 式） */}
        <div
          key="list-modal-backdrop"
          ref={listRef}
          className={`fixed inset-0 z-[70] flex items-start justify-center bg-black/60 pt-[7vh]${listOpen ? '' : ' hidden'}`}
          aria-hidden={!listOpen}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setListOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={source === 'mine' ? '持仓列表' : '高手列表'}
            className={`oc-modal flex min-h-0 w-[min(760px,94vw)] flex-col ${source === 'masters' ? 'h-[min(78vh,720px)]' : 'max-h-[min(70vh,640px)]'}`}
          >
            <div className="oc-tabs oc-tabs--fill shrink-0 border-b-2 border-[var(--border-strong-base)]">
              <button
                type="button"
                className={`oc-tab${source === 'mine' ? ' oc-tab--active' : ''}`}
                onClick={() => {
                  setSource('mine');
                  clearSelections();
                }}
              >
                我的
              </button>
              <button
                type="button"
                className={`oc-tab${source === 'masters' ? ' oc-tab--active' : ''}`}
                onClick={() => {
                  setSource('masters');
                  clearSelections();
                }}
              >
                高手
              </button>
              <button
                type="button"
                className="oc-btn oc-btn--sm oc-btn--ghost mr-1 ml-auto self-center"
                aria-label="关闭列表"
                onClick={() => setListOpen(false)}
              >
                关闭
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {source === 'mine' ? (
                <TradeList onSelectTrade={handleSelectTrade} onSymbolChange={handleSymbolChange} onHide={() => setListOpen(false)} />
              ) : (
                <MasterList selectedTrader={selectedTrader} onSelectTrader={handleSelectTrader} onHide={() => setListOpen(false)} />
              )}
            </div>
          </div>
        </div>

        {/* 右侧详情浮卡：选中驱动的持仓详情 / 高手画像（§2.4） */}
        {detailOpen && (source === 'masters' ? selectedTrader : selectedTrade) ? (
          <div key="detail-card" className="oc-float-panel oc-float-panel--right">
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
          </div>
        ) : null}

        {/* P§五.2 同期「他 vs 我」对照 chip */}
        {source === 'masters' && activeTrade && selfCompareTrades ? (
          <div
            key="compare-chip"
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
