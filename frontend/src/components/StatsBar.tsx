import { useEffect, useState } from 'react';
import { useDataset } from '../context/DatasetContext';
import { fetchStats } from '../services/api';
import type { StatsOverview } from '../services/api';

function StatCard({ label, value, description, valueColor }: { label: string; value: string; description?: string; valueColor?: string }) {
  return (
    <div className="stat">
      <div className="stat-title text-base-content/70">{label}</div>
      <div className={`stat-value text-2xl ${valueColor}`}>{value}</div>
      {description && <div className="stat-desc">{description}</div>}
    </div>
  );
}

export default function StatsBar() {
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
      <div className="stats shadow-sm w-full bg-base-200 border-b border-base-300 rounded-none">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="stat">
            <div className="h-6 bg-base-300 rounded w-24 mb-2 animate-pulse"></div>
            <div className="h-8 bg-base-300 rounded w-32 animate-pulse"></div>
          </div>
        ))}
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="stats shadow-sm w-full bg-base-200 border-b border-base-300 rounded-none">
        <div className="stat">
          <div className="stat-title">暂无数据</div>
          <div className="stat-value">—</div>
        </div>
      </div>
    );
  }

  const pnlColor = stats.total_pnl >= 0 ? 'text-success' : 'text-error';

  return (
    <div className="stats shadow-sm w-full bg-base-200 border-b border-base-300 rounded-none">
      <StatCard 
        label="总盈亏" 
        value={`$${stats.total_pnl.toFixed(2)}`}
        valueColor={pnlColor}
      />
      <StatCard 
        label="胜率" 
        value={`${stats.win_rate.toFixed(1)}%`}
      />
      <StatCard 
        label="盈亏比" 
        value={stats.profit_factor.toFixed(2)}
      />
      <StatCard 
        label="交易次数" 
        value={stats.trade_count.toString()}
      />
      <StatCard 
        label="最大回撤" 
        value={`$${stats.max_drawdown.toFixed(2)}`}
        valueColor="text-error"
      />
    </div>
  );
}
