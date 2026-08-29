/** 复盘周期键（docs/PRODUCT.md §三）：日 2026-08-29 / 周 ISO W35 / 月 2026-08。 */

export type ReviewCadence = 'daily' | 'weekly' | 'monthly';

export function periodKey(cadence: ReviewCadence, now: Date): string {
  const y = now.getFullYear();
  const pad = (n: number) => String(n).padStart(2, '0');
  if (cadence === 'daily') return `${y}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (cadence === 'monthly') return `${y}-${pad(now.getMonth() + 1)}`;
  // ISO week number
  const target = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week =
    1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${pad(week)}`;
}
