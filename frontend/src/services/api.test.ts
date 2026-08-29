import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ACTIVE_DATASET_STORAGE_KEY,
  deleteDataset,
  fetchDatasets,
  fetchKlines,
  fetchStats,
  fetchSymbolStats,
  fetchTradeFills,
  fetchTrades,
  fetchTradesWithTotal,
  importTrades,
  updateDataset,
} from './api';
import type { KlineApiRow, Trade, TradesResponse } from './api';

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const fetchMock = vi.fn<FetchFn>();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function urlAt(index: number): string {
  return String(fetchMock.mock.calls[index][0]);
}

function headersAt(index: number): Headers {
  return new Headers(fetchMock.mock.calls[index][1]?.headers);
}

function makeTrade(id: number): Trade {
  return {
    id,
    symbol: 'BTCUSDT',
    direction: 'long',
    leverage: 10,
    entry_price: 100,
    exit_price: 110,
    profit: 10,
    profit_rate: 0.1,
    margin: 100,
    entry_time: 1_700_000_000_000,
    exit_time: 1_700_003_600_000,
  };
}

function tradesPage(rows: Trade[], total: number, page = 1): TradesResponse {
  return { total, page, limit: 2000, data: rows };
}

function csvFile(name = 'trades.csv'): File {
  return new File(['symbol,profit\nBTCUSDT,1\n'], name, { type: 'text/csv' });
}

// Node >= 22 defines its own `localStorage` global that shadows the jsdom one unless the
// runtime is started with --localstorage-file, so back the global with an in-memory Storage.
function createStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('localStorage', createStorage());
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('X-Dataset-Id header scoping', () => {
  beforeEach(() => {
    localStorage.setItem(ACTIVE_DATASET_STORAGE_KEY, '42');
  });

  it('sends the header on /api/stats/* paths', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ trade_count: 0, symbol_distribution: {} }));

    await fetchStats();
    expect(headersAt(0).get('X-Dataset-Id')).toBe('42');

    await fetchSymbolStats();
    expect(headersAt(1).get('X-Dataset-Id')).toBe('42');
  });

  it('sends the header on /api/trades paths', async () => {
    fetchMock.mockResolvedValue(jsonResponse(tradesPage([], 0)));
    await fetchTrades();
    expect(headersAt(0).get('X-Dataset-Id')).toBe('42');

    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
    await fetchTradeFills(7);
    expect(urlAt(1)).toBe('/api/trades/7/fills');
    expect(headersAt(1).get('X-Dataset-Id')).toBe('42');
  });

  it('does NOT send the header on /api/trades/import', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ total: 1, success: 1, failed: 0 }));

    await importTrades(csvFile());

    expect(urlAt(0).startsWith('/api/trades/import?')).toBe(true);
    expect(headersAt(0).has('X-Dataset-Id')).toBe(false);
  });

  it('does NOT send the header on unscoped paths', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
    await fetchDatasets();
    expect(headersAt(0).has('X-Dataset-Id')).toBe(false);

    fetchMock.mockResolvedValue(jsonResponse({ id: 1, name: 'x', created_at: null }));
    await updateDataset(1, 'x');
    expect(headersAt(1).has('X-Dataset-Id')).toBe(false);
    // Caller-supplied headers survive the dataset-header logic.
    expect(headersAt(1).get('Content-Type')).toBe('application/json');
  });

  it('omits the header when no dataset is active', async () => {
    localStorage.removeItem(ACTIVE_DATASET_STORAGE_KEY);
    fetchMock.mockResolvedValue(jsonResponse({ trade_count: 0, symbol_distribution: {} }));

    await fetchStats();

    expect(headersAt(0).has('X-Dataset-Id')).toBe(false);
  });

  it('omits the header when the stored id is an empty string', async () => {
    localStorage.setItem(ACTIVE_DATASET_STORAGE_KEY, '');
    fetchMock.mockResolvedValue(jsonResponse({ trade_count: 0, symbol_distribution: {} }));

    await fetchStats();

    expect(headersAt(0).has('X-Dataset-Id')).toBe(false);
  });
});

describe('query building', () => {
  it('drops undefined and null params and stringifies the rest', async () => {
    fetchMock.mockResolvedValue(jsonResponse(tradesPage([], 0)));

    await fetchTradesWithTotal(
      { symbol: null as unknown as string, start_date: 5, end_date: undefined },
      { limit: 50, maxPages: 1 },
    );

    expect(urlAt(0)).toBe('/api/trades?start_date=5&page=1&limit=50');
  });

  it('stringifies booleans', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ total: 0, success: 0, failed: 0 }));

    await importTrades(csvFile(), 'binance_futures_trades', { replace: false, label: '三月' });

    const query = new URLSearchParams(urlAt(0).split('?')[1]);
    expect(query.get('template')).toBe('binance_futures_trades');
    expect(query.get('replace')).toBe('false');
    expect(query.get('label')).toBe('三月');
  });

  it('emits a bare path when there are no params', async () => {
    fetchMock.mockResolvedValue(jsonResponse(undefined, 204));

    await deleteDataset(3);

    expect(urlAt(0)).toBe('/api/datasets/3');
  });
});

