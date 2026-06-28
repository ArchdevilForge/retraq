import { useEffect, useState } from 'react';
import { useDataset } from '../context/DatasetContext';
import { fetchStats } from '../services/api';
import type { StatsOverview } from '../services/api';

function StatItem({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <div className="text-base-content/70">{label}</div>
      <div className={`font-semibold ${valueColor}`}>{value}</div>
    </div>
  );
}

export default function StatsPanel() {
  const { activeDatasetId } = useDataset();
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (activeDatasetId == null) return;
    setLoading(true);
    fetchStats()
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [activeDatasetId]);

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 bg-base-200 rounded-lg p-4 animate-pulse">
            <div className="h-4 bg-base-300 rounded w-3/4 mb-2"></div>
            <div className="h-6 bg-base-300 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    );
  }

  if (!stats) return <div className="p-4 text-base-content/70">暂无统计数据。</div>;

  const pnlColor = stats.total_pnl >= 0 ? 'text-success' : 'text-error';

  return (
    <div className="bg-base-200 h-full p-4 space-y-4 overflow-y-auto">
      <h3 className="font-bold text-lg mb-4">绩效概览</h3>
      
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-4">
          <StatItem label="总盈亏" value={`$${stats.total_pnl.toFixed(2)}`} valueColor={pnlColor} />
          <StatItem label="胜率" value={`${stats.win_rate.toFixed(1)}%`} />
          <StatItem label="盈亏比" value={stats.profit_factor.toFixed(2)} />
          <StatItem label="最大回撤" value={`$${stats.max_drawdown.toFixed(2)}`} valueColor="text-error" />
          <StatItem label="平均持仓时长" value={`${stats.avg_holding_time.toFixed(1)} 小时`} />
          <StatItem label="交易次数" value={stats.trade_count.toString()} />
        </div>
      </div>

      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-4">
          <h4 className="card-title text-base mb-2">交易对分布</h4>
          {Object.entries(stats.symbol_distribution).map(([symbol, count]) => (
            <div key={symbol} className="flex justify-between text-sm">
              <span className="font-mono">{symbol}</span>
              <span className="text-base-content/70">{count} 笔</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
