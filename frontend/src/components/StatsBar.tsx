import { useEffect, useState } from 'react';
import { useDataset } from '../context/DatasetContext';
import { fetchStats } from '../services/api';
import type { StatsOverview } from '../services/api';

function StatCard({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="oc-stat">
      <div className="oc-stat__label">{label}</div>
      <div className={`oc-stat__value ${valueColor ?? ''}`}>{value}</div>
    </div>
  );
}

export default function StatsBar() {
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
      <div className="oc-stat-grid oc-stat-grid--cols-4 border-b border-[var(--border-weaker-base)]">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="oc-stat">
            <div className="mb-2 h-4 oc-skeleton" />
            <div className="h-6 oc-skeleton" />
          </div>
        ))}
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="oc-stat-grid border-b border-[var(--border-weaker-base)]">
        <div className="oc-stat">
          <div className="oc-stat__label">暂无数据</div>
          <div className="oc-stat__value">—</div>
        </div>
      </div>
    );
  }

  const pnlColor = stats.total_pnl >= 0 ? 'oc-text-profit' : 'oc-text-loss';

  return (
    <div className="oc-stat-grid oc-stat-grid--cols-4 border-b border-[var(--border-weaker-base)]">
      <StatCard label="总盈亏" value={`$${stats.total_pnl.toFixed(2)}`} valueColor={pnlColor} />
      <StatCard label="胜率" value={`${stats.win_rate.toFixed(1)}%`} />
      <StatCard label="盈亏比" value={stats.profit_factor.toFixed(2)} />
      <StatCard label="交易次数" value={stats.trade_count.toString()} />
      <StatCard label="最大回撤" value={`$${stats.max_drawdown.toFixed(2)}`} valueColor="oc-text-loss" />
    </div>
  );
}
