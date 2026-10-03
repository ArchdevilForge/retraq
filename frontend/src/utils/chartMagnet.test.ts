import { describe, it, expect } from 'vitest';
import { snapPriceToOhlc, MAGNET_TOLERANCE_PX } from './chartMagnet';

const bar = { open: 100, high: 110, low: 90, close: 105 };
/** 价格 = 屏幕 y 的恒等映射，便于直接给像素距离。 */
const identity = (p: number) => p;

describe('snapPriceToOhlc', () => {
  it('吸附到容忍范围内的最近 OHLC', () => {
    // 光标 y=108，high=110 距 2px（在 8px 内），close=105 距 3px
    expect(snapPriceToOhlc(108, bar, identity, 108)).toEqual({ price: 110, snapped: true });
  });

  it('超出容忍范围时原样返回，不吸附', () => {
    // 光标 y=140，最近的是 high=110，距离 30px > 8px
    expect(snapPriceToOhlc(140, bar, identity, 140)).toEqual({ price: 140, snapped: false });
  });

  // 只留 high 一个近邻候选，才能干净地测容忍边界（其余 OHLC 放到远处）
  const sparse = { open: 500, high: 110, low: 500, close: 500 };

  it('恰好在容忍边界上仍吸附（<= 而非 <）', () => {
    const y = 110 - MAGNET_TOLERANCE_PX;
    expect(snapPriceToOhlc(y, sparse, identity, y)).toEqual({ price: 110, snapped: true });
  });

  it('边界外 1px 不吸附', () => {
    const y = 110 - MAGNET_TOLERANCE_PX - 1;
    expect(snapPriceToOhlc(y, sparse, identity, y).snapped).toBe(false);
  });

  it('取最近的：low 比 high 更近时吸附 low', () => {
    // y=92: low=90 距 2，high=110 距 18
    expect(snapPriceToOhlc(92, bar, identity, 92)).toEqual({ price: 90, snapped: true });
  });

  it('无 bar 时不吸附', () => {
    expect(snapPriceToOhlc(100, null, identity, 100)).toEqual({ price: 100, snapped: false });
  });

  it('坐标换算失败（null/NaN）时跳过该候选', () => {
    const toScreen = (p: number) => (p === bar.high ? null : p);
    // high 不可换算 → 落到 close（105，距 2）
    expect(snapPriceToOhlc(107, bar, toScreen, 107)).toEqual({ price: 105, snapped: true });
  });

  it('全部候选不可换算时退化为不吸附', () => {
    expect(snapPriceToOhlc(107, bar, () => null, 107)).toEqual({ price: 107, snapped: false });
  });
});
