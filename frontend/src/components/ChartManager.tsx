import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
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
import { TIMEFRAME_MS } from '../services/api';
import { fmtPrice, isSyntheticFills } from '../utils/fills';
import { readChartTheme } from '../utils/chartTheme';
import { useToast } from './ToastHost';

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

/** 同期「我的」持仓 → 圆点标注（与高手箭头区分），时间升序合并（P§五.2）。 */
function buildSelfCompareMarkers(trades: Trade[], timeframe: Timeframe): SeriesMarker<Time>[] {
  const theme = readChartTheme();
  const stepSec = Math.floor(TIMEFRAME_MS[timeframe] / 1000);
  const align = (ms: number) =>
    stepSec > 0 ? ((Math.floor(ms / 1000 / stepSec) * stepSec) as Time) : (Math.floor(ms / 1000) as Time);
  const out: SeriesMarker<Time>[] = [];
  for (const t of trades) {
    const long = t.direction === 'long';
    out.push({
      time: align(t.entry_time),
      position: long ? 'belowBar' : 'aboveBar',
      shape: 'circle',
      color: long ? theme.up : theme.down,
      text: '我开',
    });
    if (t.exit_time != null) {
      out.push({
        time: align(t.exit_time),
        position: long ? 'aboveBar' : 'belowBar',
        shape: 'circle',
        color: (t.profit ?? 0) >= 0 ? theme.up : theme.down,
        text: '我平',
      });
    }
  }
  return out.sort((a, b) => Number(a.time) - Number(b.time));
}

interface Props {
  symbol: string;
  selectedTrade: Trade | null;
  /** master 交割单等无 fill 数据的持仓，跳过成交明细请求。 */
  noFills?: boolean;
  /** 同段行情「他 vs 我」：叠加到同一张图上的我的同期持仓（P§五.2）。 */
  selfCompareTrades?: Trade[] | null;
  /** 工具栏最右预留槽宽度（透传 ChartCanvas）。 */
  toolbarSlotWidth?: number;
  /** 详情卡「前往开仓时间」需把游标拉回开仓 bar：游标状态留在 ChartManager 内，
      用 imperative handle 暴露单一定位动作，避免把 cursorSec 提升到页面级。 */
  jumpRef?: MutableRefObject<(() => void) | null>;
}

/** 不请求尚未收盘的 K 线，否则缓存永远算不上覆盖，每次都回源交易所。仅可在 effect 内调用。 */
function clampRangeToClosed(range: { start: number; end: number } | null, tfMs: number) {
  if (!range) return undefined;
  const lastClosedEnd = Math.floor(Date.now() / tfMs) * tfMs - tfMs;
  return { start: range.start, end: Math.max(range.start, Math.min(range.end, lastClosedEnd)) };
}

