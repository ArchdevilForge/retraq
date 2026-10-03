import { useEffect, useRef } from 'react';
import { AreaSeries, createChart, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';
import type { Trade } from '../../services/api';
import { readChartTheme } from '../../utils/chartTheme';

export type EquityPoint = { time: number; value: number };

/** 按平仓时间累计盈亏 → 权益曲线（docs/PRODUCT.md §七 图表化拉满）。 */
export function equityPoints(trades: Trade[]): EquityPoint[] {
  const closed = trades
    .filter((t) => t.exit_time != null)
    .sort((a, b) => (a.exit_time ?? 0) - (b.exit_time ?? 0));
  const points: EquityPoint[] = [];
  let acc = 0;
  for (const t of closed) {
    acc += t.profit ?? 0;
    const sec = Math.floor((t.exit_time ?? 0) / 1000);
    // 同一根 bar 多笔平仓：取累计值（lightweight-charts 要求时间升序且唯一）
    if (points.length && points[points.length - 1].time === sec) {
      points[points.length - 1].value = acc;
    } else {
      points.push({ time: sec, value: acc });
    }
  }
  return points;
}

/** 回撤曲线点：逐笔累计盈亏相对历史峰值的差值（恒 ≤ 0）。 */
export function drawdownPoints(trades: Trade[]): EquityPoint[] {
  const closed = trades
    .filter((t) => t.exit_time != null)
    .sort((a, b) => (a.exit_time ?? 0) - (b.exit_time ?? 0));
  const points: EquityPoint[] = [];
  let acc = 0;
  let peak = 0;
  for (const t of closed) {
    acc += t.profit ?? 0;
    peak = Math.max(peak, acc);
    const dd = acc - peak;
    const sec = Math.floor((t.exit_time ?? 0) / 1000);
    if (points.length && points[points.length - 1].time === sec) {
      points[points.length - 1].value = dd;
    } else {
      points.push({ time: sec, value: dd });
    }
  }
  return points;
}

/** 权益曲线（累计盈亏 area chart）；零数据时渲染空态。
 *  height=null 时填满父容器（分析页单视口布局：图表吃掉剩余高度，不产生滚动）。 */
export default function EquityCurve({
  trades,
  height = 220,
  fill = false,
  series = 'equity',
  emptyHint = '平仓不足两笔，暂无法绘制权益曲线。',
}: {
  trades: Trade[];
  height?: number;
  fill?: boolean;
  /** 'equity' = 累计盈亏（绿）；'drawdown' = 回撤曲线（红，恒 ≤ 0）。 */
  series?: 'equity' | 'drawdown';
  emptyHint?: string;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const theme = readChartTheme();
    const chart = createChart(el, {
      width: el.clientWidth,
      height: fill ? el.clientHeight : height,
      layout: { background: { color: 'transparent' }, textColor: theme.text },
      grid: {
        vertLines: { color: theme.gridLine },
        horzLines: { color: theme.gridLine },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { timeVisible: true, secondsVisible: false, borderVisible: false },
    });
    const line = series === 'drawdown' ? theme.down : theme.up;
    const s = chart.addSeries(AreaSeries, {
      lineColor: line,
      topColor: `${line}55`,
      bottomColor: 'transparent',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    chartRef.current = chart;
    seriesRef.current = s;

    const onResize = () =>
      chart.applyOptions({
        width: el.clientWidth,
        height: fill ? el.clientHeight : height,
      });
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height, fill, series]);

  useEffect(() => {
    const api = seriesRef.current;
    if (!api) return;
    const src = series === 'drawdown' ? drawdownPoints(trades) : equityPoints(trades);
    api.setData(src.map((p) => ({ time: p.time as Time, value: p.value })));
    chartRef.current?.timeScale().fitContent();
  }, [trades, series]);

  const points = series === 'drawdown' ? drawdownPoints(trades) : equityPoints(trades);
  if (points.length < 2) {
    return <p className="flex flex-1 items-center justify-center text-oc-13 oc-text-faint">{emptyHint}</p>;
  }
  return (
    <div
      ref={elRef}
      style={fill ? undefined : { height }}
      className={fill ? 'min-h-0 w-full flex-1' : 'w-full'}
    />
  );
}
