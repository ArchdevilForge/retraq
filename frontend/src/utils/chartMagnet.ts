/** 磁吸：在屏幕像素容忍范围内把落点吸附到最近 bar 的 OHLC（对标 weak/strong magnet）。
 *
 *  抽成纯函数以便单测 —— 原实现内联在 ChartCanvas 的 pointer 处理里，
 *  需要 chart/series 实例才能验证，等于不可测。
 */

/** 光标距 OHLC 价线的屏幕距离在此以内才吸附，避免总是被拽走。 */
export const MAGNET_TOLERANCE_PX = 8;

export type MagnetSnap = { price: number; snapped: boolean };

/**
 * 实测判据（e2e 曾用）：磁吸开启时，连续多个光标位置会折叠到**同一价**（台阶），
 * 关闭时为 0 次折叠。落点与真实 OHLC 的偏差来自 `coordinateToPrice` 的往返精度
 * （实测 close=2468.95 → 落点 2468.94），断言须容忍 ~0.01 而非要求精确相等。
 *
 * @param price    光标处的价格（未吸附）
 * @param bar      光标所在 bar 的 OHLC（无 bar 时传 null → 原样返回）
 * @param toScreen price → 屏幕 y 的换算（lightweight-charts series.priceToCoordinate）
 * @param cursorY  光标屏幕 y
 */
export function snapPriceToOhlc(
  price: number,
  bar: { open: number; high: number; low: number; close: number } | null,
  toScreen: (price: number) => number | null,
  cursorY: number,
  tolerance = MAGNET_TOLERANCE_PX,
): MagnetSnap {
  if (!bar) return { price, snapped: false };
  let best = price;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const cand of [bar.open, bar.high, bar.low, bar.close]) {
    const cy = toScreen(cand);
    if (cy == null || !Number.isFinite(cy)) continue;
    const d = Math.abs(cy - cursorY);
    if (d < bestDist && d <= tolerance) {
      bestDist = d;
      best = cand;
    }
  }
  return bestDist === Number.POSITIVE_INFINITY
    ? { price, snapped: false }
    : { price: best, snapped: true };
}
