/** localStorage key for active dataset id (also used by DatasetContext). */
export const ACTIVE_DATASET_STORAGE_KEY = 'retraq.activeDatasetId';

type ApiFetchInit = RequestInit & {
  params?: Record<string, string | number | boolean | undefined | null>;
  /** Skip dataset header even on dataset-scoped paths. */
  skipDataset?: boolean;
};

function needsDatasetHeader(path: string): boolean {
  const base = path.split('?')[0];
  return (
    base.startsWith('/api/stats/') ||
    (base.startsWith('/api/trades') && !base.startsWith('/api/trades/import'))
  );
}

function buildUrl(path: string, params?: ApiFetchInit['params']): string {
  if (!params) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const { params, skipDataset, headers: initHeaders, ...rest } = init;
  const headers = new Headers(initHeaders);
  if (!skipDataset && needsDatasetHeader(path)) {
    const id = localStorage.getItem(ACTIVE_DATASET_STORAGE_KEY);
    if (id) headers.set('X-Dataset-Id', id);
  }
  const res = await fetch(buildUrl(path, params), { ...rest, headers });
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const body = (await res.json()) as { detail?: string };
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      /* ignore */
    }
    const err = new Error(detail ?? `HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface Kline {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Backend `/api/klines` row shape (timestamp ms). */
export interface KlineApiRow {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradeFill {
  id: number;
  side: 'BUY' | 'SELL';
  price: number;
  qty: number;
  time_ms: number;
  realized_pnl: number | null;
}

export async function fetchTradeFills(tradeId: number): Promise<TradeFill[]> {
  const data = await apiFetch<{ data: TradeFill[] }>(`/api/trades/${tradeId}/fills`);
  return data.data;
}

export interface Trade {
  id: number;
  symbol: string;
  direction: 'long' | 'short';
  leverage: number;
  entry_price: number;
  exit_price: number | null;
  profit: number | null;
  /** Decimal ratio (0.1 = 10%); matches Intl percent formatting. */
  profit_rate: number | null;
  margin: number | null;
  entry_time: number;
  exit_time: number | null;
}

export const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export interface TradesResponse {
  total: number;
  page: number;
  limit: number;
  data: Trade[];
}

export interface Dataset {
  id: number;
  name: string;
  created_at: string | null;
}

export async function fetchDatasets(): Promise<{ data: Dataset[] }> {
  return apiFetch<{ data: Dataset[] }>('/api/datasets');
}

export async function updateDataset(id: number, name: string): Promise<Dataset> {
  return apiFetch<Dataset>(`/api/datasets/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function deleteDataset(id: number): Promise<void> {
  await apiFetch<void>(`/api/datasets/${id}`, { method: 'DELETE' });
}

export async function fetchImportTemplates(): Promise<{ id: string; label: string }[]> {
  const data = await apiFetch<{ templates: { id: string; label: string }[] }>('/api/import/templates');
  return data.templates;
}

export async function fetchKlines(
  symbol: string,
  timeframe: Timeframe,
  options?: { start?: number; end?: number; limit?: number; forceRefresh?: boolean },
): Promise<Kline[]> {
  const url = `/api/klines/${symbol}/${timeframe}`;
  const { forceRefresh, ...range } = options ?? {};
  const params: Record<string, string | number | boolean | undefined> = { ...range };
  if (forceRefresh) params.nocache = 1;

  const maxAttempts = 4;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const data = await apiFetch<{ data: KlineApiRow[] }>(url, { params });
      return data.data.map((k) => ({
        time: Math.floor(k.timestamp / 1000),
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: k.volume,
      }));
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number })?.status;
      const shouldRetry = status == null || status === 502 || status === 503 || status === 504;
      if (!shouldRetry || attempt === maxAttempts) break;
      params.nocache = 1;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastError;
}

export interface SymbolStats {
  trade_count: number;
  symbol_distribution: Record<string, number>;
}

export async function fetchSymbolStats(): Promise<SymbolStats> {
  return apiFetch<SymbolStats>('/api/stats/symbols');
}

export async function fetchTrades(
  filters?: { symbol?: string; start_date?: number; end_date?: number },
  options?: { limit?: number; maxPages?: number; page?: number },
): Promise<Trade[]> {
  const limit = options?.limit ?? 2000;
  const maxPages = options?.maxPages ?? 20;
  const startPage = options?.page ?? 1;

  const allTrades: Trade[] = [];
  for (let page = startPage; page < startPage + maxPages; page += 1) {
    const data = await apiFetch<TradesResponse>('/api/trades', {
      params: { ...filters, page, limit },
    });
    allTrades.push(...data.data);
    if (allTrades.length >= data.total || data.data.length === 0) break;
  }

  return allTrades;
}

function importErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message && !err.message.startsWith('HTTP ')) return err.message;
  return '导入失败，请检查文件与模板';
}

/** Matches backend /api/trades/import (main always sets template/dataset/replaced). */
export type ImportResult = {
  total: number;
  success: number;
  failed: number;
  template: string;
  dataset_id: number;
  dataset_name: string;
  replaced: boolean;
  /** binance_futures_trades only */
  fills?: number;
  closed_positions?: number;
};

export async function importTrades(
  file: File,
  template: string = 'auto',
  options?: { replace?: boolean; label?: string },
): Promise<ImportResult> {
  const formData = new FormData();
  formData.append('file', file);
  const label = options?.label ?? file.name.replace(/\.(xlsx|xls|csv)$/i, '');
  try {
    return await apiFetch<ImportResult>('/api/trades/import', {
      method: 'POST',
      params: {
        template,
        replace: options?.replace !== false,
        label,
      },
      body: formData,
    });
  } catch (err) {
    throw new Error(importErrorMessage(err));
  }
}

export interface StatsOverview {
  total_pnl: number;
  /** Percent 0–100 (not 0–1). Display as `${win_rate.toFixed(1)}%`, not fmtPct. */
  win_rate: number;
  profit_factor: number;
  max_drawdown: number;
  /** Hours. */
  avg_holding_time: number;
  symbol_distribution: Record<string, number>;
  trade_count: number;
}

export async function fetchStats(): Promise<StatsOverview> {
  return apiFetch<StatsOverview>('/api/stats/overview');
}
