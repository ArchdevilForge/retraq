import axios from 'axios';
import { ACTIVE_DATASET_STORAGE_KEY } from '../constants/datasetStorage';

axios.interceptors.request.use((config) => {
  const url = config.url ?? '';
  const path = url.split('?')[0];
  const needsDataset =
    path.startsWith('/api/stats/') ||
    (path.startsWith('/api/trades') && !path.startsWith('/api/trades/import'));
  if (needsDataset) {
    const id = localStorage.getItem(ACTIVE_DATASET_STORAGE_KEY);
    if (id) {
      config.headers = config.headers ?? {};
      config.headers['X-Dataset-Id'] = id;
    }
  }
  return config;
});

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
  const { data } = await axios.get<{ data: TradeFill[] }>(`/api/trades/${tradeId}/fills`);
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
  const { data } = await axios.get<{ data: Dataset[] }>('/api/datasets');
  return data;
}

export async function updateDataset(id: number, name: string): Promise<Dataset> {
  const { data } = await axios.patch<Dataset>(`/api/datasets/${id}`, { name });
  return data;
}

export async function deleteDataset(id: number): Promise<void> {
  await axios.delete(`/api/datasets/${id}`);
}

export async function fetchImportTemplates(): Promise<{ id: string; label: string }[]> {
  const { data } = await axios.get<{ templates: { id: string; label: string }[] }>(
    '/api/import/templates',
  );
  return data.templates;
}

export async function fetchKlines(
  symbol: string,
  timeframe: Timeframe,
  options?: { start?: number; end?: number; limit?: number },
): Promise<Kline[]> {
  const url = `/api/klines/${symbol}/${timeframe}`;
  const requestConfig = {
    params: { ...options, nocache: 1, _cb: Date.now() },
    headers: { 'Cache-Control': 'no-cache' },
  } as const;

  const maxAttempts = 4;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { data } = await axios.get<{ data: KlineApiRow[] }>(url, requestConfig);
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
      const axiosError = err as { response?: { status?: number } };
      const status = axiosError?.response?.status;
      const shouldRetry = status == null || status === 502 || status === 503 || status === 504;
      if (!shouldRetry || attempt === maxAttempts) break;
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
  const { data } = await axios.get<SymbolStats>('/api/stats/symbols');
  return data;
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
    const { data } = await axios.get<TradesResponse>('/api/trades', { params: { ...filters, page, limit } });
    allTrades.push(...data.data);
    if (allTrades.length >= data.total || data.data.length === 0) break;
  }

  return allTrades;
}

function importErrorMessage(err: unknown): string {
  const ax = err as { response?: { status?: number; data?: { detail?: string } } };
  const detail = ax.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  return '导入失败，请检查文件与模板';
}

export type ImportResult = {
  total: number;
  success: number;
  failed: number;
  template?: string;
  dataset_id?: number;
  dataset_name?: string;
  replaced?: boolean;
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
    const { data } = await axios.post<ImportResult>('/api/trades/import', formData, {
      params: {
        template,
        replace: options?.replace !== false,
        label,
      },
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  } catch (err) {
    throw new Error(importErrorMessage(err));
  }
}

export interface StatsOverview {
  total_pnl: number;
  win_rate: number;
  profit_factor: number;
  max_drawdown: number;
  avg_holding_time: number;
  symbol_distribution: Record<string, number>;
  trade_count: number;
}

export async function fetchStats(): Promise<StatsOverview> {
  const { data } = await axios.get('/api/stats/overview');
  return data;
}