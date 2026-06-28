import { useEffect, useState } from 'react';
import type { Trade, TradeFill } from '../services/api';
import { fetchTradeFills } from '../services/api';

function DetailRow({ label, value, valueClassName = '' }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5 text-base">
      <div className="shrink-0 text-base-content/55">{label}</div>
      <div className={`truncate text-right font-medium ${valueClassName}`.trim()}>{value}</div>
    </div>
  );
}

function PositionDetails({ trade }: { trade: Trade | null }) {
  const [fills, setFills] = useState<TradeFill[]>([]);

  useEffect(() => {
    if (!trade?.id) {
      setFills([]);
      return;
    }
    fetchTradeFills(trade.id).then(setFills).catch(() => setFills([]));
  }, [trade?.id]);

  if (!trade) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center px-6 text-center">
        <p className="text-base text-base-content/50">选中交易后显示仓位与成交明细</p>
      </div>
    );
  }

  const directionLabel = trade.direction === 'long' ? '多' : trade.direction === 'short' ? '空' : trade.direction;
  const directionColor = trade.direction === 'long' ? 'text-success' : trade.direction === 'short' ? 'text-error' : '';
  const profitColor = (trade.profit ?? 0) >= 0 ? 'text-success' : 'text-error';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="panel-header shrink-0 text-base font-semibold">仓位详情</div>
      <div className="panel-body min-h-0 flex-1 space-y-4 overflow-y-auto">
        <div className="panel-card space-y-2">
          <DetailRow label="交易对" value={trade.symbol} />
          <DetailRow label="方向" value={directionLabel} valueClassName={directionColor} />
          <DetailRow label="杠杆" value={trade.leverage?.toString?.() ?? '—'} />
          <DetailRow
            label="保证金 (U)"
            value={trade.margin == null ? '—' : `${trade.margin.toFixed(2)} USDT`}
          />
          <DetailRow label="开仓" value={new Date(trade.entry_time).toLocaleString('zh-CN')} />
          <DetailRow label="开仓价" value={trade.entry_price.toFixed(4)} />
          <DetailRow label="平仓" value={trade.exit_time == null ? '—' : new Date(trade.exit_time).toLocaleString('zh-CN')} />
          <DetailRow label="平仓价" value={trade.exit_price == null ? '—' : trade.exit_price.toFixed(4)} />
          <div className={`flex justify-between border-t border-white/[0.06] pt-3 text-lg font-bold ${profitColor}`}>
            <span>盈亏</span>
            <span className="font-mono tabular-nums">{trade.profit == null ? '—' : trade.profit.toFixed(2)}</span>
          </div>
          <DetailRow label="收益率" value={trade.profit_rate == null ? '—' : `${(trade.profit_rate * 100).toFixed(2)}%`} />
        </div>
        {fills.length > 0 ? (
          <div className="panel-card">
            <div className="panel-card-title">成交 {fills.length} 笔</div>
            <ul className="max-h-52 space-y-1.5 overflow-y-auto font-mono text-sm leading-snug">
              {fills.map((f) => {
                const synthetic = fills.length <= 2 && f.qty === 1 && trade.margin != null;
                const usdt = synthetic ? trade.margin! : f.price * f.qty;
                return (
                  <li key={f.id} className={f.side === 'BUY' ? 'text-success' : 'text-error'}>
                    {f.side === 'BUY' ? '买入' : '卖出'} {usdt.toFixed(2)}U @ {f.price.toFixed(4)} ·{' '}
                    {new Date(f.time_ms).toLocaleString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default PositionDetails;