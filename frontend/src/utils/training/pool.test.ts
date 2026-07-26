import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TRAINING_POOL, loadTrainingPool, normalizeSymbol, saveTrainingPool } from './pool';

// Snapshot before any test can mutate it: comparing against the live constant would
// make every fallback assertion a self-comparison if loadTrainingPool ever aliased it.
const PRISTINE_DEFAULT: readonly string[] = [...DEFAULT_TRAINING_POOL];

const STORAGE_KEY = 'retraq.trainingPool';

/**
 * Node >= 22 defines its own `localStorage` accessor that resolves to undefined unless
 * `--localstorage-file` is passed, and it shadows the one jsdom installs. Pin a fresh
 * in-memory Storage per test so the pool round-trips are isolated and deterministic.
 */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => {
      map.clear();
    },
  } as Storage;
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: memoryStorage(),
    configurable: true,
    writable: true,
  });
});

describe('normalizeSymbol', () => {
  it('matches the backend symbol_utils.normalize_symbol contract', () => {
    const table: Array<[string, string]> = [
      ['', ''],
      ['   ', ''],
      ['btc', 'BTC-USDT'],
      ['BTCUSDT', 'BTC-USDT'],
      ['btc/usdt', 'BTC-USDT'],
      ['BTC-USDT-SWAP', 'BTC-USDT'],
      ['btc-usdt-swap', 'BTC-USDT'],
      ['BTC-USDT', 'BTC-USDT'],
      ['  eth-usdt  ', 'ETH-USDT'],
      ['btc_usdt', 'BTC-USDT'],
      ['ETHUSDT', 'ETH-USDT'],
    ];
    for (const [raw, expected] of table) {
      expect(normalizeSymbol(raw), raw).toBe(expected);
    }
  });

  it('rejects a dash form with no quote segment', () => {
    expect(normalizeSymbol('BTC-')).toBe('');
    expect(normalizeSymbol('-')).toBe('');
  });
});

describe('loadTrainingPool', () => {
  it('falls back to the default pool when storage is empty', () => {
    expect(loadTrainingPool()).toEqual(PRISTINE_DEFAULT);
  });

  it('falls back on corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadTrainingPool()).toEqual(PRISTINE_DEFAULT);
  });

  it('falls back on non-array JSON', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ a: 1 }));
    expect(loadTrainingPool()).toEqual(PRISTINE_DEFAULT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify('BTC-USDT'));
    expect(loadTrainingPool()).toEqual(PRISTINE_DEFAULT);
  });

  it('falls back when every entry is blank or non-string', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['', '   ', 'BTC-', null, 42]));
    expect(loadTrainingPool()).toEqual(PRISTINE_DEFAULT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
    expect(loadTrainingPool()).toEqual(PRISTINE_DEFAULT);
  });

  it('normalizes and de-duplicates stored entries, preserving first-seen order', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['eth', 'BTCUSDT', 'btc/usdt', 'BTC-USDT-SWAP', '']));
    expect(loadTrainingPool()).toEqual(['ETH-USDT', 'BTC-USDT']);
  });

  it('returns a fresh array each call so callers cannot mutate the default pool', () => {
    const a = loadTrainingPool();
    const b = loadTrainingPool();
    expect(b).not.toBe(a);
    a.push('MUT-USDT');
    expect(loadTrainingPool()).toEqual(PRISTINE_DEFAULT);
    expect([...DEFAULT_TRAINING_POOL]).toEqual(PRISTINE_DEFAULT);
  });
});

describe('saveTrainingPool', () => {
  it('round-trips a normalized, de-duplicated pool', () => {
    saveTrainingPool(['btc', 'eth/usdt', 'BTCUSDT', 'SOL-USDT-SWAP']);
    expect(loadTrainingPool()).toEqual(['BTC-USDT', 'ETH-USDT', 'SOL-USDT']);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual([
      'BTC-USDT',
      'ETH-USDT',
      'SOL-USDT',
    ]);
  });

  it('writes the default pool when the input normalizes to nothing', () => {
    saveTrainingPool([]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual([
      ...DEFAULT_TRAINING_POOL,
    ]);
    expect(loadTrainingPool()).toEqual(PRISTINE_DEFAULT);

    saveTrainingPool(['', '  ', 'BTC-']);
    expect(loadTrainingPool()).toEqual(PRISTINE_DEFAULT);
  });

  it('overwrites a previously saved pool', () => {
    saveTrainingPool(['btc']);
    saveTrainingPool(['eth']);
    expect(loadTrainingPool()).toEqual(['ETH-USDT']);
  });
});
