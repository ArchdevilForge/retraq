import type { HistogramData, IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import type { Kline } from '../services/api';

export type ChartTheme = {
  text: string;
  gridLine: string;
  up: string;
  down: string;
  volumeUp: string;
  volumeDown: string;
  hline: string;
  rulerFill: string;
  rulerStroke: string;
  rulerLabelBg: string;
  rulerLabelText: string;
};

export type RulerDrawStyle = Pick<
  ChartTheme,
  'rulerFill' | 'rulerStroke' | 'rulerLabelBg' | 'rulerLabelText'
>;

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function readChartTheme(): ChartTheme {
  return {
    text: cssVar('--oc-chart-text', '#646262'),
    gridLine: cssVar('--oc-chart-grid', 'rgba(15, 0, 0, 0.08)'),
    up: cssVar('--oc-chart-up', '#30d158'),
    down: cssVar('--oc-chart-down', '#ff3b30'),
    volumeUp: cssVar('--oc-chart-volume-up', 'rgba(48, 209, 88, 0.55)'),
    volumeDown: cssVar('--oc-chart-volume-down', 'rgba(255, 59, 48, 0.55)'),
    hline: cssVar('--oc-chart-hline', '#9a9898'),
    rulerFill: cssVar('--oc-chart-ruler-fill', 'rgba(32, 29, 29, 0.1)'),
    rulerStroke: cssVar('--oc-chart-ruler-stroke', 'rgba(32, 29, 29, 0.75)'),
    rulerLabelBg: cssVar('--oc-chart-ruler-label-bg', 'rgba(32, 29, 29, 0.92)'),
    rulerLabelText: cssVar('--oc-chart-ruler-label-text', '#fdfcfc'),
  };
}

export function klinesToVolume(klines: Kline[], theme: ChartTheme): HistogramData<Time>[] {
  return klines.map((k) => ({
    time: k.time as Time,
    value: k.volume,
    color: k.close >= k.open ? theme.volumeUp : theme.volumeDown,
  }));
}

export function applyCandleChartTheme(
  chart: IChartApi,
  series: ISeriesApi<'Candlestick'>,
  theme: ChartTheme,
) {
  chart.applyOptions({
    layout: { background: { color: 'transparent' }, textColor: theme.text },
    grid: {
      vertLines: { color: theme.gridLine },
      horzLines: { color: theme.gridLine },
    },
  });
  series.applyOptions({
    upColor: theme.up,
    downColor: theme.down,
    wickUpColor: theme.up,
    wickDownColor: theme.down,
  });
}

export function rulerStyleFromTheme(theme: ChartTheme): RulerDrawStyle {
  return {
    rulerFill: theme.rulerFill,
    rulerStroke: theme.rulerStroke,
    rulerLabelBg: theme.rulerLabelBg,
    rulerLabelText: theme.rulerLabelText,
  };
}
