import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SeriesMarker, Time } from 'lightweight-charts';
import ChartCanvas, { type ChartPriceLine } from './chart/ChartCanvas';
import { useDataset } from '../context/DatasetContext';
import {
  createDrawing,
  deleteDrawing,
  fetchDrawings,
  fetchKlines,
  fetchSymbolStats,
  fetchTradeFills,
} from '../services/api';
import type { ChartDrawing, DrawingKind, DrawingPoint, Kline, Trade, TradeFill, Timeframe } from '../services/api';
import { fmtPrice, isSyntheticFills } from '../utils/fills';
import { readChartTheme } from '../utils/chartTheme';
import { useToast } from './ToastHost';

const TIMEFRAME_MS: Record<Timeframe, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};
const TRADE_FETCH_BUFFER_BARS = 2026;
const TRADE_VIEW_BUFFER_BARS = 200;
const DEFAULT_COMPARE_SYMBOL = 'BTC-USDT';

/** U 本位：名义价值 USDT = 价格 × 数量（张/币），不用裸币数量展示 */
function formatUsdt(usdt: number): string {
  if (!Number.isFinite(usdt) || usdt <= 0) return '';
  return `${usdt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}U`;
}

function fillNotionalUsdt(price: number, qty: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) return 0;
  return price * qty;
}

type TradeOverlay = { markers: SeriesMarker<Time>[]; priceLines: ChartPriceLine[] };

