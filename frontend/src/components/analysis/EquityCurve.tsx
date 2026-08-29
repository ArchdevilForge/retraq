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

/** 权益曲线（累计盈亏 area chart）；零数据时渲染空态。 */
export default function EquityCurve({ trades, height = 220 }: { trades: Trade[]; height?: number }) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const theme = readChartTheme();
    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: { background: { color: 'transparent' }, textColor: theme.text },
      grid: {
        vertLines: { color: theme.gridLine },
        horzLines: { color: theme.gridLine },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { timeVisible: true, secondsVisible: false, borderVisible: false },
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: theme.up,
      topColor: `${theme.up}55`,
      bottomColor: 'transparent',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const onResize = () => chart.applyOptions({ width: el.clientWidth });
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const points = equityPoints(trades).map((p) => ({ time: p.time as Time, value: p.value }));
    series.setData(points);
    chartRef.current?.timeScale().fitContent();
  }, [trades]);

  const points = equityPoints(trades);
  if (points.length < 2) {
    return (
      <p className="py-8 text-center text-[13px] oc-text-faint">
        平仓不足两笔，暂无法绘制权益曲线。
      </p>
    );
  }
  return <div ref={elRef} style={{ height }} className="w-full" />;
}
