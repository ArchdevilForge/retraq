import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import { Eraser, Maximize2, Minimize2, Minus, Ruler } from 'lucide-react';
import type { Kline, Timeframe } from '../services/api';
import { mountCandleVolumeChart } from '../utils/candleChart';
import {
  applyCandleChartTheme,
  klinesToVolume,
  readChartTheme,
  rulerStyleFromTheme,
} from '../utils/chartTheme';
import type { SimMarker } from '../utils/training';
import { TIMEFRAME_MS } from '../utils/training';
import { useTheme } from '../context/ThemeContext';
import {
  clearRulerCanvas,
  drawRulerOnCanvas,
  measureRuler,
  syncOverlayCanvasSize,
  type RulerCorner,
} from './chartRulerOverlay';

const DEFAULT_COMPARE_SYMBOL = 'BTC-USDT';
const DEFAULT_BAR_SPACING = 8;

type Props = {
  symbol: string;
  timeframe: Timeframe;
  klines: Kline[];
  scenarioFromSec: number;
  scenarioToSec: number;
  compareSymbol?: string | null;
  compareKlines?: Kline[] | null;
  compareLoading?: boolean;
  compareError?: string | null;
  symbolOptions?: string[];
  markers?: SimMarker[];
  onSelectCompare?: (symbol: string) => void;
  onClearCompare?: () => void;
};

type ChartBundle = {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
};

function toCandles(klines: Kline[]) {
  return klines.map((k) => ({
    time: k.time as Time,
    open: k.open,
    high: k.high,
    low: k.low,
    close: k.close,
  }));
}

function buildMarkers(markers: SimMarker[] | undefined): SeriesMarker<Time>[] {
  if (!markers?.length) return [];
  return markers.map((m) => ({
    time: m.time as Time,
    position: m.side === 'entry' ? 'belowBar' : 'aboveBar',
    color: m.direction === 'long' ? '#30D158' : '#FF3B30',
    shape: m.side === 'entry' ? (m.direction === 'long' ? 'arrowUp' : 'arrowDown') : 'circle',
    text: m.label,
  }));
}

function mountChart(el: HTMLElement): ChartBundle {
  return mountCandleVolumeChart(el, readChartTheme(), {
    chartOptions: {
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: DEFAULT_BAR_SPACING,
        minBarSpacing: 1,
        // append bars without re-fitting whole history (stable playback speed)
        shiftVisibleRangeOnNewBar: true,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      rightPriceScale: { scaleMargins: { top: 0.12, bottom: 0.22 } },
    },
    volumeScaleMargins: { top: 0.8, bottom: 0 },
  });
}

function syncCompareRange(
  main: IChartApi | null,
  compare: IChartApi | null,
  syncing: { current: boolean },
) {
  if (!main || !compare || syncing.current) return;
  let range: { from: Time; to: Time } | null = null;
  try {
    range = main.timeScale().getVisibleRange?.() ?? null;
  } catch {
    return;
  }
  if (!range || range.from == null || range.to == null) return;
  syncing.current = true;
  try {
    compare.timeScale().setVisibleRange(range);
  } catch {
    /* ignore */
  } finally {
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  }
}

