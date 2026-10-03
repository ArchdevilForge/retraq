import { describe, it, expect } from 'vitest';
import { drawdownPoints, equityPoints } from './EquityCurve';
import type { Trade } from '../../services/api';

/** 只填 equityPoints/drawdownPoints 关心的字段。 */
function t(exit_time: number, profit: number | null): Trade {
  return {
    id: exit_time,
    symbol: 'ETH-USDT',
    direction: 'long',
    leverage: 1,
    entry_price: 0,
    exit_price: null,
    profit,
    profit_rate: null,
    margin: null,
    entry_time: exit_time - 1000,
    exit_time,
  };
}

describe('equityPoints', () => {
  it('累积盈亏并按平仓时间升序', () => {
    expect(equityPoints([t(3000, 50), t(1000, 10), t(2000, -5)])).toEqual([
      { time: 1, value: 10 },
      { time: 2, value: 5 },
      { time: 3, value: 55 },
    ]);
  });

  it('跳过未平仓交易', () => {
    const open = { ...t(4000, 999), exit_time: null };
    expect(equityPoints([t(1000, 10), open])).toEqual([{ time: 1, value: 10 }]);
  });

  it('同秒多笔平仓合并为最后一个累计值', () => {
    expect(equityPoints([t(1000, 10), t(1000, 20)])).toEqual([{ time: 1, value: 30 }]);
  });
});

describe('drawdownPoints', () => {
  it('恒 ≤ 0，且在创新高时为 0', () => {
    const pts = drawdownPoints([t(1000, 100), t(2000, -30), t(3000, 500), t(4000, -10)]);
    expect(pts.every((p) => p.value <= 0)).toBe(true);
    expect(pts.map((p) => p.value)).toEqual([0, -30, 0, -10]);
  });

  it('回撤相对历史峰值而非上一笔', () => {
    // 峰值 100 → -20 后累计 80，再 -30 → 50（回撤 -50，不是 -30）
    expect(drawdownPoints([t(1000, 100), t(2000, -20), t(3000, -30)]).map((p) => p.value)).toEqual([0, -20, -50]);
  });

  it('全亏损序列的峰值保持在 0', () => {
    expect(drawdownPoints([t(1000, -10), t(2000, -20)]).map((p) => p.value)).toEqual([-10, -30]);
  });

  it('空数据返回空数组', () => {
    expect(drawdownPoints([])).toEqual([]);
  });
});
