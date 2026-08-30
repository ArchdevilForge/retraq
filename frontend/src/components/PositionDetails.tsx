import { memo, useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Trade, TradeFill } from '../services/api';
import { fetchTradeFills } from '../services/api';
import { fmtDateTime, fmtDurationMs, fmtMoney, fmtPct } from '../utils/format';
import { fmtPrice, isSyntheticFills } from '../utils/fills';
import AnnotationEditor from './AnnotationEditor';

function DetailRow({ label, value, valueClassName = '' }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5 text-[14px]">
      <div className="shrink-0 oc-text-faint">{label}</div>
      <div className={`truncate text-right font-medium tabular-nums ${valueClassName}`.trim()}>{value}</div>
    </div>
  );
}

function PositionDetails({ trade, onHide }: { trade: Trade | null; onHide?: () => void }) {
  const [fills, setFills] = useState<TradeFill[]>([]);
  const [fillsError, setFillsError] = useState(false);

  useEffect(() => {
    const tradeId = trade?.id;
    setFills([]);
    setFillsError(false);
    if (!tradeId) return;
    let ignore = false;
    fetchTradeFills(tradeId)
      .then((data) => {
        if (!ignore) setFills(data);
      })
      .catch(() => {
        if (!ignore) setFillsError(true);
      });
    return () => {
      ignore = true;
    };
  }, [trade?.id]);

  if (!trade) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center px-6 text-center">
        <p className="text-[14px] oc-text-faint">选中交易后显示仓位与成交明细</p>
      </div>
    );
  }

  // §9 方向标签：做多标绿 / 做空标红；历史数据存在大写方向，统一小写归一
  const dir = trade.direction?.toLowerCase();
  const directionLabel = dir === 'long' ? '做多' : dir === 'short' ? '做空' : trade.direction;
  const directionColor = dir === 'long' ? 'oc-text-profit' : dir === 'short' ? 'oc-text-loss' : '';
  const profitColor = (trade.profit ?? 0) >= 0 ? 'oc-text-profit' : 'oc-text-loss';
  const holdMs =
    trade.exit_time != null && trade.entry_time != null ? trade.exit_time - trade.entry_time : null;
  const synthetic = isSyntheticFills(fills, trade);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="panel-header flex shrink-0 items-center justify-between gap-2 text-[14px] font-medium">
        <span>交易详情</span>
        {onHide ? (
          <button
            type="button"
            className="oc-icon-btn oc-icon-btn--sm oc-panel-hide"
            aria-label="隐藏仓位详情"
            onClick={onHide}
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      <div className="panel-body min-h-0 flex-1 space-y-4 overflow-y-auto">
        <div className="panel-card space-y-2">
          <DetailRow label="交易对" value={trade.symbol} />
          <DetailRow label="方向" value={directionLabel} valueClassName={directionColor} />
          <DetailRow label="杠杆" value={trade.leverage?.toString?.() ?? '—'} />
          <DetailRow
            label="保证金 (U)"
            value={trade.margin == null ? '—' : `${fmtMoney(trade.margin)} USDT`}
          />
          <DetailRow label="持仓" value={holdMs == null ? '—' : fmtDurationMs(holdMs)} />
          <DetailRow label="开仓" value={fmtDateTime(trade.entry_time)} />
          <DetailRow label="开仓价" value={fmtPrice(trade.entry_price)} />
          <DetailRow label="平仓" value={trade.exit_time == null ? '—' : fmtDateTime(trade.exit_time)} />
          <DetailRow label="平仓价" value={trade.exit_price == null ? '—' : fmtPrice(trade.exit_price)} />
          <div className={`flex justify-between border-t border-[var(--border-weaker-base)] pt-3 text-[18px] font-medium ${profitColor}`}>
            <span>盈亏</span>
            <span className="font-mono tabular-nums">{trade.profit == null ? '—' : fmtMoney(trade.profit)}</span>
          </div>
          <DetailRow label="收益率" value={trade.profit_rate == null ? '—' : fmtPct(trade.profit_rate)} />
        </div>
        {fillsError ? (
          <p className="text-[13px] oc-text-loss" role="alert">
            成交明细加载失败，请检查后端服务
          </p>
        ) : fills.length > 0 ? (
          <div className="panel-card">
            <div className="panel-card-title">成交 {fills.length} 笔</div>
            <ul className="max-h-52 space-y-1.5 overflow-y-auto font-mono text-[13px] leading-snug">
              {fills.map((f) => {
                const usdt = synthetic && trade.margin != null ? trade.margin : f.price * f.qty;
                return (
                  <li key={f.id} className={f.side === 'BUY' ? 'oc-text-profit' : 'oc-text-loss'}>
                    {f.side === 'BUY' ? '买入' : '卖出'} {fmtMoney(usdt)}U @ {fmtPrice(f.price)} ·{' '}
                    {new Intl.DateTimeFormat('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    }).format(f.time_ms)}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <AnnotationEditor subjectType="trade" subjectId={trade.id} />
      </div>
    </div>
  );
}

export default memo(PositionDetails);