describe('fetchKlines', () => {
  const row: KlineApiRow = {
    timestamp: 1_700_000_123_456,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 100,
  };

  it('maps the backend ms timestamp to a seconds `time`', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [row] }));

    const klines = await fetchKlines('BTCUSDT', '1h');

    expect(klines).toEqual([
      { time: 1_700_000_123, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 },
    ]);
    expect(urlAt(0)).toBe('/api/klines/BTCUSDT/1h');
  });

  it('passes the range through and turns forceRefresh into nocache=1', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    await fetchKlines('ETHUSDT', '5m', { start: 1000, end: undefined, limit: 500, forceRefresh: true });

    expect(urlAt(0)).toBe('/api/klines/ETHUSDT/5m?start=1000&limit=500&nocache=1');
  });

  it('retries a 502 and sets nocache on the retry', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: '上游超时' }, 502))
      .mockResolvedValueOnce(jsonResponse({ data: [row] }));

    const klines = await fetchKlines('BTCUSDT', '1h', { limit: 10 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urlAt(0)).toBe('/api/klines/BTCUSDT/1h?limit=10');
    expect(urlAt(1)).toBe('/api/klines/BTCUSDT/1h?limit=10&nocache=1');
    expect(klines[0].time).toBe(1_700_000_123);
  });

  it('does NOT retry a 404', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: '无此交易对' }, 404));

    await expect(fetchKlines('NOPEUSDT', '1h')).rejects.toThrow('无此交易对');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rethrows the last error after exhausting 4 attempts', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: '上游超时' }, 502));

    await expect(fetchKlines('BTCUSDT', '1h')).rejects.toMatchObject({
      message: '上游超时',
      status: 502,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  }, 15_000);
});

describe('fetchTradesWithTotal pagination', () => {
  it('stops once it has collected `total` rows', async () => {
    fetchMock.mockResolvedValue(jsonResponse(tradesPage([makeTrade(1), makeTrade(2)], 2)));

    const { trades, total } = await fetchTradesWithTotal();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(trades).toHaveLength(2);
    expect(total).toBe(2);
    expect(urlAt(0)).toBe('/api/trades?page=1&limit=2000');
  });

  it('stops on an empty page even when `total` is larger', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(tradesPage([makeTrade(1), makeTrade(2)], 100, 1)))
      .mockResolvedValueOnce(jsonResponse(tradesPage([], 100, 2)));

    const { trades, total } = await fetchTradesWithTotal();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(trades).toHaveLength(2);
    expect(total).toBe(100);
  });

  it('respects maxPages and still reports the server-side total so truncation is detectable', async () => {
    fetchMock.mockImplementation((input) => {
      const page = new URLSearchParams(String(input).split('?')[1]).get('page')!;
      return Promise.resolve(jsonResponse(tradesPage([makeTrade(Number(page))], 100, Number(page))));
    });

    const { trades, total } = await fetchTradesWithTotal(undefined, { limit: 1, maxPages: 3 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(trades.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(total).toBe(100);
    expect(trades.length).toBeLessThan(total);
  });

  it('starts from the requested page', async () => {
    fetchMock.mockResolvedValue(jsonResponse(tradesPage([makeTrade(1)], 1, 4)));

    await fetchTradesWithTotal(undefined, { page: 4, limit: 10 });

    expect(urlAt(0)).toBe('/api/trades?page=4&limit=10');
  });

  it('pins the dataset id for the whole loop so a mid-flight switch cannot merge datasets', async () => {
    localStorage.setItem(ACTIVE_DATASET_STORAGE_KEY, '1');
    fetchMock
      .mockImplementationOnce(() => {
        localStorage.setItem(ACTIVE_DATASET_STORAGE_KEY, '2');
        return Promise.resolve(jsonResponse(tradesPage([makeTrade(1)], 100, 1)));
      })
      .mockResolvedValueOnce(jsonResponse(tradesPage([], 100, 2)));

    await fetchTradesWithTotal(undefined, { limit: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(headersAt(0).get('X-Dataset-Id')).toBe('1');
    expect(headersAt(1).get('X-Dataset-Id')).toBe('1');
  });

  it('fetchTrades returns only the rows', async () => {
    fetchMock.mockResolvedValue(jsonResponse(tradesPage([makeTrade(9)], 1)));

    await expect(fetchTrades()).resolves.toEqual([makeTrade(9)]);
  });
});

describe('importTrades', () => {
  it('defaults to template=auto, replace=true and a label derived from the file name', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ total: 3, success: 3, failed: 0 }));

    await importTrades(csvFile('2024-03.xlsx'));

    const query = new URLSearchParams(urlAt(0).split('?')[1]);
    expect(query.get('template')).toBe('auto');
    expect(query.get('replace')).toBe('true');
    expect(query.get('label')).toBe('2024-03');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
    expect(fetchMock.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
  });

  it('surfaces the backend detail message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: '模板不匹配' }, 400));

    await expect(importTrades(csvFile())).rejects.toThrow('模板不匹配');
  });

  it('falls back to a generic Chinese message when the backend sends no detail', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 500));

    await expect(importTrades(csvFile())).rejects.toThrow('导入失败，请检查文件与模板');
  });
});

