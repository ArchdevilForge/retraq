import { useMemo } from 'react';
import type { SeriesMarker, Time } from 'lightweight-charts';
import type { Kline, Timeframe } from '../services/api';
import ChartCanvas, { type ChartPriceLine } from './chart/ChartCanvas';
import { readChartTheme } from '../utils/chartTheme';
import type { SimMarker } from '../utils/training';

type Props = {
  symbol: string;
  timeframe: Timeframe;
  klines: Kline[];
  scenarioFromSec?: number;
  scenarioToSec?: number;
  compareSymbol?: string | null;
  compareKlines?: Kline[] | null;
  compareLoading?: boolean;
  compareError?: string | null;
  symbolOptions?: string[];
  markers?: SimMarker[];
  liqPrice?: number | null;
  slPrice?: number | null;
  tpPrice?: number | null;
  /** 图上拖线调整 止损/止盈（docs/PRODUCT.md §六）。 */
  onDragPriceLine?: (title: string, price: number) => void;
  onSelectCompare?: (symbol: string) => void;
  onClearCompare?: () => void;
};

function simToSeriesMarkers(markers: SimMarker[] | undefined): SeriesMarker<Time>[] {
  if (!markers?.length) return [];
  return markers.map((m) => ({
    time: m.time as Time,
    position: m.side === 'entry' ? 'belowBar' : 'aboveBar',
    color: m.direction === 'long' ? '#30D158' : '#FF3B30',
    shape: m.side === 'entry' ? (m.direction === 'long' ? 'arrowUp' : 'arrowDown') : 'circle',
    text: m.label,
  }));
}

/** 训练模式 = 同一引擎 + 受控 K 线回放（docs/PRODUCT.md §六）。 */
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
  liqPrice = null,
  slPrice = null,
  tpPrice = null,
  onDragPriceLine,
  onSelectCompare,
  onClearCompare,
}: Props) {
  void _scenarioFromSec;
  void _scenarioToSec;

  const seriesMarkers = useMemo(() => simToSeriesMarkers(markers), [markers]);

  const priceLines = useMemo<ChartPriceLine[]>(() => {
    const theme = readChartTheme();
    const lines: ChartPriceLine[] = [];
    if (slPrice != null && Number.isFinite(slPrice)) {
      lines.push({ price: slPrice, color: theme.down, title: '止损', dashed: true, draggable: true });
    }
    if (tpPrice != null && Number.isFinite(tpPrice)) {
      lines.push({ price: tpPrice, color: theme.up, title: '止盈', dashed: true, draggable: true });
    }
    if (liqPrice != null && Number.isFinite(liqPrice)) {
      lines.push({ price: liqPrice, color: theme.down, title: '强平', dashed: true });
    }
    return lines;
  }, [liqPrice, slPrice, tpPrice]);

  return (
    <ChartCanvas
      symbol={symbol}
      timeframe={timeframe}
      klines={klines}
      playback
      showTimeframeTabs={false}
      markers={seriesMarkers}
      priceLines={priceLines}
      onDragPriceLine={onDragPriceLine}
      compare={
        compareSymbol
          ? { symbol: compareSymbol, klines: compareKlines ?? null, loading: compareLoading, error: compareError }
          : null
      }
      compareOptions={symbolOptions.map((s) => ({ value: s, label: s }))}
      onSelectCompare={onSelectCompare}
      onClearCompare={onClearCompare}
    />
  );
}