/** 成交明细 → K 线买卖标注 + 进出均价线（无明细时仅均价线）。 */
function buildTradeOverlay(
  trade: Trade,
  tradeFills: TradeFill[],
  timeframe: Timeframe,
): TradeOverlay {
  const theme = readChartTheme();
  const stepSec = Math.floor(TIMEFRAME_MS[timeframe] / 1000);
  const { up: buyColor, down: sellColor } = theme;
  const isLong = trade.direction === 'long';
  const entryIsBuy = isLong;
  const entryColor = entryIsBuy ? buyColor : sellColor;
  const exitColor = entryIsBuy ? sellColor : buyColor;
  const entryLabel = entryIsBuy ? '买入均价' : '卖出均价';
  const exitLabel = entryIsBuy ? '卖出均价' : '买入均价';

  const alignTime = (timeMs: number, mode: 'floor' | 'ceil') => {
    const rawSec = Math.floor(timeMs / 1000);
    if (!Number.isFinite(rawSec) || stepSec <= 0) return rawSec;
    return mode === 'ceil'
      ? Math.ceil(rawSec / stepSec) * stepSec
      : Math.floor(rawSec / stepSec) * stepSec;
  };

  type Bucket = { time: Time; buys: number; sells: number; buyQty: number; sellQty: number; buyPrices: number[]; sellPrices: number[] };
  const buckets = new Map<string, Bucket>();
  const addFill = (timeMs: number, isBuy: boolean, price: number, usdt: number) => {
    const t = alignTime(timeMs, 'floor') as Time;
    const key = String(t);
    let b = buckets.get(key);
    if (!b) {
      b = { time: t, buys: 0, sells: 0, buyQty: 0, sellQty: 0, buyPrices: [], sellPrices: [] };
      buckets.set(key, b);
    }
    const u = Number.isFinite(usdt) && usdt > 0 ? usdt : 0;
    if (isBuy) {
      b.buys += 1;
      b.buyQty += u;
      b.buyPrices.push(price);
    } else {
      b.sells += 1;
      b.sellQty += u;
      b.sellPrices.push(price);
    }
  };

  const syntheticFills = isSyntheticFills(tradeFills, trade);
  let entryUsdtSum = 0;
  let exitUsdtSum = 0;
  if (tradeFills.length > 0) {
    tradeFills.forEach((f) => {
      const isBuy = f.side.toUpperCase() === 'BUY';
      const usdt = syntheticFills && trade.margin != null ? trade.margin : fillNotionalUsdt(f.price, f.qty);
      addFill(f.time_ms, isBuy, f.price, usdt);
      if (entryIsBuy && isBuy) entryUsdtSum += usdt;
      if (entryIsBuy && !isBuy) exitUsdtSum += usdt;
      if (!entryIsBuy && !isBuy) entryUsdtSum += usdt;
      if (!entryIsBuy && isBuy) exitUsdtSum += usdt;
    });
  } else {
    const entryU = trade.margin ?? 0;
    addFill(trade.entry_time, entryIsBuy, trade.entry_price, entryU);
    if (trade.exit_time != null && trade.exit_price != null) {
      addFill(trade.exit_time, !entryIsBuy, trade.exit_price, entryU);
    }
    if (entryU > 0) entryUsdtSum = entryU;
    if (entryU > 0 && trade.exit_time != null) exitUsdtSum = entryU;
  }

  const markers: SeriesMarker<Time>[] = [];
  const sortedBuckets = [...buckets.values()].sort((a, b) => Number(a.time) - Number(b.time));
  for (const b of sortedBuckets) {
    if (b.buys > 0) {
      const avg = b.buyPrices.reduce((s, p) => s + p, 0) / b.buyPrices.length;
      const uStr = b.buyQty > 0 ? formatUsdt(b.buyQty) : b.buys > 1 ? `×${b.buys}笔` : '';
      markers.push({
        time: b.time,
        position: 'belowBar',
        color: buyColor,
        shape: 'arrowUp',
        text: uStr ? `买 ${uStr} @${fmtPrice(avg)}` : `买 @${fmtPrice(avg)}`,
      });
    }
    if (b.sells > 0) {
      const avg = b.sellPrices.reduce((s, p) => s + p, 0) / b.sellPrices.length;
      const uStr = b.sellQty > 0 ? formatUsdt(b.sellQty) : b.sells > 1 ? `×${b.sells}笔` : '';
      markers.push({
        time: b.time,
        position: 'aboveBar',
        color: sellColor,
        shape: 'arrowDown',
        text: uStr ? `卖 ${uStr} @${fmtPrice(avg)}` : `卖 @${fmtPrice(avg)}`,
      });
    }
  }

  const entryTitle = entryUsdtSum > 0 ? `${entryLabel} · ${formatUsdt(entryUsdtSum)}` : entryLabel;
  const exitTitle = exitUsdtSum > 0 ? `${exitLabel} · ${formatUsdt(exitUsdtSum)}` : exitLabel;
  const priceLines: ChartPriceLine[] = [
    { price: trade.entry_price, color: entryColor, title: entryTitle, dashed: true },
  ];
  if (trade.exit_price != null) {
    priceLines.push({ price: trade.exit_price, color: exitColor, title: exitTitle, dashed: true });
  }

  return { markers, priceLines };
}

interface Props {
  symbol: string;
  selectedTrade: Trade | null;
  /** master 交割单等无 fill 数据的持仓，跳过成交明细请求。 */
  noFills?: boolean;
}

/** 不请求尚未收盘的 K 线，否则缓存永远算不上覆盖，每次都回源交易所。仅可在 effect 内调用。 */
function clampRangeToClosed(range: { start: number; end: number } | null, tfMs: number) {
  if (!range) return undefined;
  const lastClosedEnd = Math.floor(Date.now() / tfMs) * tfMs - tfMs;
  return { start: range.start, end: Math.max(range.start, Math.min(range.end, lastClosedEnd)) };
}

