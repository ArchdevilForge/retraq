const STORAGE_KEY = 'retraq.trainingPool';

export const DEFAULT_TRAINING_POOL = [
  'BTC-USDT',
  'ETH-USDT',
  'SOL-USDT',
  'BNB-USDT',
  'XRP-USDT',
  'DOGE-USDT',
  'ADA-USDT',
  'AVAX-USDT',
] as const;

export function normalizeSymbol(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/[/_]/g, '-');
  if (!s) return '';
  if (s.includes('-')) return s;
  if (s.endsWith('USDT')) return `${s.slice(0, -4)}-USDT`;
  return `${s}-USDT`;
}

export function loadTrainingPool(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_TRAINING_POOL];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_TRAINING_POOL];
    const cleaned = parsed
      .map((x) => (typeof x === 'string' ? normalizeSymbol(x) : ''))
      .filter(Boolean);
    return cleaned.length > 0 ? [...new Set(cleaned)] : [...DEFAULT_TRAINING_POOL];
  } catch {
    return [...DEFAULT_TRAINING_POOL];
  }
}

export function saveTrainingPool(pool: string[]): void {
  const cleaned = [...new Set(pool.map(normalizeSymbol).filter(Boolean))];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned.length ? cleaned : [...DEFAULT_TRAINING_POOL]));
}