export default function TrainingChart({
  symbol,
  timeframe,
  klines,
  scenarioFromSec: _scenarioFromSec,
  scenarioToSec: _scenarioToSec,
  compareSymbol,
  compareKlines,
  compareLoading = false,
  compareError = null,
  symbolOptions = [],
  markers,
  onSelectCompare,
  onClearCompare,
}: Props) {
  void _scenarioFromSec;
  void _scenarioToSec;

  const shellRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const compareRef = useRef<HTMLDivElement>(null);
  const rulerCanvasRef = useRef<HTMLCanvasElement>(null);
  const compareModalRef = useRef<HTMLDialogElement>(null);

  const mainApi = useRef<
    (ChartBundle & { markerApi: { setMarkers: (m: SeriesMarker<Time>[]) => void } | null }) | null
  >(null);
  const compareApi = useRef<ChartBundle | null>(null);
  const userPriceLinesRef = useRef<IPriceLine[]>([]);
  const rulerCornerRef = useRef<RulerCorner | null>(null);
  const rulerPreviewRef = useRef<RulerCorner | null>(null);
  const rulerResultRef = useRef<{ a: RulerCorner; b: RulerCorner } | null>(null);
  const timeframeRef = useRef(timeframe);
  useEffect(() => {
    timeframeRef.current = timeframe;
  }, [timeframe]);
  const syncingRangeRef = useRef(false);
  const followEndRef = useRef(true);
  const prevKlineLenRef = useRef(0);
  const lastCandleTimeRef = useRef<number | null>(null);
  const didInitViewRef = useRef(false);
  const [chartEpoch, setChartEpoch] = useState(0);

  const { theme } = useTheme();
  const compareEnabled = Boolean(compareSymbol);
  const showComparePane = Boolean(compareSymbol && compareKlines && compareKlines.length > 0);
  const [drawMode, setDrawMode] = useState<'none' | 'hline' | 'ruler'>('none');
  const [rulerHint, setRulerHint] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [customSymbol, setCustomSymbol] = useState('');

  const pickerOptions = useMemo(() => {
    const base = [
      DEFAULT_COMPARE_SYMBOL,
      symbol,
      ...symbolOptions,
      ...(compareSymbol ? [compareSymbol] : []),
    ];
    return [...new Set(base.filter(Boolean))].map((s) => ({ value: s, label: s }));
  }, [symbol, symbolOptions, compareSymbol]);

  const remapRulerCorner = useCallback((c: RulerCorner): RulerCorner | null => {
    const chart = mainApi.current?.chart;
    const series = mainApi.current?.series;
    if (!chart || !series) return null;
    const x = chart.timeScale().timeToCoordinate(c.time);
    const y = series.priceToCoordinate(c.price);
    if (x == null || y == null) return null;
    return { time: c.time, price: c.price, x, y };
  }, []);

  const paintRulerOverlay = useCallback(() => {
    const canvas = rulerCanvasRef.current;
    const container = mainRef.current;
    if (!canvas || !container) return;
    syncOverlayCanvasSize(canvas, container);
    const step = Math.floor(TIMEFRAME_MS[timeframeRef.current] / 1000);
    const rulerStyle = rulerStyleFromTheme(readChartTheme());
    const pair = rulerResultRef.current;
    if (pair) {
      const a = remapRulerCorner(pair.a);
      const b = remapRulerCorner(pair.b);
      if (!a || !b) return;
      drawRulerOnCanvas(canvas, a, b, measureRuler(a, b, step), rulerStyle);
      return;
    }
    const start = rulerCornerRef.current;
    const preview = rulerPreviewRef.current;
    if (start && preview) {
      const a = remapRulerCorner(start) ?? start;
      const b = remapRulerCorner(preview) ?? preview;
      drawRulerOnCanvas(canvas, a, b, measureRuler(a, b, step), rulerStyle);
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
    const series = mainApi.current?.series;
    if (series) {
      for (const line of userPriceLinesRef.current) {
        try {
          series.removePriceLine(line);
        } catch {
          /* already gone */
        }
      }
    }
    userPriceLinesRef.current = [];
    clearRuler();
  }, [clearRuler]);

  useEffect(() => {
    clearUserDrawnLines();
    didInitViewRef.current = false;
    followEndRef.current = true;
    prevKlineLenRef.current = 0;
  }, [symbol, clearUserDrawnLines]);

  // mount main
  useEffect(() => {
    if (!mainRef.current) return;
    const m = mountChart(mainRef.current);
    mainApi.current = { ...m, markerApi: null };
    didInitViewRef.current = false;
    prevKlineLenRef.current = 0;
    setChartEpoch((e) => e + 1);

    const onRangeChange = () => {
      if (syncingRangeRef.current) return;
      // Auto-follow only when right edge is near latest candle
      try {
        const range = m.chart.timeScale().getVisibleRange?.();
        const lastT = lastCandleTimeRef.current;
        if (range && typeof range.to === 'number' && lastT != null) {
          const step = Math.floor(TIMEFRAME_MS[timeframeRef.current] / 1000);
          const to = range.to as number;
          followEndRef.current = to >= lastT - step * 3 && to <= lastT + step * 20;
        }
      } catch {
        /* ignore */
      }
      syncCompareRange(m.chart, compareApi.current?.chart ?? null, syncingRangeRef);
    };
    m.chart.timeScale().subscribeVisibleTimeRangeChange?.(onRangeChange);
    m.chart.timeScale().subscribeVisibleLogicalRangeChange?.(onRangeChange);

    const ro = new ResizeObserver(() => {
      if (!mainRef.current) return;
      m.chart.applyOptions({
        width: mainRef.current.clientWidth,
        height: mainRef.current.clientHeight,
      });
      if (rulerResultRef.current || rulerCornerRef.current) paintRulerOverlay();
      syncCompareRange(m.chart, compareApi.current?.chart ?? null, syncingRangeRef);
    });
    ro.observe(mainRef.current);

    return () => {
      m.chart.timeScale().unsubscribeVisibleTimeRangeChange?.(onRangeChange);
      m.chart.timeScale().unsubscribeVisibleLogicalRangeChange?.(onRangeChange);
      ro.disconnect();
      m.chart.remove();
      mainApi.current = null;
    };
  }, [paintRulerOverlay]);

  // mount compare
  useEffect(() => {
    if (!showComparePane || !compareRef.current) {
      if (compareApi.current) {
        compareApi.current.chart.remove();
        compareApi.current = null;
      }
      return;
    }
    const c = mountChart(compareRef.current);
    compareApi.current = c;
    syncCompareRange(mainApi.current?.chart ?? null, c.chart, syncingRangeRef);

    const ro = new ResizeObserver(() => {
      if (!compareRef.current) return;
      c.chart.applyOptions({
        width: compareRef.current.clientWidth,
        height: compareRef.current.clientHeight,
      });
      syncCompareRange(mainApi.current?.chart ?? null, c.chart, syncingRangeRef);
    });
    ro.observe(compareRef.current);
    return () => {
      ro.disconnect();
      c.chart.remove();
      compareApi.current = null;
    };
  }, [showComparePane]);

  // main data
  useEffect(() => {
    const m = mainApi.current;
    if (!m) return;
    const themeNow = readChartTheme();
    applyCandleChartTheme(m.chart, m.series, themeNow);

    const candles = toCandles(klines);
    const len = klines.length;
    const last = klines[len - 1];
    lastCandleTimeRef.current = last?.time ?? null;

    m.series.setData(candles);
    m.volume.setData(klinesToVolume(klines, themeNow));

    const seriesMarkers = buildMarkers(markers);
    if (m.markerApi) {
      m.markerApi.setMarkers(seriesMarkers);
    } else if (candles.length) {
      m.markerApi = createSeriesMarkers(m.series, seriesMarkers);
    }

    if (candles.length) {
      if (!didInitViewRef.current) {
        // First paint: fit all currently revealed bars
        try {
          m.chart.timeScale().fitContent();
        } catch {
          /* ignore */
        }
        didInitViewRef.current = true;
        followEndRef.current = true;
      } else if (followEndRef.current && len > prevKlineLenRef.current) {
        // Playback: keep spacing, stick to newest bar (no full re-fit → no "speed up")
        try {
          m.chart.timeScale().scrollToRealTime();
        } catch {
          /* ignore */
        }
      }
    }
    prevKlineLenRef.current = len;

    syncCompareRange(m.chart, compareApi.current?.chart ?? null, syncingRangeRef);
    if (rulerResultRef.current || rulerCornerRef.current) paintRulerOverlay();
  }, [klines, markers, theme, paintRulerOverlay, chartEpoch]);

  // compare data
  useEffect(() => {
    const c = compareApi.current;
    if (!c || !compareKlines) return;
    const themeNow = readChartTheme();
    applyCandleChartTheme(c.chart, c.series, themeNow);
    c.series.setData(toCandles(compareKlines));
    c.volume.setData(klinesToVolume(compareKlines, themeNow));
    syncCompareRange(mainApi.current?.chart ?? null, c.chart, syncingRangeRef);
  }, [compareKlines, theme, showComparePane]);

  // draw tools
  useEffect(() => {
    const el = mainRef.current;
    if (!el || drawMode === 'none') return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const chart = mainApi.current?.chart;
      const series = mainApi.current?.series;
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
          color: readChartTheme().hline,
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
    const el = mainRef.current;
    if (!el || drawMode !== 'ruler') return;
    let raf = 0;
    const onPointerMove = (e: PointerEvent) => {
      if (!rulerCornerRef.current) return;
      const chart = mainApi.current?.chart;
      const series = mainApi.current?.series;
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
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = () => {
    const el = shellRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen();
  };

  return (
    <div ref={shellRef} className="flex min-h-0 flex-1 flex-col gap-1 bg-[var(--background-base)]">
      <div className="oc-chart-shell flex min-h-0 flex-1 flex-col">
        <div className="oc-chart-toolbar">
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <span className="font-mono">{symbol}</span>
            <span className="opacity-60">{timeframe}</span>
            {drawMode === 'hline' ? (
              <span className="oc-text-accent">点击主图放置水平线</span>
            ) : null}
            {drawMode === 'ruler' ? (
              <span className="oc-text-accent">{rulerHint || '点击第一点'}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className={`oc-icon-btn oc-icon-btn--sm${drawMode === 'ruler' ? ' oc-btn--ghost-selected' : ''}`}
              title="尺子"
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
              className={`oc-icon-btn oc-icon-btn--sm${drawMode === 'hline' ? ' oc-btn--ghost-selected' : ''}`}
              title="水平线"
              onClick={() => {
                rulerCornerRef.current = null;
                setDrawMode((mode) => (mode === 'hline' ? 'none' : 'hline'));
              }}
            >
              <Minus className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              className="oc-icon-btn oc-icon-btn--sm"
              title="清除手动画线"
              onClick={clearUserDrawnLines}
            >
              <Eraser className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              className={`oc-btn oc-btn--sm oc-btn--secondary${isFullscreen ? ' oc-btn--ghost-selected' : ''}`}
              title={isFullscreen ? '退出全屏' : '全屏'}
              onClick={toggleFullscreen}
            >
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button
              type="button"
              className={`oc-btn oc-btn--sm oc-btn--secondary${compareEnabled ? ' oc-btn--ghost-selected' : ''}`}
              onClick={() => {
                if (compareEnabled) {
                  onClearCompare?.();
                } else {
                  const fallback =
                    symbol === DEFAULT_COMPARE_SYMBOL ? 'ETH-USDT' : DEFAULT_COMPARE_SYMBOL;
                  onSelectCompare?.(fallback);
                }
              }}
            >
              {compareEnabled ? '隐藏对比' : '多交易对对比'}
            </button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          <div
            ref={mainRef}
            className={`absolute inset-0 ${drawMode !== 'none' ? 'cursor-crosshair' : ''}`}
          />
          <canvas
            ref={rulerCanvasRef}
            className="pointer-events-none absolute inset-0 z-10 h-full w-full"
          />
        </div>
      </div>

      {compareEnabled ? (
        <div className="oc-chart-shell flex min-h-0 flex-1 flex-col">
          <div className="oc-chart-toolbar">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                className="oc-btn oc-btn--sm oc-btn--ghost"
                onClick={() => compareModalRef.current?.showModal()}
              >
                对比: <span className="font-mono">{compareSymbol}</span>
                {compareLoading ? <span className="oc-spinner ml-2 align-middle" /> : null}
                {compareError && !showComparePane ? (
                  <span className="ml-2 max-w-[240px] truncate text-[12px] oc-text-loss">
                    {compareError}
                  </span>
                ) : null}
              </button>
            </div>
            <button
              type="button"
              className="oc-btn oc-btn--sm oc-btn--secondary"
              onClick={() => onClearCompare?.()}
            >
              隐藏对比
            </button>
          </div>
          <div ref={compareRef} className="min-h-0 flex-1" />
        </div>
      ) : null}

      <dialog ref={compareModalRef} className="oc-modal w-[min(36rem,92vw)]">
        <div className="oc-modal__header">
          <div className="min-w-0">
            <h3 className="text-[16px] font-medium leading-none">选择对比交易对</h3>
            <div className="mt-1 truncate text-[12px] oc-text-faint">
              对比图与主图同步时间轴与遮罩
            </div>
          </div>
          <button
            type="button"
            className="oc-btn oc-btn--sm oc-btn--ghost"
            onClick={() => compareModalRef.current?.close()}
          >
            关闭
          </button>
        </div>

        <div className="oc-modal__body flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="oc-btn oc-btn--sm oc-btn--secondary"
            onClick={() => {
              onSelectCompare?.(DEFAULT_COMPARE_SYMBOL);
              compareModalRef.current?.close();
            }}
          >
            默认 {DEFAULT_COMPARE_SYMBOL}
          </button>
          <div className="oc-input-wrap flex min-w-[12rem] flex-1 items-center gap-1">
            <input
              className="oc-input flex-1"
              placeholder="自定义交易对"
              value={customSymbol}
              onChange={(e) => setCustomSymbol(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customSymbol.trim()) {
                  onSelectCompare?.(customSymbol.trim());
                  compareModalRef.current?.close();
                }
              }}
            />
            <button
              type="button"
              className="oc-btn oc-btn--sm oc-btn--primary"
              onClick={() => {
                if (!customSymbol.trim()) return;
                onSelectCompare?.(customSymbol.trim());
                compareModalRef.current?.close();
              }}
            >
              确定
            </button>
          </div>
        </div>

        <div className="px-3.5 pb-3">
          <div className="oc-input-wrap">
            <input
              className="oc-input"
              type="search"
              placeholder="搜索交易对..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-2 pb-3">
          <div className="space-y-0.5">
            {pickerOptions
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
                    className={`oc-list-item${isSelected ? ' oc-list-item--active' : ''}`}
                    onClick={() => {
                      onSelectCompare?.(opt.value);
                      compareModalRef.current?.close();
                    }}
                  >
                    <span className="truncate font-mono">{opt.label}</span>
                  </button>
                );
              })}
          </div>
        </div>
      </dialog>
    </div>
  );
}
