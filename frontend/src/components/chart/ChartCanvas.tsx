import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import { Eraser, Maximize2, Minimize2, Minus, Percent, Ruler, Square, TrendingUp } from 'lucide-react';
import type { ChartDrawing, DrawingKind, DrawingPoint, Kline, Timeframe } from '../../services/api';
import { TIMEFRAMES } from '../../services/api';
import { mountCandleVolumeChart } from '../../utils/candleChart';
import {
  applyCandleChartTheme,
  klinesToVolume,
  readChartTheme,
  rulerStyleFromTheme,
} from '../../utils/chartTheme';
import { TIMEFRAME_MS } from '../../utils/training';
import { fmtDateTime } from '../../utils/format';
import {
  clearRulerCanvas,
  drawRulerOnCanvas,
  measureRuler,
  syncOverlayCanvasSize,
  type RulerCorner,
} from '../chartRulerOverlay';

const DEFAULT_COMPARE_SYMBOL = 'BTC-USDT';
const DEFAULT_BAR_SPACING = 8;

/** Engine-managed horizontal line (entry/exit/liquidation/planned SL-TP ...). */
export type ChartPriceLine = {
  price: number;
  title: string;
  color: string;
  dashed?: boolean;
  /** User-adjustable via vertical drag (e.g. 止损/止盈 bracket lines). */
  draggable?: boolean;
};

export type ChartCompare = {
  symbol: string;
  klines: Kline[] | null;
  loading?: boolean;
  error?: string | null;
};

type DrawMode = 'none' | 'hline' | 'ruler' | 'trend' | 'region' | 'fib';

const TWO_POINT_HINTS: Partial<Record<DrawMode, string>> = {
  trend: '趋势线：点两下确定两端',
  region: '区域：点两下圈定区间',
  fib: '斐波那契：点两下确定波段',
};

type Props = {
  symbol: string;
  timeframe: Timeframe;
  klines: Kline[];
  loading?: boolean;
  error?: string | null;
  /** Extra status text rendered in the toolbar's left group. */
  status?: ReactNode;
  markers?: SeriesMarker<Time>[];
  /** Engine keeps these in sync: old lines are removed when the spec changes. */
  priceLines?: ChartPriceLine[];
  /** Train playback: stick to the newest bar without refitting the whole history. */
  playback?: boolean;
  /** Apply `visibleRange` once data is ready (trade-anchored views). */
  visibleRange?: { from: Time; to: Time } | null;
  compare?: ChartCompare | null;
  compareOptions?: { value: string; label: string }[];
  onSelectCompare?: (symbol: string) => void;
  onClearCompare?: () => void;
  onTimeframeChange?: (tf: Timeframe) => void;
  /** Toolbar shows timeframe tabs (replay) or a plain label (train controls its own bar). */
  showTimeframeTabs?: boolean;
  /** Persisted drawings bound to symbol + time region (docs/DESIGN.md §6). */
  drawings?: ChartDrawing[];
  /** Called when the user completes a drawing with the shape tools. */
  onUserDrawing?: (kind: DrawingKind, payload: DrawingPoint[]) => void;
  /** Eraser pressed: caller decides persistence scope (falls back to in-memory clear). */
  onEraseDrawings?: () => void;
  /** Drag-end of a draggable price line (图上拖线调 止损/止盈, docs/PRODUCT.md §六). */
  onDragPriceLine?: (title: string, price: number) => void;
  /** 复盘模式自由时间游标：有回调即可拖动，游标线常驻（docs/DESIGN.md §2.3）。 */
  cursorTime?: number | null;
  onCursorDrag?: (timeSec: number) => void;
  /** 工具栏最右预留槽宽度（px）。宿主页面用自己的稳定按钮层覆盖它，
      避免把动态 ReactNode 塞进图表子树导致重挂载。 */
  toolbarSlotWidth?: number;
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
      rightPriceScale: { scaleMargins: { top: 0.12, bottom: 0.22 }, minimumWidth: 120 },
    },
    volumeScaleMargins: { top: 0.75, bottom: 0 },
    volumeScaleExtra: { borderVisible: false, ticksVisible: false },
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
    range = (main.timeScale().getVisibleRange?.() as { from: Time; to: Time } | null) ?? null;
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

