import type { Trade, TradeFill } from '../services/api';

/** 合成成交：导入时按保证金补出的占位单（qty 恒为 1），整笔交易统一判定。 */
export function isSyntheticFills(fills: TradeFill[], trade: Trade): boolean {
  return trade.margin != null && fills.length > 0 && fills.length <= 2 && fills.every((f) => f.qty === 1);
}

/** 价格精度随量级自适应：亚分币不显示成 0.00，也不退化成科学计数法。 */
export function fmtPrice(price: number): string {
  if (!Number.isFinite(price)) return '—';
  const abs = Math.abs(price);
  if (abs >= 1000) return price.toFixed(2);
  if (abs >= 1) return price.toFixed(4);
  if (abs >= 1e-7) return price.toFixed(3 - Math.floor(Math.log10(abs)));
  return price.toFixed(8);
}