function ChartManager({ symbol, selectedTrade, noFills = false }: Props) {
  const { activeDatasetId } = useDataset();
  const { toast } = useToast();
  const [activeTimeframe, setActiveTimeframe] = useState<Timeframe>('15m');
  const [tradeFills, setTradeFills] = useState<TradeFill[]>([]);
  const [tradeFillsError, setTradeFillsError] = useState(false);
  const [mainKlines, setMainKlines] = useState<Kline[]>([]);
  const [mainKlineLoading, setMainKlineLoading] = useState(false);
  const [mainKlineError, setMainKlineError] = useState<string | null>(null);
  const [compareKlines, setCompareKlines] = useState<Kline[] | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareSymbol, setCompareSymbol] = useState<string | null>(null);
  const [symbolOptions, setSymbolOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);

  const rangeForTrade = useMemo(() => {
    if (!selectedTrade) return null;
    const tfMs = TIMEFRAME_MS[activeTimeframe];
    const rawStart = Math.max(0, selectedTrade.entry_time - TRADE_FETCH_BUFFER_BARS * tfMs);
    const start = Math.floor(rawStart / tfMs) * tfMs;
    const endBase = selectedTrade.exit_time ?? selectedTrade.entry_time;
    const rawEnd = endBase + TRADE_FETCH_BUFFER_BARS * tfMs;
    return { start, end: Math.ceil(rawEnd / tfMs) * tfMs };
  }, [activeTimeframe, selectedTrade]);

  const visibleRange = useMemo(() => {
    if (!selectedTrade) return null;
    const tfMs = TIMEFRAME_MS[activeTimeframe];
    const stepSec = Math.floor(tfMs / 1000);
    const align = (sec: number, mode: 'floor' | 'ceil') =>
      mode === 'ceil' ? Math.ceil(sec / stepSec) * stepSec : Math.floor(sec / stepSec) * stepSec;
    const rawStartSec = Math.floor(
      Math.max(0, selectedTrade.entry_time - TRADE_VIEW_BUFFER_BARS * tfMs) / 1000,
    );
    const endBaseMs = selectedTrade.exit_time ?? selectedTrade.entry_time;
    const rawEndSec = Math.floor((endBaseMs + TRADE_VIEW_BUFFER_BARS * tfMs) / 1000);
    return { from: align(rawStartSec, 'floor') as Time, to: align(rawEndSec, 'ceil') as Time };
  }, [activeTimeframe, selectedTrade]);

  useEffect(() => {
    const tradeId = selectedTrade?.id;
    setTradeFills([]);
    setTradeFillsError(false);
    if (!tradeId || noFills) return;
    let ignore = false;
    fetchTradeFills(tradeId)
      .then((fills) => {
        if (!ignore) setTradeFills(fills);
      })
      .catch((err: unknown) => {
        console.error(err);
        if (!ignore) setTradeFillsError(true);
      });
    return () => {
      ignore = true;
    };
  }, [selectedTrade?.id, activeDatasetId, noFills]);

  useEffect(() => {
    if (activeDatasetId == null) return;
    fetchSymbolStats()
      .then((stats) => {
        const sorted = Object.entries(stats.symbol_distribution)
          .sort(([, a], [, b]) => b - a)
          .map(([sym]) => ({ value: sym, label: sym }));
        const merged = [{ value: DEFAULT_COMPARE_SYMBOL, label: DEFAULT_COMPARE_SYMBOL }, ...sorted].filter(
          (v, i, arr) => arr.findIndex((x) => x.value === v.value) === i,
        );
        setSymbolOptions(merged);
      })
      .catch(() => {
        setSymbolOptions([{ value: DEFAULT_COMPARE_SYMBOL, label: DEFAULT_COMPARE_SYMBOL }]);
      });
  }, [activeDatasetId]);

  useEffect(() => {
    const effectiveSymbol = selectedTrade?.symbol || symbol;
    if (!effectiveSymbol) {
      setMainKlines([]);
      return;
    }
    let ignore = false;
    setMainKlineLoading(true);
    setMainKlineError(null);
    fetchKlines(effectiveSymbol, activeTimeframe, clampRangeToClosed(rangeForTrade, TIMEFRAME_MS[activeTimeframe]))
      .then((klines) => {
        if (ignore) return;
        setMainKlines(klines);
        setMainKlineError(null);
      })
      .catch((err: unknown) => {
        console.error(err);
        if (ignore) return;
        setMainKlines([]);
        setMainKlineError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!ignore) setMainKlineLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [symbol, activeTimeframe, rangeForTrade, selectedTrade]);

  useEffect(() => {
    if (!compareSymbol) {
      setCompareKlines(null);
      return;
    }
    let ignore = false;
    setCompareLoading(true);
    setCompareError(null);
    fetchKlines(compareSymbol, activeTimeframe, clampRangeToClosed(rangeForTrade, TIMEFRAME_MS[activeTimeframe]))
      .then((klines) => {
        if (ignore) return;
        setCompareKlines(klines);
        setCompareError(null);
      })
      .catch((err: unknown) => {
        console.error(err);
        if (ignore) return;
        setCompareKlines(null);
        setCompareError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!ignore) setCompareLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [compareSymbol, activeTimeframe, rangeForTrade]);

  const drawingSymbol = selectedTrade?.symbol || symbol;

  useEffect(() => {
    setDrawings([]);
    if (!drawingSymbol) return;
    let ignore = false;
    fetchDrawings(drawingSymbol)
      .then((rows) => {
        if (!ignore) setDrawings(rows);
      })
      .catch(() => {
        if (!ignore) setDrawings([]);
      });
    return () => {
      ignore = true;
    };
  }, [drawingSymbol]);

  const handleUserDrawing = useCallback(
    (kind: DrawingKind, payload: DrawingPoint[]) => {
      if (!drawingSymbol) return;
      createDrawing(drawingSymbol, kind, payload)
        .then((created) => {
          setDrawings((prev) => [...prev, created]);
        })
        .catch((err: unknown) => {
          toast(err instanceof Error ? err.message : '画线保存失败', 'error');
        });
    },
    [drawingSymbol, toast],
  );

  const handleEraseDrawings = useCallback(() => {
    const ids = drawings.map((d) => d.id);
    setDrawings([]);
    Promise.all(ids.map((id) => deleteDrawing(id).catch(() => null)))
      .then((results) => {
        if (results.some((r) => r === null)) toast('部分画线删除失败', 'error');
      })
      .catch(() => toast('画线删除失败', 'error'));
  }, [drawings, toast]);

  const overlay = useMemo(
    () => (selectedTrade ? buildTradeOverlay(selectedTrade, tradeFills, activeTimeframe) : { markers: [], priceLines: [] }),
    [selectedTrade, tradeFills, activeTimeframe],
  );

  const status = selectedTrade ? (
    <>
      {tradeFillsError && (
        <span className="ml-2 text-[12px] oc-text-loss" role="alert">
          成交明细加载失败，K 线标注不完整
        </span>
      )}
      {mainKlines.length > 0 && tradeFills.length > 0 && (
        <span className="ml-2 text-[12px] oc-text-faint">成交 {tradeFills.length} 笔 → K 线标注</span>
      )}
      {mainKlines.length > 0 && !tradeFillsError && tradeFills.length === 0 && !noFills && (
        <span className="ml-2 text-[12px] oc-text-brand">无成交明细，仅均价线；请用交易历史模板重新导入</span>
      )}
    </>
  ) : null;

  return (
    <ChartCanvas
      symbol={selectedTrade?.symbol || symbol}
      timeframe={activeTimeframe}
      klines={mainKlines}
      loading={mainKlineLoading}
      error={mainKlineError}
      status={status}
      markers={overlay.markers}
      priceLines={overlay.priceLines}
      visibleRange={visibleRange}
      drawings={drawings}
      onUserDrawing={handleUserDrawing}
      onEraseDrawings={handleEraseDrawings}
      compare={compareSymbol ? { symbol: compareSymbol, klines: compareKlines, loading: compareLoading, error: compareError } : null}
      compareOptions={symbolOptions}
      onSelectCompare={setCompareSymbol}
      onClearCompare={() => setCompareSymbol(null)}
      onTimeframeChange={setActiveTimeframe}
    />
  );
}

export default ChartManager;