describe('Master Traders API', () => {
  it('fetchMasterTraders builds query and skips dataset header', async () => {
    const payload = { total: 1, page: 1, limit: 30, data: [] };
    fetchMock.mockResolvedValue(jsonResponse(payload));

    const res = await (await import('./api')).fetchMasterTraders({
      search: 'Trend',
      has_positions_only: true,
      sort_by: 'pnl',
      sort_order: 'desc',
    });

    expect(res).toEqual(payload);
    expect(urlAt(0)).toContain('/api/masters?');
    expect(urlAt(0)).toContain('search=Trend');
    expect(urlAt(0)).toContain('sort_by=pnl');
    expect(headersAt(0).get('X-Dataset-Id')).toBeNull();
  });

  it('fetchMasterTrader calls trader detail endpoint', async () => {
    const payload = { id: '123', nickname: 'Master1' };
    fetchMock.mockResolvedValue(jsonResponse(payload));

    const res = await (await import('./api')).fetchMasterTrader('123');
    expect(res).toEqual(payload);
    expect(urlAt(0)).toBe('/api/masters/123');
  });

  it('fetchMasterPositions calls positions endpoint with filters', async () => {
    const payload = { total: 0, page: 1, limit: 50, data: [] };
    fetchMock.mockResolvedValue(jsonResponse(payload));

    const res = await (await import('./api')).fetchMasterPositions('123', {
      symbol: 'BTC-USDT',
      side: 'LONG',
    });

    expect(res).toEqual(payload);
    expect(urlAt(0)).toContain('/api/masters/123/positions?');
    expect(urlAt(0)).toContain('symbol=BTC-USDT');
    expect(urlAt(0)).toContain('side=LONG');
  });

  it('fetchMasterOverlay calls overlay endpoint', async () => {
    const payload = { symbol: 'BTC-USDT', data: [] };
    fetchMock.mockResolvedValue(jsonResponse(payload));

    const res = await (await import('./api')).fetchMasterOverlay('BTC-USDT', 1000, 2000);
    expect(res).toEqual(payload);
    expect(urlAt(0)).toContain('/api/masters/overlay?');
    expect(urlAt(0)).toContain('symbol=BTC-USDT');
    expect(urlAt(0)).toContain('start_ts=1000');
    expect(urlAt(0)).toContain('end_ts=2000');
  });

  it('cloneMasterDataset posts to clone endpoint', async () => {
    const payload = { success: true, dataset_id: 2, dataset_name: '[实盘] Master', trade_count: 5 };
    fetchMock.mockResolvedValue(jsonResponse(payload));

    const res = await (await import('./api')).cloneMasterDataset('123');
    expect(res).toEqual(payload);
    expect(urlAt(0)).toBe('/api/masters/123/clone');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
  });

  it('syncMasterTrader posts to sync endpoint', async () => {
    const payload = { success: true, trader_id: '123', new_count: 3, total_positions: 10, nickname: 'Master' };
    fetchMock.mockResolvedValue(jsonResponse(payload));

    const res = await (await import('./api')).syncMasterTrader('123');
    expect(res).toEqual(payload);
    expect(urlAt(0)).toBe('/api/masters/123/sync');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
  });

  it('fetchMasterQuotes returns quotes array', async () => {
    const payload = { data: [{ id: 'bitking', author: '比特皇' }] };
    fetchMock.mockResolvedValue(jsonResponse(payload));

    const res = await (await import('./api')).fetchMasterQuotes();
    expect(res).toEqual(payload.data);
    expect(urlAt(0)).toBe('/api/masters/quotes');
  });
});
