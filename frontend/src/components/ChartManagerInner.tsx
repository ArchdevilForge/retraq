import { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';
import { Eraser, Maximize2, Minimize2, Minus, Ruler } from 'lucide-react';
import {
  clearRulerCanvas,
  drawRulerOnCanvas,
  measureRuler,
  syncOverlayCanvasSize,
  type RulerCorner,
} from './chartRulerOverlay';
import type { CandlestickData, HistogramData, LineData, SeriesMarker, Time } from 'lightweight-charts';
import { useDataset } from '../context/DatasetContext';
import { fetchKlines, fetchSymbolStats, fetchTradeFills } from '../services/api';
import type { Kline, Trade, TradeFill, Timeframe } from '../services/api';

const TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h', '1d'];
const TIMEFRAME_MS: Record<Timeframe, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};
const TIME_FILLER_BUFFER_BARS = 1200;
const MAX_TIME_FILLER_POINTS = 20000;
const DEFAULT_COMPARE_SYMBOL = 'BTC-USDT';
const TRADE_FETCH_BUFFER_BARS = 2026;
const TRADE_VIEW_BUFFER_BARS = 200;
const UTC8_OFFSET_SEC = 8 * 60 * 60;

/** U 本位：名义价值 USDT = 价格 × 数量（张/币），不用裸币数量展示 */
function formatUsdt(usdt: number): string {
  if (!Number.isFinite(usdt) || usdt <= 0) return '';
  return `${usdt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}U`;
}

function fillNotionalUsdt(price: number, qty: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) return 0;
  return price * qty;
}

function alignTimeSec(timeSec: number, stepSec: number, mode: 'floor' | 'ceil' = 'floor') {
  if (!Number.isFinite(timeSec) || !Number.isFinite(stepSec) || stepSec <= 0) return timeSec;
  if (mode === 'ceil') return Math.ceil(timeSec / stepSec) * stepSec;
  return Math.floor(timeSec / stepSec) * stepSec;
}

