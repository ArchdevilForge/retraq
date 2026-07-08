import { useEffect, useState } from 'react';
import { useDataset } from '../context/DatasetContext';
import { fetchStats } from '../services/api';
import type { StatsOverview } from '../services/api';

function StatItem({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <div className="oc-text-muted">{label}</div>
      <div className={`font-medium ${valueColor ?? ''}`}>{value}</div>
    </div>
  );
}

export default function StatsPanel() {
  const { activeDatasetId, tradesRevision } = useDataset();
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (activeDatasetId == null) return;
    setLoading(true);
    fetchStats()
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [activeDatasetId, tradesRevision]);

  if (loading) {
    return (
      <div className="space-y-3 p-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 oc-skeleton p-4" />
        ))}
      </div>
    );
  }

  if (!stats) return <div className="p-4 oc-text-muted">暂无统计数据。</div>;

  const pnlColor = stats.total_pnl >= 0 ? 'oc-text-profit' : 'oc-text-loss';

  return (
    <div className="h-full space-y-4 overflow-y-auto bg-[var(--background-base)] p-4">
      <h3 className="text-[16px] font-medium">绩效概览</h3>

      <div className="oc-card oc-card--bordered space-y-2">
        <StatItem label="总盈亏" value={`$${stats.total_pnl.toFixed(2)}`} valueColor={pnlColor} />
        <StatItem label="胜率" value={`${stats.win_rate.toFixed(1)}%`} />
        <StatItem label="盈亏比" value={stats.profit_factor.toFixed(2)} />
        <StatItem label="最大回撤" value={`$${stats.max_drawdown.toFixed(2)}`} valueColor="oc-text-loss" />
        <StatItem label="平均持仓时长" value={`${stats.avg_holding_time.toFixed(1)} 小时`} />
        <StatItem label="交易次数" value={stats.trade_count.toString()} />
      </div>

      <div className="oc-card oc-card--bordered">
        <h4 className="oc-card__title">交易对分布</h4>
        {Object.entries(stats.symbol_distribution).map(([symbol, count]) => (
          <div key={symbol} className="flex justify-between text-[13px]">
            <span className="font-mono">{symbol}</span>
            <span className="oc-text-muted">{count} 笔</span>
          </div>
        ))}
      </div>
    </div>
  );
}
