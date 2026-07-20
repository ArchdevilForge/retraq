import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import type { Kline } from '../services/api';
import { applyCandleChartTheme, klinesToVolume, readChartTheme } from '../utils/chartTheme';
import type { SimMarker } from '../utils/training';
import { useTheme } from '../context/ThemeContext';

type Props = {
  symbol: string;
  klines: Kline[];
  compareSymbol?: string | null;
  compareKlines?: Kline[] | null;
  markers?: SimMarker[];
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

function mountChart(el: HTMLElement) {
  const theme = readChartTheme();
  const chart = createChart(el, {
    width: el.clientWidth,
    height: el.clientHeight,
    layout: { background: { color: 'transparent' }, textColor: theme.text },
    grid: {
      vertLines: { color: theme.gridLine },
      horzLines: { color: theme.gridLine },
    },
    crosshair: { mode: 0 },
    timeScale: { timeVisible: true, secondsVisible: false },
    rightPriceScale: { scaleMargins: { top: 0.12, bottom: 0.22 } },
  });
  const series = chart.addSeries(CandlestickSeries, {
    upColor: theme.up,
    downColor: theme.down,
    borderVisible: false,
    wickUpColor: theme.up,
    wickDownColor: theme.down,
    lastValueVisible: false,
    priceLineVisible: false,
  });
  const volume = chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
  });
  chart.priceScale('volume').applyOptions({
    scaleMargins: { top: 0.8, bottom: 0 },
    visible: false,
  });
  return { chart, series, volume, theme };
}

export default function TrainingChart({
  symbol,
  klines,
  compareSymbol,
  compareKlines,
  markers,
}: Props) {
  const mainRef = useRef<HTMLDivElement>(null);
  const compareRef = useRef<HTMLDivElement>(null);
  const mainApi = useRef<{
    chart: IChartApi;
    series: ISeriesApi<'Candlestick'>;
    volume: ISeriesApi<'Histogram'>;
    markerApi: { setMarkers: (m: SeriesMarker<Time>[]) => void } | null;
  } | null>(null);
  const compareApi = useRef<{
    chart: IChartApi;
    series: ISeriesApi<'Candlestick'>;
    volume: ISeriesApi<'Histogram'>;
  } | null>(null);
  const { theme } = useTheme();
  const showCompare = Boolean(compareSymbol && compareKlines && compareKlines.length > 0);

  useEffect(() => {
    if (!mainRef.current) return;
    const m = mountChart(mainRef.current);
    mainApi.current = { ...m, markerApi: null };
    const ro = new ResizeObserver(() => {
      if (!mainRef.current) return;
      m.chart.applyOptions({
        width: mainRef.current.clientWidth,
        height: mainRef.current.clientHeight,
      });
    });
    ro.observe(mainRef.current);
    return () => {
      ro.disconnect();
      m.chart.remove();
      mainApi.current = null;
    };
  }, []);

  useEffect(() => {
    if (!showCompare || !compareRef.current) {
      if (compareApi.current) {
        compareApi.current.chart.remove();
        compareApi.current = null;
      }
      return;
    }
    const c = mountChart(compareRef.current);
    compareApi.current = c;
    const ro = new ResizeObserver(() => {
      if (!compareRef.current) return;
      c.chart.applyOptions({
        width: compareRef.current.clientWidth,
        height: compareRef.current.clientHeight,
      });
    });
    ro.observe(compareRef.current);
    return () => {
      ro.disconnect();
      c.chart.remove();
      compareApi.current = null;
    };
  }, [showCompare]);

  useEffect(() => {
    const m = mainApi.current;
    if (!m) return;
    const themeNow = readChartTheme();
    applyCandleChartTheme(m.chart, m.series, themeNow);
    m.series.setData(toCandles(klines));
    m.volume.setData(klinesToVolume(klines, themeNow));
    const seriesMarkers = buildMarkers(markers);
    if (m.markerApi) {
      m.markerApi.setMarkers(seriesMarkers);
    } else {
      m.markerApi = createSeriesMarkers(m.series, seriesMarkers);
    }
    m.chart.timeScale().scrollToRealTime();
  }, [klines, markers, theme]);

  useEffect(() => {
    const c = compareApi.current;
    if (!c || !compareKlines) return;
    const themeNow = readChartTheme();
    applyCandleChartTheme(c.chart, c.series, themeNow);
    c.series.setData(toCandles(compareKlines));
    c.volume.setData(klinesToVolume(compareKlines, themeNow));
    c.chart.timeScale().scrollToRealTime();
  }, [compareKlines, theme]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="oc-chart-shell relative min-h-0 flex-1">
        <div className="pointer-events-none absolute left-2 top-2 z-10 text-xs opacity-70">
          {symbol}
        </div>
        <div ref={mainRef} className="h-full w-full" />
      </div>
      {showCompare ? (
        <div className="oc-chart-shell relative min-h-0 flex-1">
          <div className="pointer-events-none absolute left-2 top-2 z-10 text-xs opacity-70">
            对比 {compareSymbol}
          </div>
          <div ref={compareRef} className="h-full w-full" />
        </div>
      ) : null}
    </div>
  );
}
