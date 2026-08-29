import { useEffect, useRef, useState, useCallback } from 'react';
import {
  type IPriceLine,
  type SeriesMarker,
  type Time,
  createSeriesMarkers,
} from 'lightweight-charts';
import { mountCandleVolumeChart } from '../../utils/candleChart';
import {
  applyCandleChartTheme,
  klinesToVolume,
  readChartTheme,
  type ChartTheme,
} from '../../utils/chartTheme';
import {
  fetchKlines,
  fetchMasterOverlay,
  type MasterPosition,
  type MasterTrader,
  type MasterOverlayAction,
  type Timeframe,
  TIMEFRAMES,
} from '../../services/api';
import { fmtMoney } from '../../utils/format';
import { Layers, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';

interface Props {
  symbol: string;
  selectedPosition: MasterPosition | null;
  selectedTrader: MasterTrader | null;
}

const TIMEFRAME_MS: Record<Timeframe, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

export default function MasterChart({ symbol, selectedPosition, selectedTrader }: Props) {
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');
  const [chartTheme, setChartTheme] = useState<ChartTheme>(() => readChartTheme());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlayActive, setOverlayActive] = useState(false);
  const [overlayActions, setOverlayActions] = useState<MasterOverlayAction[]>([]);
  const [overlayLoading, setOverlayLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any | null>(null);
  const candleSeriesRef = useRef<any | null>(null);
  const volumeSeriesRef = useRef<any | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);

  // Sync theme changes
  useEffect(() => {
    const handleThemeChange = () => {
      const nextTheme = readChartTheme();
      setChartTheme(nextTheme);
      if (chartRef.current && candleSeriesRef.current) {
        applyCandleChartTheme(chartRef.current, candleSeriesRef.current, nextTheme);
      }
    };
    window.addEventListener('oc-theme-change', handleThemeChange);
    return () => window.removeEventListener('oc-theme-change', handleThemeChange);
  }, []);

  // Initialize Chart on Mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { chart, series, volume } = mountCandleVolumeChart(container, chartTheme, {
      chartOptions: {
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
        },
      },
    });

    chartRef.current = chart;
    candleSeriesRef.current = series;
    volumeSeriesRef.current = volume;

    const ro = new ResizeObserver(() => {
      if (chartRef.current && container) {
        chartRef.current.applyOptions({
          width: container.clientWidth,
          height: container.clientHeight,
        });
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      priceLineRef.current = null;
    };
  }, []);

  // Load K-lines & Plot Position
  const loadKlines = useCallback(async () => {
    if (!symbol || !candleSeriesRef.current || !volumeSeriesRef.current || !chartRef.current) return;

    setLoading(true);
    setError(null);

    try {
      const tfMs = TIMEFRAME_MS[timeframe];
      let startTs: number | undefined;
      let endTs: number | undefined;

      if (selectedPosition) {
        const openTime = selectedPosition.opened_at;
        const closeTime = selectedPosition.closed_at || (openTime + tfMs * 20);
        // Show 60 bars before entry, 60 bars after exit
        startTs = Math.max(0, openTime - tfMs * 60);
        endTs = closeTime + tfMs * 60;
      }

      const klines = await fetchKlines(symbol, timeframe, {
        limit: 500,
        start: startTs,
        end: endTs,
      });

      if (!klines || klines.length === 0) {
        setError(`暂无 ${symbol} 在此时段的 K 线数据`);
        setLoading(false);
        return;
      }

      const candleData = klines.map((k) => ({
        time: (k.time / 1000) as Time,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
      }));

      candleSeriesRef.current.setData(candleData);
      volumeSeriesRef.current.setData(klinesToVolume(klines, chartTheme));

      // Remove existing price line
      if (priceLineRef.current && candleSeriesRef.current) {
        candleSeriesRef.current.removePriceLine(priceLineRef.current);
        priceLineRef.current = null;
      }

      // Build Markers
      const markers: SeriesMarker<Time>[] = [];

      // 1. Current Selected Position Markers
      if (selectedPosition) {
        const isLong = selectedPosition.side === 'LONG';
        const entrySec = Math.floor(selectedPosition.opened_at / 1000) as Time;
        const pnlText = selectedPosition.pnl != null
          ? `${selectedPosition.pnl >= 0 ? '+' : ''}${fmtMoney(selectedPosition.pnl)}`
          : '';

        // Entry Marker
        markers.push({
          time: entrySec,
          position: isLong ? 'belowBar' : 'aboveBar',
          color: isLong ? 'var(--oc-pnl-up, #30D158)' : 'var(--oc-pnl-down, #FF3B30)',
          shape: isLong ? 'arrowUp' : 'arrowDown',
          text: `${selectedTrader?.nickname || '高手'} 开${isLong ? '多' : '空'} ${selectedPosition.leverage}x @ ${fmtMoney(selectedPosition.entry_price)}`,
        });

        // Exit Marker
        if (selectedPosition.closed_at) {
          const exitSec = Math.floor(selectedPosition.closed_at / 1000) as Time;
          const isProfitable = (selectedPosition.pnl ?? 0) >= 0;
          markers.push({
            time: exitSec,
            position: isLong ? 'aboveBar' : 'belowBar',
            color: isProfitable ? 'var(--oc-pnl-up, #30D158)' : 'var(--oc-pnl-down, #FF3B30)',
            shape: 'circle',
            text: `平仓 ${pnlText} (${(selectedPosition.roi ?? 0) >= 0 ? '+' : ''}${selectedPosition.roi?.toFixed(1)}%)`,
          });
        }

        // Draw Entry Price Line
        priceLineRef.current = candleSeriesRef.current.createPriceLine({
          price: selectedPosition.entry_price,
          color: isLong ? 'var(--oc-pnl-up, #30D158)' : 'var(--oc-pnl-down, #FF3B30)',
          lineWidth: 1,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: `开仓价 ${selectedPosition.side}`,
        });
      }

      // 2. Overlay Markers for other contract masters
      if (overlayActive && overlayActions.length > 0) {
        for (const act of overlayActions) {
          if (selectedPosition && act.id === selectedPosition.id) continue;
          const isLong = act.side === 'LONG';
          const actSec = Math.floor(act.opened_at / 1000) as Time;
          markers.push({
            time: actSec,
            position: isLong ? 'belowBar' : 'aboveBar',
            color: isLong ? '#22c55e' : '#ef4444',
            shape: isLong ? 'arrowUp' : 'arrowDown',
            text: `[${act.trader_nickname}] 开${isLong ? '多' : '空'} ${act.leverage}x`,
          });
        }
      }

      // Sort markers by time (required by lightweight-charts)
      markers.sort((a, b) => Number(a.time) - Number(b.time));
      createSeriesMarkers(candleSeriesRef.current, markers);

      // Fit or Focus View
      if (selectedPosition) {
        const fromSec = Math.floor((selectedPosition.opened_at - tfMs * 25) / 1000);
        const toSec = Math.floor(((selectedPosition.closed_at || selectedPosition.opened_at) + tfMs * 25) / 1000);
        chartRef.current.timeScale().setVisibleRange({
          from: fromSec as Time,
          to: toSec as Time,
        });
      } else {
        chartRef.current.timeScale().fitContent();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '获取 K 线失败');
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe, selectedPosition, selectedTrader, chartTheme, overlayActive, overlayActions]);

  useEffect(() => {
    loadKlines();
  }, [loadKlines]);

  // Load Overlay Actions if toggled
  useEffect(() => {
    if (!overlayActive || !symbol) {
      setOverlayActions([]);
      return;
    }
    const fetchOverlay = async () => {
      setOverlayLoading(true);
      try {
        const tfMs = TIMEFRAME_MS[timeframe];
        const now = Date.now();
        const startTs = selectedPosition ? selectedPosition.opened_at - tfMs * 100 : now - 30 * 86400 * 1000;
        const endTs = selectedPosition ? (selectedPosition.closed_at || selectedPosition.opened_at) + tfMs * 100 : now;

        const res = await fetchMasterOverlay(symbol, startTs, endTs, 100);
        setOverlayActions(res.data);
      } catch {
        setOverlayActions([]);
      } finally {
        setOverlayLoading(false);
      }
    };
    fetchOverlay();
  }, [overlayActive, symbol, selectedPosition, timeframe]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[var(--oc-surface-0)]">
      {/* Top Bar / Controls */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--oc-border)] px-4 py-2 bg-[var(--oc-surface-1)]">
        {/* Symbol & Active Position Brief */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[14px] font-bold text-[var(--oc-text-base)]">
              {symbol || '未选择标的'}
            </span>
            <span className="rounded bg-[var(--oc-surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--oc-text-muted)]">
              USDT 永续合约
            </span>
          </div>

          {selectedPosition && (
            <div className="hidden items-center gap-2 text-[12px] sm:flex">
              <span
                className={`flex items-center gap-0.5 font-semibold ${
                  selectedPosition.side === 'LONG' ? 'oc-text-profit' : 'oc-text-loss'
                }`}
              >
                {selectedPosition.side === 'LONG' ? (
                  <TrendingUp className="h-3.5 w-3.5" />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5" />
                )}
                {selectedPosition.side === 'LONG' ? '做多' : '做空'} {selectedPosition.leverage}x
              </span>
              <span className="font-mono text-[var(--oc-text-muted)]">
                开仓: {fmtMoney(selectedPosition.entry_price)}
              </span>
              {selectedPosition.close_price && (
                <span className="font-mono text-[var(--oc-text-muted)]">
                  平仓: {fmtMoney(selectedPosition.close_price)}
                </span>
              )}
              {selectedPosition.pnl != null && (
                <span
                  className={`font-mono font-medium ${
                    selectedPosition.pnl >= 0 ? 'oc-text-profit' : 'oc-text-loss'
                  }`}
                >
                  盈亏: {selectedPosition.pnl >= 0 ? '+' : ''}
                  {fmtMoney(selectedPosition.pnl)}U
                </span>
              )}
            </div>
          )}
        </div>

        {/* Timeframe & Overlay Controls */}
        <div className="flex items-center gap-2">
          {/* Timeframe Buttons */}
          <div className="flex items-center rounded-md border border-[var(--oc-border)] bg-[var(--oc-surface-2)] p-0.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                className={`px-2 py-0.5 font-mono text-[11px] font-medium rounded transition-colors ${
                  timeframe === tf
                    ? 'bg-[var(--oc-surface-0)] text-[var(--oc-accent)] shadow-sm'
                    : 'text-[var(--oc-text-muted)] hover:text-[var(--oc-text-base)]'
                }`}
                onClick={() => setTimeframe(tf)}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Master Overlay Toggle */}
          <button
            type="button"
            className={`oc-btn oc-btn--sm flex items-center gap-1.5 text-[11px] ${
              overlayActive ? 'oc-btn--primary' : 'oc-btn--secondary'
            }`}
            onClick={() => setOverlayActive((v) => !v)}
            title="在 K 线上聚合展示所有合约高手在该时间段的开平仓操作"
          >
            <Layers className="h-3.5 w-3.5" />
            <span>高手操作流</span>
            {overlayLoading && <span className="oc-spinner oc-spinner--xs ml-1" />}
            {overlayActive && overlayActions.length > 0 && (
              <span className="ml-0.5 rounded-full bg-white/20 px-1 font-mono text-[10px]">
                {overlayActions.length}
              </span>
            )}
          </button>

          {/* Reset Fit */}
          <button
            type="button"
            className="oc-btn oc-btn--sm oc-btn--secondary p-1.5"
            onClick={() => chartRef.current?.timeScale().fitContent()}
            title="适应全部图表"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Chart Canvas Area */}
      <div className="relative flex-1 min-h-0 w-full">
        <div ref={containerRef} className="h-full w-full" />

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--oc-bg)]/50 backdrop-blur-xs">
            <span className="oc-spinner oc-spinner--md" aria-label="加载图表数据…" />
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="rounded-lg border border-[var(--oc-border)] bg-[var(--oc-surface-1)] p-4 text-center max-w-sm">
              <p className="text-xs text-[var(--oc-text-loss)] mb-2">{error}</p>
              <button
                type="button"
                className="oc-btn oc-btn--sm oc-btn--secondary"
                onClick={loadKlines}
              >
                重试加载
              </button>
            </div>
          </div>
        )}

        {!selectedPosition && !loading && (
          <div className="pointer-events-none absolute bottom-4 left-4 rounded bg-[var(--oc-surface-1)]/80 px-2.5 py-1 text-xs text-[var(--oc-text-muted)] backdrop-blur-xs">
            💡 从右侧「合约交割单」选择任意一笔持仓，即可在图表上复盘该笔交易
          </div>
        )}
      </div>
    </div>
  );
}