/**
 * The one chart engine behind 复盘 / 训练 / 高手 (docs/DESIGN.md §2, §10).
 * Controlled presentation: data in via props, overlays managed by the engine.
 */
export default function ChartCanvas({
  symbol,
  timeframe,
  klines,
  loading = false,
  error = null,
  status,
  markers,
  priceLines,
  playback = false,
  visibleRange = null,
  compare,
  compareOptions = [],
  onSelectCompare,
  onClearCompare,
  onTimeframeChange,
  showTimeframeTabs = true,
  drawings,
  onUserDrawing,
  onEraseDrawings,
  onDragPriceLine,
  cursorTime,
  onCursorDrag,
  toolbarSlotWidth,
}: Props) {
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
  const managedPriceLinesRef = useRef<IPriceLine[]>([]);
  const rulerCornerRef = useRef<RulerCorner | null>(null);
  const rulerPreviewRef = useRef<RulerCorner | null>(null);
  const rulerResultRef = useRef<{ a: RulerCorner; b: RulerCorner } | null>(null);
  const timeframeRef = useRef(timeframe);
  useEffect(() => {
    timeframeRef.current = timeframe;
  }, [timeframe]);
  const drawingsRef = useRef<ChartDrawing[]>(drawings ?? []);
  useEffect(() => {
    drawingsRef.current = drawings ?? [];
  }, [drawings]);
  const syncingRangeRef = useRef(false);
  const followEndRef = useRef(true);
  const prevKlineLenRef = useRef(0);
  const lastCandleTimeRef = useRef<number | null>(null);
  const didInitViewRef = useRef(false);
  const pendingRangeRef = useRef<{ from: Time; to: Time } | null>(null);
  const [chartEpoch, setChartEpoch] = useState(0);
  const [chartTheme, setChartTheme] = useState(() => readChartTheme());
  const [drawMode, setDrawMode] = useState<DrawMode>('none');
  const [rulerHint, setRulerHint] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [customSymbol, setCustomSymbol] = useState('');

  const compareEnabled = Boolean(compare);
  const showComparePane = Boolean(compare?.klines && compare.klines.length > 0);

  const pickerOptions = useMemo(() => {
    const base = [
      { value: DEFAULT_COMPARE_SYMBOL, label: DEFAULT_COMPARE_SYMBOL },
      ...(symbol ? [{ value: symbol, label: symbol }] : []),
      ...compareOptions,
      ...(compare ? [{ value: compare.symbol, label: compare.symbol }] : []),
    ].filter((o) => Boolean(o.value));
    const byValue = new Map<string, { value: string; label: string }>();
    for (const o of base) {
      if (!byValue.has(o.value)) byValue.set(o.value, o);
    }
    return [...byValue.values()];
  }, [symbol, compareOptions, compare]);

  // ThemeProvider writes data-theme from a parent effect, which React runs after this
  // child's effects; observe the attribute so chart colors never lag a toggle.
  useEffect(() => {
    const observer = new MutationObserver(() => setChartTheme(readChartTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const remapRulerCorner = useCallback((c: RulerCorner): RulerCorner | null => {
    const chart = mainApi.current?.chart;
    const series = mainApi.current?.series;
    if (!chart || !series) return null;
    const x = chart.timeScale().timeToCoordinate(c.time);
    const y = series.priceToCoordinate(c.price);
    if (x == null || y == null) return null;
    return { time: c.time, price: c.price, x, y };
  }, []);

  const mapDrawingPoint = useCallback(
    (p: DrawingPoint): { x: number; y: number } | null => {
      const chart = mainApi.current?.chart;
      const series = mainApi.current?.series;
      if (!chart || !series) return null;
      const x = chart.timeScale().timeToCoordinate((p.time_ms / 1000) as Time);
      const y = series.priceToCoordinate(p.price);
      if (x == null || y == null) return null;
      return { x, y };
    },
    [],
  );

  const drawPersistedShape = useCallback(
    (ctx: CanvasRenderingContext2D, drawing: ChartDrawing) => {
      const style = rulerStyleFromTheme(readChartTheme());
      const points = drawing.payload.map(mapDrawingPoint);
      if (points.some((p) => p == null)) return;
      const pts = points as { x: number; y: number }[];

      if (drawing.kind === 'hline' && pts.length === 1) {
        ctx.strokeStyle = style.rulerStroke;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(0, pts[0].y);
        ctx.lineTo(ctx.canvas.width, pts[0].y);
        ctx.stroke();
        return;
      }
      if (pts.length !== 2) return;
      const [a, b] = pts;

      if (drawing.kind === 'trend') {
        ctx.strokeStyle = style.rulerStroke;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        return;
      }
      if (drawing.kind === 'region') {
        ctx.fillStyle = style.rulerFill;
        ctx.strokeStyle = style.rulerStroke;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        ctx.fillRect(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        ctx.strokeRect(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        return;
      }
      if (drawing.kind === 'fib') {
        const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
        const left = Math.min(a.x, b.x);
        const right = Math.max(a.x, b.x);
        ctx.font = '10px var(--oc-font-mono, monospace)';
        for (const lv of levels) {
          const priceA = drawing.payload[0].price;
          const priceB = drawing.payload[1].price;
          const price = priceA + (priceB - priceA) * lv;
          const y = seriesPriceToY(price);
          if (y == null) continue;
          ctx.strokeStyle = style.rulerStroke;
          ctx.globalAlpha = lv === 0 || lv === 1 ? 0.9 : 0.55;
          ctx.setLineDash(lv === 0 || lv === 1 ? [] : [4, 4]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.fillStyle = style.rulerLabelBg;
          ctx.fillRect(right + 2, y - 7, 44, 14);
          ctx.fillStyle = style.rulerLabelText;
          ctx.fillText(`${(lv * 100).toFixed(1)}%`, right + 5, y + 3.5);
        }
        ctx.setLineDash([]);
      }
    },
    // series lookup is stable enough for paint time; direct access avoids stale closures
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mapDrawingPoint],
  );

  function seriesPriceToY(price: number): number | null {
    const series = mainApi.current?.series;
    if (!series) return null;
    return series.priceToCoordinate(price);
  }

  const paintOverlay = useCallback(() => {
    const canvas = rulerCanvasRef.current;
    const container = mainRef.current;
    if (!canvas || !container) return;
    syncOverlayCanvasSize(canvas, container);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    clearRulerCanvas(canvas);

    // persisted drawings first (bind to symbol + time region)
    for (const drawing of drawingsRef.current) {
      drawPersistedShape(ctx, drawing);
    }

    const step = Math.floor(TIMEFRAME_MS[timeframeRef.current] / 1000);
    const rulerStyle = rulerStyleFromTheme(readChartTheme());

    // 自由时间游标（§2.3）：细竖线 + 底部位置标签，任何缩放平移下常驻可见
    const ct = cursorTimeRef.current;
    if (ct != null && cursorCbRef.current) {
      const chart = mainApi.current?.chart;
      const x = chart?.timeScale().timeToCoordinate(ct as Time);
      if (x != null && Number.isFinite(x)) {
        ctx.strokeStyle = rulerStyle.rulerStroke;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, ctx.canvas.height);
        ctx.stroke();
        ctx.setLineDash([]);
        const label = fmtDateTime(ct * 1000);
        ctx.font = '11px var(--oc-font-mono, monospace)';
        const w = ctx.measureText(label).width + 12;
        const lx = Math.min(Math.max(4, x - w / 2), ctx.canvas.width - w - 4);
        ctx.fillStyle = rulerStyle.rulerLabelBg;
        ctx.fillRect(lx, ctx.canvas.height - 20, w, 16);
        ctx.fillStyle = rulerStyle.rulerLabelText;
        ctx.fillText(label, lx + 6, ctx.canvas.height - 8);
      }
    }

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
    }
  }, [remapRulerCorner, drawPersistedShape]);

  const clearLocalAnnotations = useCallback(() => {
    // in-memory artifacts only; persisted drawings are owned by the caller
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
    rulerCornerRef.current = null;
    rulerPreviewRef.current = null;
    rulerResultRef.current = null;
    setRulerHint('');
    paintOverlay();
  }, [paintOverlay]);

  const handleErase = useCallback(() => {
    clearLocalAnnotations();
    // eraser deletes persisted drawings for this symbol via the caller
    onEraseDrawings?.();
  }, [clearLocalAnnotations, onEraseDrawings]);

  // repaint persisted drawings whenever the list (or theme they're drawn in) changes
  useEffect(() => {
    paintOverlayRef.current = paintOverlay;
    paintOverlay();
  }, [drawings, chartTheme, paintOverlay]);

  useEffect(() => {
    clearLocalAnnotations();
    didInitViewRef.current = false;
    followEndRef.current = true;
    prevKlineLenRef.current = 0;
  }, [symbol, clearLocalAnnotations]);

  // mount main
  useEffect(() => {
    if (!mainRef.current) return;
    const m = mountChart(mainRef.current);
    mainApi.current = { ...m, markerApi: null };
    didInitViewRef.current = false;
    prevKlineLenRef.current = 0;
    setChartEpoch((e) => e + 1);

    const onRangeChange = () => {
      if (playback) {
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
      }
      syncCompareRange(m.chart, compareApi.current?.chart ?? null, syncingRangeRef);
    };
    m.chart.timeScale().subscribeVisibleTimeRangeChange?.(onRangeChange);
    m.chart.timeScale().subscribeVisibleLogicalRangeChange?.(onRangeChange);

    const ro = new ResizeObserver(() => {
      if (!mainRef.current) return;
      if (mainRef.current.clientWidth === 0 || mainRef.current.clientHeight === 0) return;
      m.chart.applyOptions({
        width: mainRef.current.clientWidth,
        height: mainRef.current.clientHeight,
      });
      if (rulerResultRef.current || rulerCornerRef.current || cursorTimeRef.current != null) paintOverlay();
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
    // playback only toggles with the mode; the engine remounts if it ever changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintOverlay]);

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

    const seriesMarkers = markers ?? [];
    if (m.markerApi) {
      m.markerApi.setMarkers(seriesMarkers);
    } else if (candles.length) {
      m.markerApi = createSeriesMarkers(m.series, seriesMarkers);
    }

    if (candles.length) {
      if (!didInitViewRef.current) {
        const target = visibleRange ?? null;
        let applied = false;
        if (target && target.from != null && target.to != null) {
          try {
            m.chart.timeScale().setVisibleRange(target);
            applied = true;
          } catch {
            /* fall through to fitContent */
          }
        }
        if (!applied) {
          try {
            m.chart.timeScale().fitContent();
          } catch {
            /* ignore */
          }
        }
        didInitViewRef.current = true;
        followEndRef.current = true;
      } else if (playback && followEndRef.current && len > prevKlineLenRef.current) {
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
    if (rulerResultRef.current || rulerCornerRef.current) paintOverlay();
  }, [klines, markers, chartTheme, playback, visibleRange, paintOverlay, chartEpoch]);

  // deferred visible range (requested before data arrived)
  useEffect(() => {
    if (!visibleRange) {
      pendingRangeRef.current = null;
      return;
    }
    pendingRangeRef.current = { from: visibleRange.from, to: visibleRange.to };
    if (!didInitViewRef.current) return; // first paint applies it in the data effect
    const m = mainApi.current;
    if (!m) return;
    try {
      m.chart.timeScale().setVisibleRange(visibleRange);
    } catch {
      /* keep pending; next data effect retries */
    }
  }, [visibleRange]);

  // engine-managed price lines (entry/exit/liq/planned)
  useEffect(() => {
    const series = mainApi.current?.series;
    if (!series) return;
    for (const line of managedPriceLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {
        /* series already disposed */
      }
    }
    managedPriceLinesRef.current = [];
    if (!priceLines?.length) return;
    const theme = readChartTheme();
    for (const spec of priceLines) {
      if (spec.price == null || !Number.isFinite(spec.price)) continue;
      try {
        const line = series.createPriceLine({
          price: spec.price,
          color: spec.color || theme.hline,
          lineWidth: spec.dashed ? 1 : 3,
          lineStyle: spec.dashed ? 2 : 0,
          axisLabelVisible: true,
          title: spec.title,
        });
        managedPriceLinesRef.current.push(line);
      } catch {
        /* series already disposed */
      }
    }
  }, [priceLines, chartEpoch, chartTheme]);

  // compare data
  useEffect(() => {
    const c = compareApi.current;
    if (!c || !compare?.klines) return;
    const themeNow = readChartTheme();
    applyCandleChartTheme(c.chart, c.series, themeNow);
    c.series.setData(toCandles(compare.klines));
    c.volume.setData(klinesToVolume(compare.klines, themeNow));
    syncCompareRange(mainApi.current?.chart ?? null, c.chart, syncingRangeRef);
  }, [compare?.klines, chartTheme, showComparePane]);

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
        if (onUserDrawing) {
          // Persisted: binds to symbol only; time_ms records where it was placed.
          onUserDrawing('hline', [{ time_ms: Number(time) * 1000, price }]);
        } else {
          // In-memory fallback (no persistence wired, e.g. training mode)
          const line = series.createPriceLine({
            price,
            color: readChartTheme().hline,
            lineWidth: 3,
            lineStyle: 0,
            axisLabelVisible: true,
            title: price.toFixed(4),
          });
          userPriceLinesRef.current.push(line);
        }
        setDrawMode('none');
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (drawMode === 'ruler' || TWO_POINT_HINTS[drawMode]) {
        const corner: RulerCorner = { time, price, x, y };
        const pending = rulerCornerRef.current;
        if (!pending) {
          rulerCornerRef.current = corner;
          rulerPreviewRef.current = null;
          setRulerHint('移动鼠标预览，再点确定');
        } else if (drawMode === 'ruler') {
          rulerResultRef.current = { a: pending, b: corner };
          rulerCornerRef.current = null;
          rulerPreviewRef.current = null;
          setDrawMode('none');
          setRulerHint('');
          paintOverlay();
        } else {
          // shape tool: complete and persist
          const kind = drawMode as DrawingKind;
          onUserDrawing?.(kind, [
            { time_ms: Number(pending.time) * 1000, price: pending.price },
            { time_ms: Number(corner.time) * 1000, price: corner.price },
          ]);
          rulerCornerRef.current = null;
          rulerPreviewRef.current = null;
          setDrawMode('none');
          setRulerHint('');
          paintOverlay();
        }
        e.preventDefault();
        e.stopPropagation();
      }
    };
    el.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => el.removeEventListener('pointerdown', onPointerDown, { capture: true });
  }, [drawMode, paintOverlay, onUserDrawing]);

  useEffect(() => {
    const el = mainRef.current;
    if (!el || (drawMode !== 'ruler' && !TWO_POINT_HINTS[drawMode])) return;
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
      raf = requestAnimationFrame(() => paintOverlay());
    };
    window.addEventListener('pointermove', onPointerMove);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      cancelAnimationFrame(raf);
    };
  }, [drawMode, paintOverlay]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement === shellRef.current));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // ---- draggable price lines (图上拖线调 止损/止盈) ----
  const dragRef = useRef<{ title: string; price: number } | null>(null);
  const priceLinesRef = useRef<ChartPriceLine[]>([]);
  // ---- 复盘自由时间游标（§2.3）：线常驻，可横向拖动 ----
  const cursorTimeRef = useRef<number | null>(null);
  const cursorDragRef = useRef(false);
  const cursorCbRef = useRef(onCursorDrag);
  const paintOverlayRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    cursorTimeRef.current = cursorTime ?? null;
    cursorCbRef.current = onCursorDrag;
    paintOverlayRef.current?.();
  }, [cursorTime, onCursorDrag]);
  useEffect(() => {
    priceLinesRef.current = priceLines ?? [];
  }, [priceLines]);

  const paintDragPreview = useCallback(() => {
    const canvas = rulerCanvasRef.current;
    const container = mainRef.current;
    const drag = dragRef.current;
    if (!canvas || !container) return;
    syncOverlayCanvasSize(canvas, container);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    clearRulerCanvas(canvas);
    if (!drag) {
      paintOverlay();
      return;
    }
    const style = rulerStyleFromTheme(readChartTheme());
    const y = seriesPriceToY(drag.price);
    if (y == null) return;
    ctx.strokeStyle = style.rulerStroke;
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(ctx.canvas.width, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = style.rulerLabelBg;
    ctx.fillRect(4, y - 9, 76, 18);
    ctx.fillStyle = style.rulerLabelText;
    ctx.font = '11px var(--oc-font-mono, monospace)';
    ctx.fillText(`${drag.title} ${drag.price.toFixed(4)}`, 8, y + 4);
  }, [paintOverlay]);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    // fresh mode → reset any hover cursor state from the previous mode
    el.style.cursor = '';
    const hitTest = (e: PointerEvent): ChartPriceLine | null => {
      if (!onDragPriceLine) return null;
      const series = mainApi.current?.series;
      if (!series) return null;
      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;
      let best: { line: ChartPriceLine; dist: number } | null = null;
      for (const line of priceLinesRef.current) {
        if (!line.draggable || !Number.isFinite(line.price)) continue;
        const ly = series.priceToCoordinate(line.price);
        if (ly == null) continue;
        const dist = Math.abs(ly - y);
        if (dist < 8 && (best == null || dist < best.dist)) best = { line, dist };
      }
      return best?.line ?? null;
    };

    const cursorX = (): number | null => {
      const ct = cursorTimeRef.current;
      const chart = mainApi.current?.chart;
      if (ct == null || !cursorCbRef.current || !chart) return null;
      const x = chart.timeScale().timeToCoordinate(ct as Time);
      return x != null && Number.isFinite(x) ? x : null;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (drawMode !== 'none' || e.button !== 0) return;
      // window 级捕获：浮层面板盖住图表时按下不属于图表（目标不在子树内）
      const t = e.target as Node | null;
      if (!t || !el.contains(t)) return;
      // 时间游标优先：命中 ±6px 竖线即开始拖动（§2.3 自由游标）
      const cx = cursorX();
      if (cx != null && Math.abs(e.clientX - el.getBoundingClientRect().left - cx) < 6) {
        cursorDragRef.current = true;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const line = hitTest(e);
      if (!line) return;
      const series = mainApi.current?.series;
      const price = series?.coordinateToPrice(e.clientY - el.getBoundingClientRect().top);
      if (price == null || !Number.isFinite(price)) return;
      dragRef.current = { title: line.title, price };
      e.preventDefault();
      e.stopPropagation();
    };
    const onPointerMove = (e: PointerEvent) => {
      const series = mainApi.current?.series;
      if (!series) return;
      const chart = mainApi.current?.chart;
      if (cursorDragRef.current) {
        const t = chart?.timeScale().coordinateToTime(e.clientX - el.getBoundingClientRect().left);
        if (t != null && Number.isFinite(Number(t))) cursorCbRef.current?.(Number(t));
        e.preventDefault();
        return;
      }
      if (dragRef.current) {
        const price = series.coordinateToPrice(e.clientY - el.getBoundingClientRect().top);
        if (price != null && Number.isFinite(price)) {
          dragRef.current = { ...dragRef.current, price };
          requestAnimationFrame(() => paintDragPreview());
        }
        e.preventDefault();
        return;
      }
      // hover affordance
      const cx = cursorX();
      const nearCursor = cx != null && Math.abs(e.clientX - el.getBoundingClientRect().left - cx) < 6;
      const near = nearCursor || hitTest(e) != null;
      const want = near ? (nearCursor ? 'ew-resize' : 'ns-resize') : '';
      if (el.style.cursor !== want && drawMode === 'none') el.style.cursor = want;
    };
    const onPointerUp = () => {
      if (cursorDragRef.current) {
        cursorDragRef.current = false;
        return;
      }
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag) {
        paintOverlay();
        if (onDragPriceLine) onDragPriceLine(drag.title, drag.price);
      }
    };
    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true } as EventListenerOptions);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [drawMode, paintDragPreview, paintOverlay, onDragPriceLine]);

  const toggleFullscreen = () => {
    const el = shellRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen();
  };

  const compareStatus = compareEnabled && !showComparePane ? compare?.loading || compare?.error : null;

  return (
    <div ref={shellRef} className="flex min-h-0 flex-1 flex-col bg-[var(--background-base)]">
      <div className="oc-chart-shell flex min-h-0 flex-1 flex-col">
        <div className="oc-chart-toolbar">
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <span className="font-mono">{symbol || '—'}</span>
            {showTimeframeTabs ? (
              <div className="oc-tabs oc-tabs--compact shrink-0">
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    className={`oc-tab${tf === timeframe ? ' oc-tab--active' : ''}`}
                    onClick={() => onTimeframeChange?.(tf)}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            ) : (
              <span className="opacity-60">{timeframe}</span>
            )}
            {loading ? <span className="oc-spinner" /> : null}
            {error && klines.length === 0 ? (
              <span className="max-w-[240px] truncate text-[12px] oc-text-loss" role="alert">
                {error}
              </span>
            ) : null}
            {status}
            {drawMode === 'hline' ? (
              <span className="text-[12px] oc-text-accent">点击主图放置水平线</span>
            ) : null}
            {drawMode === 'ruler' ? (
              <span className="text-[12px] oc-text-accent">{rulerHint || '点击第一点'}</span>
            ) : null}
            {TWO_POINT_HINTS[drawMode] ? (
              <span className="text-[12px] oc-text-accent">
                {rulerCornerRef.current ? rulerHint || '移动鼠标预览，再点确定' : TWO_POINT_HINTS[drawMode]}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className={`oc-icon-btn oc-icon-btn--sm${drawMode === 'ruler' ? ' oc-btn--ghost-selected' : ''}`}
              title="尺子"
              onClick={() => {
                if (drawMode === 'ruler') {
                  clearLocalAnnotations();
                  setDrawMode('none');
                } else {
                  clearLocalAnnotations();
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
              className={`oc-icon-btn oc-icon-btn--sm${drawMode === 'trend' ? ' oc-btn--ghost-selected' : ''}`}
              title="趋势线（持久保存）"
              onClick={() => {
                rulerCornerRef.current = null;
                setDrawMode((mode) => (mode === 'trend' ? 'none' : 'trend'));
              }}
            >
              <TrendingUp className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              className={`oc-icon-btn oc-icon-btn--sm${drawMode === 'region' ? ' oc-btn--ghost-selected' : ''}`}
              title="区域（持久保存）"
              onClick={() => {
                rulerCornerRef.current = null;
                setDrawMode((mode) => (mode === 'region' ? 'none' : 'region'));
              }}
            >
              <Square className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              className={`oc-icon-btn oc-icon-btn--sm${drawMode === 'fib' ? ' oc-btn--ghost-selected' : ''}`}
              title="斐波那契回调（持久保存）"
              onClick={() => {
                rulerCornerRef.current = null;
                setDrawMode((mode) => (mode === 'fib' ? 'none' : 'fib'));
              }}
            >
              <Percent className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              className="oc-icon-btn oc-icon-btn--sm"
              title="清除手动画线（已保存的画线将从数据中删除）"
              onClick={handleErase}
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
                  const fallback = symbol === DEFAULT_COMPARE_SYMBOL ? 'ETH-USDT' : DEFAULT_COMPARE_SYMBOL;
                  onSelectCompare?.(fallback);
                }
              }}
            >
              {compareEnabled ? '隐藏对比' : '多交易对对比'}
            </button>
            {toolbarSlotWidth ? <div className="shrink-0" style={{ width: toolbarSlotWidth }} aria-hidden /> : null}
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
            aria-hidden
          />
        </div>
      </div>

      {!compareEnabled && compareStatus ? (
        <div className="oc-chart-toolbar shrink-0">
          <span className="flex min-w-0 items-center gap-2 text-[12px]">
            {compare?.loading ? <span className="oc-spinner" /> : null}
            <span
              className={compare?.error ? 'truncate oc-text-loss' : 'truncate oc-text-faint'}
              role={compare?.error ? 'alert' : undefined}
            >
              {compare?.error ?? '对比 K 线加载中…'}
            </span>
          </span>
        </div>
      ) : null}

      {compareEnabled ? (
        <div className="oc-chart-shell flex min-h-0 flex-1 flex-col">
          <div className="oc-chart-toolbar">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                className="oc-btn oc-btn--sm oc-btn--ghost"
                onClick={() => compareModalRef.current?.showModal()}
              >
                对比: <span className="font-mono">{compare?.symbol}</span>
                {compare?.loading ? <span className="oc-spinner ml-2 align-middle" /> : null}
                {compare?.error && !showComparePane ? (
                  <span className="ml-2 max-w-[240px] truncate text-[12px] oc-text-loss">
                    {compare.error}
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
              对比图与主图同步时间轴
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
                const isSelected = opt.value === compare?.symbol;
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
