export function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('zh-CN', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(v);
}

export function fmtDateTime(ms: number): string {
  // D§9：严格 Asia/Shanghai (UTC+8)，格式形如 2026-08-27 20:30。
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(ms)
    .replace(/\//g, '-');
}

export function fmtDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin} 分`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m > 0 ? `${h} 时 ${m} 分` : `${h} 时`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d} 天 ${rh} 时` : `${d} 天`;
}
