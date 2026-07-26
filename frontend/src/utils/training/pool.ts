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

const QUOTE_SUFFIXES = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'BTC', 'ETH', 'BNB'] as const;

export function normalizeSymbol(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/[/_]/g, '-');
  if (!s) return '';
  // match backend normalize_symbol: keep base-quote, drop extra segments (BTC-USDT-SWAP → BTC-USDT)
  if (s.includes('-')) {
    const parts = s.split('-').filter(Boolean);
    return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : '';
  }
  // Same quote list as backend symbol_utils._QUOTE_SUFFIXES, so BTCUSDC splits as
  // BTC-USDC rather than becoming BTCUSDC-USDT.
  for (const quote of QUOTE_SUFFIXES) {
    if (s.endsWith(quote) && s.length > quote.length) {
      return `${s.slice(0, -quote.length)}-${quote}`;
    }
  }
  // Bare token: the pool is hand-typed, so 'btc' is meant as the USDT pair.
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