function ChartManager({
  symbol,
  selectedTrade,
  noFills = false,
  selfCompareTrades,
  toolbarSlotWidth,
  jumpRef,
}: Props) {
  const { activeDatasetId } = useDataset();
  const { toast } = useToast();
  const [activeTimeframe, setActiveTimeframe] = useState<Timeframe>('15m');
  const [tradeFills, setTradeFills] = useState<TradeFill[]>([]);
  const [tradeFillsError, setTradeFillsError] = useState(false);
  const [mainKlines, setMainKlines] = useState<Kline[]>([]);
  // §2.3 藏未来（原训练模式的核心价值）：开启后只保留游标之前的 bar，
  // 逐 bar 推进即“回放练习”。下单模拟已移除（0 产出的 4k 行引擎）。
  const [hideFuture, setHideFuture] = useState(false);
  const [mainKlineLoading, setMainKlineLoading] = useState(false);
  const [mainKlineError, setMainKlineError] = useState<string | null>(null);
  const [compareKlines, setCompareKlines] = useState<Kline[] | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareSymbol, setCompareSymbol] = useState<string | null>(null);
  const [symbolOptions, setSymbolOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  // 复盘自由时间游标（§2.3）：持续可见。默认停在可见范围末根 bar；换标的/选持仓/
  // 换周期后若游标落在新窗口之外（屏外 = 隐形），拉回新窗口末根 bar。
  const [cursorSec, setCursorSec] = useState<number | null>(null);
  // §2.3 回放传输：自动播放 + 倍速（根/秒） + 单步步进（bar 数）
  const [playing, setPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(8);
  const [stepBars, setStepBars] = useState(1);

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

  // 复盘自由时间游标（§2.3）：持续可见。默认位置——
  //   选中持仓时 = 该笔开仓 bar（复盘的决策时刻，也是对标工具的「前往开仓时间」默认行为）；
  //   未选中时   = 可见范围末根 bar。
  // 游标一旦被用户挪出（单步/拖动），本 effect 不再拉回，除非换了标的/持仓/周期。
  // 已为哪笔持仓落过「开仓位」；只在**真的找到开仓 bar** 时置位，否则新数据到达后
  // （选中瞬间图里还是上一笔/上一个标的的 K 线）会被误判为已落位而永不跳转。
  const entryAnchoredForRef = useRef<string | null>(null);
  useEffect(() => {
    if (mainKlines.length === 0) return;
    const vr = visibleRange;
    const inView = vr
      ? mainKlines.filter((k) => k.time >= Number(vr.from) && k.time <= Number(vr.to))
      : mainKlines;
    // 游标已在可见窗内 → 用户在看它，不打扰（这是「用户挪开后不被拉回」的实现）
    if (cursorSec != null && inView.some((k) => k.time === cursorSec)) return;

    if (selectedTrade) {
      const tradeKey = `t${selectedTrade.id}:${activeTimeframe}`;
      if (entryAnchoredForRef.current === tradeKey) return; // 已跳过一次，尊重用户后续挪动
      const entrySec = Math.floor(selectedTrade.entry_time / 1000);
      const stepSec = Math.floor(TIMEFRAME_MS[activeTimeframe] / 1000);
      const entryBar = mainKlines.find((k) => k.time >= entrySec - stepSec && k.time <= entrySec + stepSec);
      if (entryBar) {
        entryAnchoredForRef.current = tradeKey; // 只在成功落位后置位
        setCursorSec(entryBar.time);
        return;
      }
      // 数据还没切到这笔持仓的窗口 → 什么都不做，等新 klines 到达再试
      return;
    }
    const last = inView[inView.length - 1] ?? mainKlines[mainKlines.length - 1];
    setCursorSec(last.time);
  }, [mainKlines, cursorSec, visibleRange, selectedTrade, symbol, activeTimeframe]);

  /** 详情卡「前往开仓时间」：把游标拉回该笔的开仓 bar。 */
  const jumpToTradeEntry = useCallback(() => {
    if (!selectedTrade || mainKlines.length === 0) return;
    const entrySec = Math.floor(selectedTrade.entry_time / 1000);
    const stepSec = Math.floor(TIMEFRAME_MS[activeTimeframe] / 1000);
    const bar = mainKlines.find((k) => k.time >= entrySec - stepSec && k.time <= entrySec + stepSec);
    if (bar) {
      entryAnchoredForRef.current = `t${selectedTrade.id}:${activeTimeframe}`;
      setPlaying(false);
      setCursorSec(bar.time);
    }
  }, [selectedTrade, mainKlines, activeTimeframe]);

  // 暴露给详情卡（RefObject 单槽，无订阅成本）
  useEffect(() => {
    if (!jumpRef) return;
    jumpRef.current = selectedTrade ? jumpToTradeEntry : null;
    return () => {
      jumpRef.current = null;
    };
  }, [jumpRef, selectedTrade, jumpToTradeEntry]);

  /** 游标索引（不在数据里时落在末根）。 */
  const cursorIndex = useMemo(() => {
    if (cursorSec == null || mainKlines.length === 0) return -1;
    const i = mainKlines.findIndex((k) => k.time === cursorSec);
    return i === -1 ? mainKlines.length - 1 : i;
  }, [cursorSec, mainKlines]);

  /** 单步 ±N 根（transport 按钮、键盘、自动播放共用此唯一入口，避免边界分叉）。 */
  const stepCursor = useCallback(
    (dir: 1 | -1, bars = stepBars) => {
      if (cursorIndex < 0) return false;
      const next = cursorIndex + dir * bars;
      const clamped = Math.min(mainKlines.length - 1, Math.max(0, next));
      setCursorSec(mainKlines[clamped].time);
      return clamped !== cursorIndex; // false = 已到边界，自动播放据此停止
    },
    [cursorIndex, mainKlines, stepBars],
  );

  // 复盘快捷键（§2.3）：←/→ 单步；Shift+↓ 播放/暂停；输入聚焦时不劫持
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      if (e.key === 'ArrowDown' && e.shiftKey) {
        e.preventDefault();
        setPlaying((v) => !v);
        return;
      }
      if (e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (cursorIndex < 0) return;
      e.preventDefault();
      stepCursor(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cursorIndex, stepCursor]);

  // §2.3 自动播放：按 playSpeed（根/秒）推进；到达末根自动停止。
  useEffect(() => {
    if (!playing) return;
    if (cursorIndex < 0) return;
    if (cursorIndex >= mainKlines.length - 1) {
      setPlaying(false);
      return;
    }
    const id = window.setInterval(() => {
      if (!stepCursor(1)) setPlaying(false);
    }, Math.max(50, 1000 / playSpeed));
    return () => window.clearInterval(id);
  }, [playing, playSpeed, stepCursor, cursorIndex, mainKlines.length]);

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

  useEffect(() => {
    setCursorSec((cur) => {
      if (cur != null || mainKlines.length === 0) return cur;
      return mainKlines[mainKlines.length - 1].time;
    });
  }, [mainKlines]);

  const overlay = useMemo(
    () => (selectedTrade ? buildTradeOverlay(selectedTrade, tradeFills, activeTimeframe) : { markers: [], priceLines: [] }),
    [selectedTrade, tradeFills, activeTimeframe],
  );

  // 藏未来：游标之后的 K 线不入图（游标后的标记/画线自然不可见）
  const displayKlines = useMemo(() => {
    if (!hideFuture || cursorSec == null) return mainKlines;
    const upTo = mainKlines.filter((k) => k.time <= cursorSec);
    return upTo.length > 0 ? upTo : mainKlines;
  }, [hideFuture, cursorSec, mainKlines]);

  // 他我对照：self 圆点与高手箭头按时间归并（P§五.2）
  const mergedMarkers = useMemo(() => {
    const mine = selfCompareTrades?.length ? buildSelfCompareMarkers(selfCompareTrades, activeTimeframe) : [];
    const all = mine.length === 0
      ? overlay.markers
      : [...overlay.markers, ...mine].sort((a, b) => Number(a.time) - Number(b.time));
    // 藏未来时标记一并截断（否则未来成交价会泄露）
    if (hideFuture && cursorSec != null) return all.filter((m) => Number(m.time) <= cursorSec);
    return all;
  }, [overlay, selfCompareTrades, activeTimeframe, hideFuture, cursorSec]);

  // §2.3 藏未来时的位置指示（原训练模式的 50/672 计数）：可断言、可感知进度
  const futureCount = useMemo(() => {
    if (!hideFuture || cursorSec == null || mainKlines.length === 0) return null;
    const shown = mainKlines.filter((k) => k.time <= cursorSec).length;
    return { shown, total: mainKlines.length };
  }, [hideFuture, cursorSec, mainKlines]);

/** 开启藏未来时游标至少回退这么多根，保证有未来可逐根揭示。 */
const HIDE_FUTURE_LOOKBACK_BARS = 60;

  const status = selectedTrade ? (
    <>
      {tradeFillsError && (
        <span className="ml-2 text-oc-12 oc-text-loss" role="alert">
          成交明细加载失败，K 线标注不完整
        </span>
      )}
      {mainKlines.length > 0 && tradeFills.length > 0 && (
        <span className="ml-2 text-oc-12 oc-text-faint">成交 {tradeFills.length} 笔 → K 线标注</span>
      )}
      {mainKlines.length > 0 && !tradeFillsError && tradeFills.length === 0 && !noFills && (
        <span className="ml-2 text-oc-12 oc-text-brand">无成交明细，仅均价线；请用交易历史模板重新导入</span>
      )}
    </>
  ) : null;

  return (
    <ChartCanvas
      symbol={selectedTrade?.symbol || symbol}
      timeframe={activeTimeframe}
      klines={displayKlines}
      loading={mainKlineLoading}
      error={mainKlineError}
      status={status}
      markers={mergedMarkers}
      priceLines={hideFuture ? [] : overlay.priceLines}
      hideFuture={hideFuture}
      onToggleHideFuture={() => {
        setHideFuture((v) => {
          const next = !v;
          // 开启时若游标已在末端（默认位置），回退若干根，否则无未来可揭示
          if (next && mainKlines.length > 0 && cursorSec != null) {
            const i = mainKlines.findIndex((k) => k.time === cursorSec);
            const cur = i === -1 ? mainKlines.length - 1 : i;
            const target = Math.max(0, cur - HIDE_FUTURE_LOOKBACK_BARS);
            if (target < cur) setCursorSec(mainKlines[target].time);
          }
          return next;
        });
      }}
      futureCount={futureCount}
      visibleRange={visibleRange}
      drawings={drawings}
      onUserDrawing={handleUserDrawing}
      onEraseDrawings={handleEraseDrawings}
      compare={compareSymbol ? { symbol: compareSymbol, klines: compareKlines, loading: compareLoading, error: compareError } : null}
      compareOptions={symbolOptions}
      onSelectCompare={setCompareSymbol}
      onClearCompare={() => setCompareSymbol(null)}
      onTimeframeChange={setActiveTimeframe}
      cursorTime={cursorSec}
      onCursorDrag={setCursorSec}
      onStepCursor={stepCursor}
      playing={playing}
      onTogglePlay={() => setPlaying((v) => !v)}
      playSpeed={playSpeed}
      onPlaySpeedChange={setPlaySpeed}
      stepBars={stepBars}
      onStepBarsChange={setStepBars}
      toolbarSlotWidth={toolbarSlotWidth}
    />
  );
}

export default ChartManager;
