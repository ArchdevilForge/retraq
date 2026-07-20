import {
  CandlestickSeries,
  createChart,
  HistogramSeries,
  type DeepPartial,
  type IChartApi,
  type ISeriesApi,
  type ChartOptions,
} from 'lightweight-charts';
import type { ChartTheme } from './chartTheme';

export type CandleVolumeChart = {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
};

export type MountCandleOpts = {
  /** Merged into createChart options (overrides base layout/grid/timeScale keys if provided). */
  chartOptions?: DeepPartial<ChartOptions>;
  volumeScaleMargins?: { top: number; bottom: number };
  volumeScaleExtra?: {
    borderVisible?: boolean;
    ticksVisible?: boolean;
  };
};

/** Shared candle + volume histogram mount for replay/training charts. */
export function mountCandleVolumeChart(
  el: HTMLElement,
  theme: ChartTheme,
  opts: MountCandleOpts = {},
): CandleVolumeChart {
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
    ...opts.chartOptions,
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
    scaleMargins: opts.volumeScaleMargins ?? { top: 0.8, bottom: 0 },
    visible: false,
    ...opts.volumeScaleExtra,
  });

  return { chart, series, volume };
}