function formatUtc8Time(time: Time): string {
  if (typeof time === 'object' && time && 'year' in time) {
    const { year, month, day } = time;
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  }
  const seconds = Number(time);
  if (!Number.isFinite(seconds)) return '';
  const date = new Date((seconds + UTC8_OFFSET_SEC) * 1000);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

interface Props {
  symbol: string;
  selectedTrade: Trade | null;
}

function ChartManager({ symbol, selectedTrade }: Props) {
  const { activeDatasetId } = useDataset();
  const [tradeFills, setTradeFills] = useState<TradeFill[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const compareContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any | null>(null);
  const seriesRef = useRef<any | null>(null);
  const volumeSeriesRef = useRef<any | null>(null);
  const compareChartRef = useRef<any | null>(null);
  const compareSeriesRef = useRef<any | null>(null);
  const compareVolumeSeriesRef = useRef<any | null>(null);
  const markersRef = useRef<any | null>(null);
  const priceLinesRef = useRef<{ entry?: any; exit?: any }>({});
  const userPriceLinesRef = useRef<any[]>([]);
  const rulerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rulerCornerRef = useRef<RulerCorner | null>(null);
  const rulerPreviewRef = useRef<RulerCorner | null>(null);
  const rulerResultRef = useRef<{ a: RulerCorner; b: RulerCorner } | null>(null);
	const latestMainRequestIdRef = useRef(0);
	const latestCompareRequestIdRef = useRef(0);
	const syncingRangeRef = useRef(false);
	const compareEnabledRef = useRef(false);
	const syncingCrosshairRef = useRef(false);
	const crosshairSyncRafRef = useRef<number | null>(null);
	const pendingCrosshairSyncRef = useRef<{ source: 'main' | 'compare'; time: Time | null } | null>(null);
	const chartsPaneRef = useRef<HTMLDivElement | null>(null);
	const sharedTimelineRef = useRef<HTMLDivElement | null>(null);
	const updatingTimeFillerRef = useRef(false);
	const mainAnchorSeriesRef = useRef<any | null>(null);
	const compareAnchorSeriesRef = useRef<any | null>(null);
	const timeFillerSpecRef = useRef<{ start: Time; end: Time; step: number } | null>(null);
	const mainCandlesByTimeRef = useRef<Map<Time, CandlestickData>>(new Map());
	const compareCandlesByTimeRef = useRef<Map<Time, CandlestickData>>(new Map());
	const mainHasDataRef = useRef(false);
	const compareHasDataRef = useRef(false);
	const pendingMainVisibleRangeRef = useRef<any | null>(null);
	const pendingCompareVisibleRangeRef = useRef<any | null>(null);
  const latestActiveTimeframeRef = useRef<Timeframe>('15m');
  const latestCompareSymbolRef = useRef(DEFAULT_COMPARE_SYMBOL);
  const latestRangeForTradeRef = useRef<{ start: number; end: number } | null>(null);
  const [activeTimeframe, setActiveTimeframe] = useState<Timeframe>('15m');
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareSymbol, setCompareSymbol] = useState(DEFAULT_COMPARE_SYMBOL);
  const compareModalRef = useRef<HTMLDialogElement | null>(null);
  const [symbolOptions, setSymbolOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [mainKlineLoading, setMainKlineLoading] = useState(false);
  const [mainKlineError, setMainKlineError] = useState<string | null>(null);
  const [mainHasData, setMainHasData] = useState(false);
  const [compareKlineLoading, setCompareKlineLoading] = useState(false);
  const [compareKlineError, setCompareKlineError] = useState<string | null>(null);
  const [compareHasData, setCompareHasData] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [drawMode, setDrawMode] = useState<'none' | 'hline' | 'ruler'>('none');
  const [rulerHint, setRulerHint] = useState('');

  const remapRulerCorner = useCallback((c: RulerCorner): RulerCorner | null => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return null;
    const x = chart.timeScale().timeToCoordinate(c.time);
    const y = series.priceToCoordinate(c.price);
    if (x == null || y == null) return null;
    return { time: c.time, price: c.price, x, y };
  }, []);

  const paintRulerOverlay = useCallback(() => {
    const canvas = rulerCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    syncOverlayCanvasSize(canvas, container);
    const stepSec = Math.floor(TIMEFRAME_MS[latestActiveTimeframeRef.current] / 1000);
    const pair = rulerResultRef.current;
    if (pair) {
      const a = remapRulerCorner(pair.a);
      const b = remapRulerCorner(pair.b);
      if (!a || !b) return;
      drawRulerOnCanvas(canvas, a, b, measureRuler(a, b, stepSec));
      return;
    }
    const start = rulerCornerRef.current;
    const preview = rulerPreviewRef.current;
    if (start && preview) {
      const a = remapRulerCorner(start) ?? start;
      const b = remapRulerCorner(preview) ?? preview;
      drawRulerOnCanvas(canvas, a, b, measureRuler(a, b, stepSec));
      return;
    }
    clearRulerCanvas(canvas);
  }, [remapRulerCorner]);

  const clearRuler = useCallback(() => {
    rulerCornerRef.current = null;
    rulerPreviewRef.current = null;
    rulerResultRef.current = null;
    clearRulerCanvas(rulerCanvasRef.current);
    setRulerHint('');
  }, []);

  const clearUserDrawnLines = useCallback(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const line of userPriceLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {
        /* ponytail: line already removed */
      }
    }
    userPriceLinesRef.current = [];
    clearRuler();
  }, [clearRuler]);

  useEffect(() => {
    clearUserDrawnLines();
  }, [symbol, clearUserDrawnLines]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || drawMode === 'none') return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const chart = chartRef.current;
      const series = seriesRef.current;
      if (!chart || !series) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const price = series.coordinateToPrice(y) as number | null;
      if (price == null || !Number.isFinite(price)) return;
      const time = chart.timeScale().coordinateToTime(x) as Time | null;
      if (time == null) return;

      if (drawMode === 'hline') {
        const line = series.createPriceLine({
          price,
          color: '#9A9690',
          lineWidth: 3,
          lineStyle: 0,
          axisLabelVisible: true,
          title: price.toFixed(4),
        });
        userPriceLinesRef.current.push(line);
        setDrawMode('none');
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (drawMode === 'ruler') {
        const corner: RulerCorner = { time, price, x, y };
        const pending = rulerCornerRef.current;
        if (!pending) {
          rulerCornerRef.current = corner;
          rulerPreviewRef.current = null;
          setRulerHint('移动鼠标预览，再点确定');
        } else {
          rulerResultRef.current = { a: pending, b: corner };
          rulerCornerRef.current = null;
          rulerPreviewRef.current = null;
          setDrawMode('none');
          setRulerHint('');
          paintRulerOverlay();
        }
        e.preventDefault();
        e.stopPropagation();
      }
    };
    el.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => el.removeEventListener('pointerdown', onPointerDown, { capture: true });
  }, [drawMode, paintRulerOverlay]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || drawMode !== 'ruler') return;
    let raf = 0;
    const onPointerMove = (e: PointerEvent) => {
      if (!rulerCornerRef.current) return;
      const chart = chartRef.current;
      const series = seriesRef.current;
      if (!chart || !series) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const price = series.coordinateToPrice(y) as number | null;
      const time = chart.timeScale().coordinateToTime(x) as Time | null;
      if (price == null || time == null) return;
      rulerPreviewRef.current = { time, price, x, y };
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => paintRulerOverlay());
    };
    window.addEventListener('pointermove', onPointerMove);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      cancelAnimationFrame(raf);
    };
  }, [drawMode, paintRulerOverlay]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (rulerResultRef.current || rulerCornerRef.current) paintRulerOverlay();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [paintRulerOverlay]);

  useEffect(() => {
    if (!selectedTrade?.id) {
      setTradeFills([]);
      return;
    }
    fetchTradeFills(selectedTrade.id)
      .then(setTradeFills)
      .catch(() => setTradeFills([]));
  }, [selectedTrade?.id, activeDatasetId]);

  useEffect(() => {
    if (activeDatasetId == null) return;
    fetchSymbolStats()
      .then((stats) => {
        const sorted = Object.entries(stats.symbol_distribution)
          .sort(([, a], [, b]) => b - a)
          .map(([sym]) => ({ value: sym, label: sym }));
        const merged = [{ value: DEFAULT_COMPARE_SYMBOL, label: DEFAULT_COMPARE_SYMBOL }, ...sorted]
          .filter((v, i, arr) => arr.findIndex((x) => x.value === v.value) === i);
        setSymbolOptions(merged);
      })
      .catch(() => {
        setSymbolOptions([{ value: DEFAULT_COMPARE_SYMBOL, label: DEFAULT_COMPARE_SYMBOL }]);
      });
  }, [activeDatasetId]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const pane = chartsPaneRef.current;
      setIsFullscreen(Boolean(pane && document.fullscreenElement === pane));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    handleFullscreenChange();
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const rangeForTrade = useMemo(() => {
    if (!selectedTrade) return null;
    const tfMs = TIMEFRAME_MS[activeTimeframe];
    const rawStart = Math.max(0, selectedTrade.entry_time - TRADE_FETCH_BUFFER_BARS * tfMs);
    const start = Math.floor(rawStart / tfMs) * tfMs;
    const endBase = selectedTrade.exit_time ?? selectedTrade.entry_time;
    const rawEnd = endBase + TRADE_FETCH_BUFFER_BARS * tfMs;
    const end = Math.ceil(rawEnd / tfMs) * tfMs;
    return { start, end };
  }, [activeTimeframe, selectedTrade]);

  const visibleRangeForTrade = useMemo(() => {
    if (!selectedTrade) return null;
    const tfMs = TIMEFRAME_MS[activeTimeframe];
    const stepSec = Math.floor(tfMs / 1000);
    const rawStartSec = Math.floor(Math.max(0, selectedTrade.entry_time - TRADE_VIEW_BUFFER_BARS * tfMs) / 1000);
    const rangeStartSec = alignTimeSec(rawStartSec, stepSec, 'floor') as Time;
    const endBaseMs = selectedTrade.exit_time ?? selectedTrade.entry_time;
    const rawEndSec = Math.floor((endBaseMs + TRADE_VIEW_BUFFER_BARS * tfMs) / 1000);
    const rangeEndSec = alignTimeSec(rawEndSec, stepSec, 'ceil') as Time;
    return { from: rangeStartSec, to: rangeEndSec };
  }, [activeTimeframe, selectedTrade]);

  const buildTimeFillerData = useCallback((start: number, end: number, step: number): LineData[] => {
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(step) || step <= 0) return [];

    const items: LineData[] = [];
    for (let t = start; t <= end; t += step) {
      items.push({ time: t as Time, value: 0 });
      if (items.length >= MAX_TIME_FILLER_POINTS) break;
    }
    return items;
  }, []);

  const applyTimeFiller = useCallback((target: 'main' | 'compare' | 'both' = 'both') => {
    const spec = timeFillerSpecRef.current;
    if (!spec) return;
    if (typeof spec.start !== 'number' || typeof spec.end !== 'number' || typeof spec.step !== 'number') return;

    const data = buildTimeFillerData(spec.start, spec.end, spec.step);
    if (!data.length) return;

    updatingTimeFillerRef.current = true;
    try {
      if (target === 'main' || target === 'both') {
        mainAnchorSeriesRef.current?.setData?.(data);
      }
      if (target === 'compare' || target === 'both') {
        compareAnchorSeriesRef.current?.setData?.(data);
      }
    } finally {
      requestAnimationFrame(() => {
        updatingTimeFillerRef.current = false;
      });
    }
  }, [buildTimeFillerData]);

  const ensureTimeFiller = useCallback(
    (tf: Timeframe, startSec: number, endSec: number) => {
      const step = Math.floor(TIMEFRAME_MS[tf] / 1000);
      if (!Number.isFinite(step) || step <= 0) return;
      if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return;

      const alignedStart = Math.floor(startSec / step) * step;
      const alignedEnd = Math.ceil(endSec / step) * step;
      const start = Math.max(0, alignedStart - TIME_FILLER_BUFFER_BARS * step);
      const end = alignedEnd + TIME_FILLER_BUFFER_BARS * step;
      if (end <= start) return;

      const prev = timeFillerSpecRef.current;
      if (prev && prev.step === step) {
        const thresholdBars = Math.max(1, Math.floor(TIME_FILLER_BUFFER_BARS / 2));
        const thresholdSec = thresholdBars * step;
        const safeStart = (prev.start as number) + thresholdSec;
        const safeEnd = (prev.end as number) - thresholdSec;
        if (safeStart <= safeEnd && alignedStart >= safeStart && alignedEnd <= safeEnd) return;
      }

      timeFillerSpecRef.current = { start: start as Time, end: end as Time, step };
      applyTimeFiller('both');
    },
    [applyTimeFiller],
  );

  const applyTradeMarkers = useCallback(() => {
    const trade = selectedTrade;
    const series = seriesRef.current;
    if (!trade || !series || !mainHasDataRef.current || mainCandlesByTimeRef.current.size === 0) {
      markersRef.current?.setMarkers?.([]);
      return;
    }

    const stepSec = Math.floor(TIMEFRAME_MS[activeTimeframe] / 1000);
    const candlesByTime = mainCandlesByTimeRef.current;

    const resolveMarkerTime = (timeMs: number): Time | null => {
      const rawSec = Math.floor(timeMs / 1000);
      if (!Number.isFinite(rawSec) || !Number.isFinite(stepSec) || stepSec <= 0) return null;
      const floorSec = alignTimeSec(rawSec, stepSec, 'floor');
      const ceilSec = alignTimeSec(rawSec, stepSec, 'ceil');
      const candidates = [
        floorSec,
        ceilSec,
        rawSec,
        floorSec - stepSec,
        floorSec + stepSec,
        ceilSec - stepSec,
        ceilSec + stepSec,
      ];
      for (const t of candidates) {
        if (candlesByTime.has(t as Time)) return t as Time;
      }
      return null;
    };

    const buyColor = '#3D8A5A';
    const sellColor = '#C45C5C';
    const isLong = trade.direction === 'long';
    const entryIsBuy = isLong;
    const entryColor = entryIsBuy ? buyColor : sellColor;
    const exitColor = entryIsBuy ? sellColor : buyColor;
    const entryLabel = entryIsBuy ? '买入均价' : '卖出均价';
    const exitLabel = entryIsBuy ? '卖出均价' : '买入均价';

    if (priceLinesRef.current.entry) {
      series.removePriceLine(priceLinesRef.current.entry);
      priceLinesRef.current.entry = undefined;
    }
    if (priceLinesRef.current.exit) {
      series.removePriceLine(priceLinesRef.current.exit);
      priceLinesRef.current.exit = undefined;
    }

    type Bucket = {
      time: Time;
      buys: number;
      sells: number;
      buyQty: number;
      sellQty: number;
      buyPrices: number[];
      sellPrices: number[];
    };
    const buckets = new Map<string, Bucket>();
    const addFill = (timeMs: number, isBuy: boolean, price: number, usdt: number) => {
      const t = resolveMarkerTime(timeMs);
      if (t == null) return;
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

    const syntheticFills =
      tradeFills.length > 0 && tradeFills.length <= 2 && tradeFills.every((f) => f.qty === 1);

    let entryUsdtSum = 0;
    let exitUsdtSum = 0;
    if (tradeFills.length > 0) {
      tradeFills.forEach((f) => {
        const isBuy = f.side.toUpperCase() === 'BUY';
        const usdt = syntheticFills && trade.margin != null
          ? trade.margin
          : fillNotionalUsdt(f.price, f.qty);
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
          text: uStr ? `买 ${uStr} @${avg.toFixed(2)}` : `买 @${avg.toFixed(4)}`,
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
          text: uStr ? `卖 ${uStr} @${avg.toFixed(2)}` : `卖 @${avg.toFixed(4)}`,
        });
      }
    }

    if (!markersRef.current) {
      markersRef.current = createSeriesMarkers(series, markers);
    } else {
      markersRef.current.setMarkers(markers);
    }

    const entryTitle =
      entryUsdtSum > 0 ? `${entryLabel} · ${formatUsdt(entryUsdtSum)}` : entryLabel;
    const exitTitle =
      exitUsdtSum > 0 ? `${exitLabel} · ${formatUsdt(exitUsdtSum)}` : exitLabel;
    priceLinesRef.current.entry = series.createPriceLine({
      price: trade.entry_price,
      color: entryColor,
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: entryTitle,
    });
    if (trade.exit_price != null) {
      priceLinesRef.current.exit = series.createPriceLine({
        price: trade.exit_price,
        color: exitColor,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: exitTitle,
      });
    }
  }, [activeTimeframe, selectedTrade, tradeFills]);

  const loadMainData = useCallback(async (tf: Timeframe, sym: string, range?: { start: number; end: number }) => {
    if (!seriesRef.current || !volumeSeriesRef.current) return;
    latestMainRequestIdRef.current += 1;
    const requestId = latestMainRequestIdRef.current;
    setMainKlineLoading(true);
    setMainKlineError(null);
    setMainHasData(false);
    try {
      seriesRef.current.setData([]);
      volumeSeriesRef.current.setData([]);
      mainCandlesByTimeRef.current = new Map();
      mainHasDataRef.current = false;
      const klines: Kline[] = await fetchKlines(sym, tf, range ? { start: range.start, end: range.end } : undefined);
      if (requestId !== latestMainRequestIdRef.current) return;
	      const data: CandlestickData[] = klines.map(k => ({
	        time: k.time as Time,
	        open: k.open,
	        high: k.high,
	        low: k.low,
	        close: k.close,
	      }));
	      const volume: HistogramData[] = klines.map(k => ({
	        time: k.time as Time,
	        value: k.volume,
	        color: k.close >= k.open ? 'rgba(34, 197, 94, 0.6)' : 'rgba(239, 68, 68, 0.6)',
	      }));
	      seriesRef.current.setData(data);
	      volumeSeriesRef.current.setData(volume);
	      mainCandlesByTimeRef.current = new Map(data.map((candle) => [candle.time, candle]));
	      mainHasDataRef.current = data.length > 0;
	      setMainHasData(data.length > 0);
      setMainKlineError(null);

	      const fillerStart = range ? Math.floor(range.start / 1000) : (data[0]?.time as number | undefined);
	      const fillerEnd = range ? Math.floor(range.end / 1000) : (data[data.length - 1]?.time as number | undefined);
	      if (typeof fillerStart === 'number' && typeof fillerEnd === 'number') {
	        ensureTimeFiller(tf, fillerStart, fillerEnd);
	      }

      const pending = pendingMainVisibleRangeRef.current;
      if (pending && chartRef.current) {
        try {
          if (typeof pending.from === 'number' && typeof pending.to === 'number') {
            chartRef.current.timeScale().setVisibleRange(pending);
          } else if (typeof chartRef.current.timeScale().setVisibleLogicalRange === 'function') {
            chartRef.current.timeScale().setVisibleLogicalRange(pending);
          }
          pendingMainVisibleRangeRef.current = null;
        } catch (err) {
          console.error(err);
        }
      }
      requestAnimationFrame(() => applyTradeMarkers());
    } catch (error) {
      console.error(error);
      if (requestId !== latestMainRequestIdRef.current) return;
      seriesRef.current.setData([]);
      volumeSeriesRef.current.setData([]);
      mainCandlesByTimeRef.current = new Map();
      mainHasDataRef.current = false;
      setMainHasData(false);
      setMainKlineError(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === latestMainRequestIdRef.current) {
        setMainKlineLoading(false);
      }
    }
  }, [applyTradeMarkers, ensureTimeFiller]);

  const loadCompareData = useCallback(async (tf: Timeframe, sym: string, range?: { start: number; end: number }) => {
    if (!compareSeriesRef.current || !compareVolumeSeriesRef.current) return;
    latestCompareRequestIdRef.current += 1;
    const requestId = latestCompareRequestIdRef.current;
    setCompareKlineLoading(true);
    setCompareKlineError(null);
    setCompareHasData(false);
    try {
      compareSeriesRef.current.setData([]);
      compareVolumeSeriesRef.current.setData([]);
      compareCandlesByTimeRef.current = new Map();
      compareHasDataRef.current = false;
      const klines: Kline[] = await fetchKlines(sym, tf, range ? { start: range.start, end: range.end } : undefined);
      if (requestId !== latestCompareRequestIdRef.current) return;
	      const data: CandlestickData[] = klines.map(k => ({
	        time: k.time as Time,
	        open: k.open,
	        high: k.high,
	        low: k.low,
	        close: k.close,
	      }));
	      const volume: HistogramData[] = klines.map(k => ({
	        time: k.time as Time,
	        value: k.volume,
	        color: k.close >= k.open ? 'rgba(34, 197, 94, 0.6)' : 'rgba(239, 68, 68, 0.6)',
	      }));
	      compareSeriesRef.current.setData(data);
	      compareVolumeSeriesRef.current.setData(volume);
	      compareCandlesByTimeRef.current = new Map(data.map((candle) => [candle.time, candle]));
	      compareHasDataRef.current = data.length > 0;
	      setCompareHasData(data.length > 0);
	      setCompareKlineError(null);

      const fillerStart = range ? Math.floor(range.start / 1000) : (data[0]?.time as number | undefined);
      const fillerEnd = range ? Math.floor(range.end / 1000) : (data[data.length - 1]?.time as number | undefined);
      if (typeof fillerStart === 'number' && typeof fillerEnd === 'number') {
        ensureTimeFiller(tf, fillerStart, fillerEnd);
      }

      const pending = pendingCompareVisibleRangeRef.current;
      if (pending && compareChartRef.current) {
        try {
          if (typeof pending.from === 'number' && typeof pending.to === 'number') {
            compareChartRef.current.timeScale().setVisibleRange(pending);
          } else if (typeof compareChartRef.current.timeScale().setVisibleLogicalRange === 'function') {
            compareChartRef.current.timeScale().setVisibleLogicalRange(pending);
          }
          pendingCompareVisibleRangeRef.current = null;
        } catch (err) {
          console.error(err);
        }
      }
    } catch (error) {
      console.error(error);
      if (requestId !== latestCompareRequestIdRef.current) return;
      compareSeriesRef.current.setData([]);
      compareVolumeSeriesRef.current.setData([]);
      compareCandlesByTimeRef.current = new Map();
      compareHasDataRef.current = false;
      setCompareHasData(false);
      setCompareKlineError(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === latestCompareRequestIdRef.current) {
        setCompareKlineLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    latestActiveTimeframeRef.current = activeTimeframe;
  }, [activeTimeframe]);

  useEffect(() => {
    latestCompareSymbolRef.current = compareSymbol;
    compareHasDataRef.current = false;
  }, [compareSymbol]);

  useEffect(() => {
    latestRangeForTradeRef.current = rangeForTrade;
  }, [rangeForTrade]);

  useEffect(() => {
    if (!rangeForTrade) return;
    ensureTimeFiller(
      activeTimeframe,
      Math.floor(rangeForTrade.start / 1000),
      Math.floor(rangeForTrade.end / 1000),
    );
  }, [activeTimeframe, rangeForTrade, ensureTimeFiller]);

  const hideSharedTimeline = useCallback(() => {
    if (!sharedTimelineRef.current) return;
    sharedTimelineRef.current.style.opacity = '0';
  }, []);

  const toggleFullscreen = useCallback(() => {
    const pane = chartsPaneRef.current;
    if (!pane) return;
    if (document.fullscreenElement === pane) {
      document.exitFullscreen?.();
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    }
    pane.requestFullscreen?.();
  }, []);

  const cancelPendingCrosshairSync = useCallback(() => {
    if (crosshairSyncRafRef.current == null) return;
    window.cancelAnimationFrame(crosshairSyncRafRef.current);
    crosshairSyncRafRef.current = null;
    pendingCrosshairSyncRef.current = null;
  }, []);

  const scheduleTargetCrosshairSync = useCallback((source: 'main' | 'compare', time: Time | null) => {
    if (!compareEnabledRef.current) return;

    pendingCrosshairSyncRef.current = { source, time };

    if (crosshairSyncRafRef.current != null) return;

    crosshairSyncRafRef.current = window.requestAnimationFrame(() => {
      crosshairSyncRafRef.current = null;

      const pending = pendingCrosshairSyncRef.current;
      pendingCrosshairSyncRef.current = null;
      if (!pending) return;
      if (!compareEnabledRef.current) return;

      const targetChart = pending.source === 'main' ? compareChartRef.current : chartRef.current;
      const targetSeries = pending.source === 'main' ? compareSeriesRef.current : seriesRef.current;

      if (!targetChart || !targetSeries) return;

      syncingCrosshairRef.current = true;
      try {
        if (pending.time == null) {
          targetChart.clearCrosshairPosition?.();
          return;
        }

        const targetCandle =
          pending.source === 'main'
            ? compareCandlesByTimeRef.current.get(pending.time)
            : mainCandlesByTimeRef.current.get(pending.time);

        if (targetCandle && typeof targetCandle.close === 'number' && typeof targetChart.setCrosshairPosition === 'function') {
          targetChart.setCrosshairPosition(targetCandle.close, pending.time, targetSeries);
        } else {
          targetChart.clearCrosshairPosition?.();
        }
      } catch (err) {
        console.error(err);
      } finally {
        syncingCrosshairRef.current = false;
      }
    });
  }, []);

  const updateSharedCrosshair = useCallback((source: 'main' | 'compare', param: any) => {
    if (syncingCrosshairRef.current) return;

    const paneEl = chartsPaneRef.current;
    const lineEl = sharedTimelineRef.current;
    if (!paneEl || !lineEl) return;

    const mainPlotEl = containerRef.current;
    const sourcePlotEl = source === 'main' ? containerRef.current : compareContainerRef.current;
    if (!mainPlotEl || !sourcePlotEl) return;

    const time = param?.time as Time | undefined;
    const point = param?.point as { x: number; y: number } | undefined;

    if (time == null || !point) {
      hideSharedTimeline();

      if (!compareEnabledRef.current) return;
      scheduleTargetCrosshairSync(source, null);
      return;
    }

    const paneRect = paneEl.getBoundingClientRect();
    const sourceRect = sourcePlotEl.getBoundingClientRect();
    const mainRect = mainPlotEl.getBoundingClientRect();
    const comparePlotEl = compareEnabledRef.current ? compareContainerRef.current : null;
    const compareRect = comparePlotEl?.getBoundingClientRect() ?? mainRect;

    const xInPane = sourceRect.left - paneRect.left + point.x;
    const top = Math.max(0, mainRect.top - paneRect.top);
    const bottom = Math.max(0, paneRect.bottom - compareRect.bottom);

    lineEl.style.left = `${Math.round(xInPane)}px`;
    lineEl.style.top = `${Math.round(top)}px`;
    lineEl.style.bottom = `${Math.round(bottom)}px`;
    lineEl.style.opacity = '1';

    if (!compareEnabledRef.current) return;
    scheduleTargetCrosshairSync(source, time);
  }, [hideSharedTimeline, scheduleTargetCrosshairSync]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: { 
        background: { color: 'transparent' }, 
        textColor: '#d1d4dc' 
      },
      grid: { 
        vertLines: { color: 'rgba(255, 255, 255, 0.1)' }, 
        horzLines: { color: 'rgba(255, 255, 255, 0.1)' } 
      },
      crosshair: { mode: 0 },
      timeScale: { timeVisible: true, secondsVisible: false },
      localization: { timeFormatter: formatUtc8Time },
    }) as any;
    chartRef.current = chart;

	    const series = chart.addSeries(CandlestickSeries, {
	      upColor: '#3D8A5A',
	      downColor: '#C45C5C',
	      borderVisible: false,
	      lastValueVisible: false,
	      priceLineVisible: false,
	      wickUpColor: '#3D8A5A',
	      wickDownColor: '#C45C5C',
    });
    seriesRef.current = series;
    chart.priceScale('right').applyOptions({
      scaleMargins: { top: 0.12, bottom: 0.28 },
      minimumWidth: 120,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.75, bottom: 0 },
      visible: false,
      borderVisible: false,
      ticksVisible: false,
    });
    volumeSeriesRef.current = volumeSeries;

    const anchorSeries = chart.addSeries(LineSeries, {
      priceScaleId: 'anchor',
      color: 'rgba(0,0,0,0)',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    } as any);
    chart.priceScale('anchor').applyOptions({
      visible: false,
      borderVisible: false,
      ticksVisible: false,
      scaleMargins: { top: 0, bottom: 0 },
    });
    mainAnchorSeriesRef.current = anchorSeries;
    applyTimeFiller('main');

    const onMainCrosshairMove = (param: any) => updateSharedCrosshair('main', param);
    chart.subscribeCrosshairMove?.(onMainCrosshairMove);

    const resizeMain = () => {
      if (!containerRef.current) return;
      if (containerRef.current.clientWidth === 0 || containerRef.current.clientHeight === 0) return;
      chart.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight });
    };
    const observer = new ResizeObserver(() => resizeMain());
    observer.observe(containerRef.current);
    requestAnimationFrame(resizeMain);

    return () => {
      observer.disconnect();
      chart.unsubscribeCrosshairMove?.(onMainCrosshairMove);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    compareEnabledRef.current = compareEnabled;
    if (!compareEnabled) {
      hideSharedTimeline();
      cancelPendingCrosshairSync();
    }
  }, [compareEnabled, hideSharedTimeline, cancelPendingCrosshairSync]);

  useEffect(() => {
    return () => cancelPendingCrosshairSync();
  }, [cancelPendingCrosshairSync]);

  useEffect(() => {
    if (!compareEnabled || !compareContainerRef.current) return;
    if (compareChartRef.current) return;

    const chart = createChart(compareContainerRef.current, {
      width: compareContainerRef.current.clientWidth,
      height: compareContainerRef.current.clientHeight,
      layout: {
        background: { color: 'transparent' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.1)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.1)' },
      },
      crosshair: { mode: 0 },
      timeScale: { timeVisible: true, secondsVisible: false },
      localization: { timeFormatter: formatUtc8Time },
      handleScroll: false,
      handleScale: false,
    }) as any;
    compareChartRef.current = chart;

	    const series = chart.addSeries(CandlestickSeries, {
	      upColor: '#3D8A5A',
	      downColor: '#C45C5C',
	      borderVisible: false,
	      lastValueVisible: false,
	      priceLineVisible: false,
	      wickUpColor: '#3D8A5A',
	      wickDownColor: '#C45C5C',
	    });
    compareSeriesRef.current = series;
    chart.priceScale('right').applyOptions({
      scaleMargins: { top: 0.12, bottom: 0.28 },
      minimumWidth: 120,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.75, bottom: 0 },
      visible: false,
      borderVisible: false,
      ticksVisible: false,
    });
    compareVolumeSeriesRef.current = volumeSeries;

    const anchorSeries = chart.addSeries(LineSeries, {
      priceScaleId: 'anchor',
      color: 'rgba(0,0,0,0)',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    } as any);
    chart.priceScale('anchor').applyOptions({
      visible: false,
      borderVisible: false,
      ticksVisible: false,
      scaleMargins: { top: 0, bottom: 0 },
    });
    compareAnchorSeriesRef.current = anchorSeries;
    applyTimeFiller('compare');

	    const onCompareCrosshairMove = (param: any) => updateSharedCrosshair('compare', param);
    chart.subscribeCrosshairMove?.(onCompareCrosshairMove);

	    const mainChart = chartRef.current;
	    const compare = compareChartRef.current;
	    let rangeSyncQueued = false;
	    let disposed = false;

		    const scheduleSyncFromMain = () => {
		      if (rangeSyncQueued) return;
		      rangeSyncQueued = true;
		      queueMicrotask(() => {
		        rangeSyncQueued = false;
		        if (disposed) return;
		        if (!compareEnabledRef.current) return;
		        const latestMainChart = chartRef.current;
		        const latestCompareChart = compareChartRef.current;
		        if (!latestMainChart || !latestCompareChart) return;

		        const timeRange = latestMainChart.timeScale().getVisibleRange?.();
		        if (!timeRange || timeRange.from == null || timeRange.to == null) return;

		        syncingRangeRef.current = true;
		        try {
		          ensureTimeFiller(latestActiveTimeframeRef.current, timeRange.from as number, timeRange.to as number);
		          try {
		            latestCompareChart.timeScale().setVisibleRange(timeRange);
		            pendingCompareVisibleRangeRef.current = null;
		          } catch (err) {
		            pendingCompareVisibleRangeRef.current = timeRange;
		            console.error(err);
		          }
		        } catch (err) {
		          console.error(err);
		        } finally {
		          requestAnimationFrame(() => {
		            syncingRangeRef.current = false;
		          });
		        }
		      });
		    };

		    const onMainRangeChange = () => {
		      if (syncingRangeRef.current) return;
		      scheduleSyncFromMain();
		    };

	    mainChart?.timeScale().subscribeVisibleTimeRangeChange?.(onMainRangeChange);
	    mainChart?.timeScale().subscribeVisibleLogicalRangeChange?.(onMainRangeChange);

	    loadCompareData(
	      latestActiveTimeframeRef.current,
	      latestCompareSymbolRef.current,
	      latestRangeForTradeRef.current ?? undefined,
	    );
	    const initialRange = visibleRangeForTrade ?? mainChart?.timeScale().getVisibleRange?.() ?? null;
	    if (initialRange && initialRange.from != null && initialRange.to != null) {
	      ensureTimeFiller(latestActiveTimeframeRef.current, initialRange.from as number, initialRange.to as number);
	      pendingCompareVisibleRangeRef.current = initialRange;
	      try {
	        compare?.timeScale().setVisibleRange(initialRange);
	      } catch (err) {
	        console.error(err);
	      }
	    }

    const resizeCompare = () => {
      if (!compareContainerRef.current) return;
      if (compareContainerRef.current.clientWidth === 0 || compareContainerRef.current.clientHeight === 0) return;
      chart.applyOptions({
        width: compareContainerRef.current.clientWidth,
        height: compareContainerRef.current.clientHeight,
      });
    };
    const observer = new ResizeObserver(() => resizeCompare());
    observer.observe(compareContainerRef.current);
    requestAnimationFrame(resizeCompare);

    return () => {
	    disposed = true;
      mainChart?.timeScale().unsubscribeVisibleTimeRangeChange?.(onMainRangeChange);
      mainChart?.timeScale().unsubscribeVisibleLogicalRangeChange?.(onMainRangeChange);
      observer.disconnect();
      chart.unsubscribeCrosshairMove?.(onCompareCrosshairMove);
      compareChartRef.current?.remove();
      compareChartRef.current = null;
      compareSeriesRef.current = null;
      compareVolumeSeriesRef.current = null;
      compareHasDataRef.current = false;
    };
  }, [compareEnabled, loadCompareData, visibleRangeForTrade]);

  useEffect(() => {
    if (!compareEnabled) return;
    if (!mainHasData) return;
    const mainChart = chartRef.current;
    const compareChart = compareChartRef.current;
    if (!mainChart || !compareChart) return;

    const range = mainChart.timeScale().getVisibleRange?.();
    if (!range || range.from == null || range.to == null) return;

    pendingCompareVisibleRangeRef.current = range;
    try {
      compareChart.timeScale().setVisibleRange(range);
    } catch {
      pendingCompareVisibleRangeRef.current = range;
    }
  }, [compareEnabled, mainHasData]);

  useEffect(() => {
    const effectiveSymbol = selectedTrade?.symbol || symbol;
    if (!effectiveSymbol) return;
    mainHasDataRef.current = false;
    loadMainData(activeTimeframe, effectiveSymbol, rangeForTrade ?? undefined);
  }, [symbol, activeTimeframe, loadMainData, rangeForTrade, selectedTrade]);

  useEffect(() => {
    if (!compareEnabled) return;
    if (!compareSymbol) return;
    loadCompareData(activeTimeframe, compareSymbol, rangeForTrade ?? undefined);
  }, [activeTimeframe, compareEnabled, compareSymbol, loadCompareData, rangeForTrade]);

  useEffect(() => {
    if (!selectedTrade) {
      markersRef.current?.setMarkers?.([]);
      const s = seriesRef.current;
      if (s) {
        if (priceLinesRef.current.entry) {
          s.removePriceLine(priceLinesRef.current.entry);
          priceLinesRef.current.entry = undefined;
        }
        if (priceLinesRef.current.exit) {
          s.removePriceLine(priceLinesRef.current.exit);
          priceLinesRef.current.exit = undefined;
        }
      }
      return;
    }
    if (!visibleRangeForTrade) return;
    const targetRange = { from: visibleRangeForTrade.from, to: visibleRangeForTrade.to };
    if (mainHasDataRef.current) {
      try {
        chartRef.current?.timeScale().setVisibleRange(targetRange);
      } catch (err) {
        console.error(err);
      }
    } else {
      pendingMainVisibleRangeRef.current = targetRange;
    }
    if (compareEnabledRef.current) {
      pendingCompareVisibleRangeRef.current = targetRange;
      try {
        compareChartRef.current?.timeScale().setVisibleRange(targetRange);
      } catch {
        pendingCompareVisibleRangeRef.current = targetRange;
      }
    }
  }, [selectedTrade, visibleRangeForTrade, mainHasData]);

  useEffect(() => {
    if (!selectedTrade || !mainHasData) {
      markersRef.current?.setMarkers?.([]);
      return;
    }
    applyTradeMarkers();
  }, [mainHasData, selectedTrade, tradeFills, activeTimeframe, applyTradeMarkers]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div ref={chartsPaneRef} className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-base-100/30 ring-1 ring-white/[0.06]">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <div className="text-sm text-base-content/75">
                主图: <span className="font-mono">{selectedTrade?.symbol || symbol}</span>
                {mainKlineLoading && <span className="loading loading-spinner loading-xs ml-2" />}
                {mainKlineError && !mainHasData && (
                  <span className="ml-2 text-xs text-error truncate max-w-[240px]">{mainKlineError}</span>
                )}
                {selectedTrade && mainHasData && tradeFills.length > 0 && (
                  <span className="ml-2 text-xs text-base-content/50">成交 {tradeFills.length} 笔 → K 线标注</span>
                )}
                {selectedTrade && mainHasData && tradeFills.length === 0 && (
                  <span className="ml-2 text-xs text-warning">无成交明细，仅均价线；请用交易历史模板重新导入</span>
                )}
                {drawMode === 'hline' ? (
                  <span className="ml-2 text-xs text-[#D97757]">点击主图放置水平线</span>
                ) : null}
                {drawMode === 'ruler' ? (
                  <span className="ml-2 text-xs text-[#D97757]">{rulerHint || '点击第一点'}</span>
                ) : null}
              </div>
              <div className="tabs tabs-boxed tabs-sm p-0.5">
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf}
                    className={`tab tab-sm ${activeTimeframe === tf ? 'tab-active' : ''}`}
                    onClick={() => setActiveTimeframe(tf)}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className={`btn btn-sm btn-square ${drawMode === 'ruler' ? 'bg-[#D97757] text-[#141413] border-0 hover:bg-[#D97757]/90' : 'btn-ghost border border-white/[0.08]'}`}
                title="尺子：主图点两下测价差与时间"
                onClick={() => {
                  if (drawMode === 'ruler') {
                    clearRuler();
                    setDrawMode('none');
                  } else {
                    clearRuler();
                    setDrawMode('ruler');
                  }
                }}
              >
                <Ruler className="h-4 w-4" strokeWidth={2} />
              </button>
              <button
                type="button"
                className={`btn btn-sm btn-square ${drawMode === 'hline' ? 'bg-[#D97757] text-[#141413] border-0 hover:bg-[#D97757]/90' : 'btn-ghost border border-white/[0.08]'}`}
                title="水平线：点击主图放置（线宽 3px）"
                onClick={() => {
                  rulerCornerRef.current = null;
                  setDrawMode((m) => (m === 'hline' ? 'none' : 'hline'));
                }}
              >
                <Minus className="h-4 w-4" strokeWidth={2} />
              </button>
              <button
                type="button"
                className="btn btn-sm btn-square btn-ghost border border-white/[0.08]"
                title="清除手动画线"
                onClick={clearUserDrawnLines}
              >
                <Eraser className="h-4 w-4" strokeWidth={2} />
              </button>
              <button
                type="button"
                className={`btn btn-sm ${isFullscreen ? 'bg-[#D97757] text-[#141413] border-0 hover:bg-[#D97757]/90' : 'btn-ghost border border-white/[0.08]'}`}
                onClick={toggleFullscreen}
                title={isFullscreen ? '退出全屏' : '全屏查看'}
              >
                {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <button
                type="button"
                className={`btn btn-sm ${compareEnabled ? 'bg-[#D97757] text-[#141413] border-0 hover:bg-[#D97757]/90' : 'btn-ghost border border-white/[0.08]'}`}
                onClick={() => setCompareEnabled((v) => !v)}
              >
                {compareEnabled ? '隐藏对比' : '多交易对对比'}
              </button>
            </div>
          </div>
          <div className="relative flex-1 min-h-0">
            <div
              ref={containerRef}
              className={`absolute inset-0 ${drawMode !== 'none' ? 'cursor-crosshair' : ''}`}
            />
            <canvas
              ref={rulerCanvasRef}
              className="pointer-events-none absolute inset-0 z-10"
              aria-hidden
            />
          </div>
        </div>

        {compareEnabled && (
          <div className="bg-base-100 border border-base-300 rounded-box flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-base-300">
              <div className="flex items-center gap-3 min-w-0">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => compareModalRef.current?.showModal()}>
                  对比: <span className="font-mono">{compareSymbol}</span>
                  {compareKlineLoading && <span className="loading loading-spinner loading-xs ml-2" />}
                  {compareKlineError && !compareHasData && (
                    <span className="ml-2 text-xs text-error truncate max-w-[240px]">{compareKlineError}</span>
                  )}
                </button>
                <div className="tabs tabs-bordered">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf}
                      className={`tab tab-sm tab-bordered ${activeTimeframe === tf ? 'tab-active' : ''}`}
                      onClick={() => setActiveTimeframe(tf)}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button type="button" className="btn btn-sm" onClick={() => setCompareEnabled(false)}>
                  隐藏对比
                </button>
              </div>
            </div>
            <div ref={compareContainerRef} className="flex-1 min-h-0" />
          </div>
        )}

        <div
          ref={sharedTimelineRef}
          className="pointer-events-none absolute w-px bg-base-content/40 opacity-0"
          style={{ left: 0, top: 0, bottom: 0, zIndex: 10 }}
        />
      </div>

      <dialog ref={compareModalRef} className="modal modal-bottom sm:modal-middle">
        <div className="modal-box w-11/12 max-w-xl p-0 overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-2xl">
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-base-300 bg-base-200/40">
            <div className="min-w-0">
              <h3 className="font-bold text-lg leading-none">选择对比交易对</h3>
              <div className="text-xs text-base-content/60 mt-1 truncate">对比图将与主图同步时间范围</div>
            </div>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => compareModalRef.current?.close()}>
              关闭
            </button>
          </div>

          <div className="px-5 pt-4 pb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                const base = selectedTrade?.symbol || symbol || DEFAULT_COMPARE_SYMBOL;
                setCompareSymbol(base);
                compareModalRef.current?.close();
              }}
            >
              使用当前仓位交易对
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setCompareSymbol(DEFAULT_COMPARE_SYMBOL);
                compareModalRef.current?.close();
              }}
            >
              默认 {DEFAULT_COMPARE_SYMBOL}
            </button>
          </div>

          <div className="px-5 pb-3">
            <label className="input input-bordered flex items-center gap-2 bg-base-200/40 focus-within:outline-none focus-within:ring-2 focus-within:ring-primary/30">
              <input
                className="grow"
                type="search"
                placeholder="搜索交易对..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
            </label>
          </div>

          <div className="px-2 pb-4 max-h-[60vh] overflow-y-auto">
            <div className="space-y-1">
              {(symbolOptions.length ? symbolOptions : [{ value: DEFAULT_COMPARE_SYMBOL, label: DEFAULT_COMPARE_SYMBOL }])
                .filter((opt) => {
                  const q = searchQuery.trim().toLowerCase();
                  if (!q) return true;
                  return opt.label.toLowerCase().includes(q);
                })
                .map((opt) => {
                  const isSelected = opt.value === compareSymbol;

                  return (
                    <button
                      key={opt.value}
                      type="button"
                      className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-base-200/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                        isSelected ? 'bg-primary/10 text-primary' : ''
                      }`}
                      onClick={() => {
                        setCompareSymbol(opt.value);
                        compareModalRef.current?.close();
                      }}
                    >
                      <span className="font-mono truncate">{opt.label}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button type="submit" className="sr-only" aria-label="close">
            close
          </button>
        </form>
      </dialog>
    </div>
  );
}

export default ChartManager;
