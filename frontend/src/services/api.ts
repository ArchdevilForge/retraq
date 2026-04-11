import axios from 'axios';
import { adaptImportReportPayload } from './importReportAdapter';
import type { ImportReport } from './importTypes';

export interface Kline {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Trade {
  id: number;
  symbol: string;
  direction: string;
  leverage: number;
  entry_price: number;
  exit_price: number | null;
  profit: number | null;
  profit_rate: number | null;
  margin: number | null;
  entry_time: number;
  exit_time: number | null;
}

export type Timeframe = '5m' | '15m' | '1h' | '4h' | '1d';

export interface TradesResponse {
  total: number;
  page: number;
  limit: number;
  data: Trade[];
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
      const { data } = await axios.get(url, requestConfig);
      // Backend returns {symbol, timeframe, data: [{timestamp, open, high, low, close, volume}]}
      // Convert: timestamp (ms) -> time (seconds) for lightweight-charts
      return data.data.map((k: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }) => ({
        time: Math.floor(k.timestamp / 1000),  // Convert ms to seconds
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
  // Backend returns {symbol, timeframe, data: [{timestamp, open, high, low, close, volume}]}
  // Convert: timestamp (ms) -> time (seconds) for lightweight-charts
}

export async function fetchTrades(
  filters?: { symbol?: string; start_date?: number; end_date?: number },
  options?: { limit?: number; maxPages?: number },
): Promise<Trade[]> {
  const limit = options?.limit ?? 500;
  const maxPages = options?.maxPages ?? 1000;

  const allTrades: Trade[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const { data } = await axios.get<TradesResponse>('/api/trades', { params: { ...filters, page, limit } });
    allTrades.push(...data.data);
    if (allTrades.length >= data.total || data.data.length === 0) break;
  }

  return allTrades;
}

export async function importTrades(file: File): Promise<ImportReport> {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await axios.post('/api/trades/import', formData);
  return adaptImportReportPayload(data);
}

export interface ManualImportRowInput {
  symbol: string;
  direction: 'long' | 'short';
  entry_price: string;
  entry_time: string;
}

export async function importTradeRows(rows: ManualImportRowInput[]): Promise<ImportReport> {
  const { data } = await axios.post('/api/trades/import/rows', {
    source_filename: 'manual-entry',
    rows,
  });
  return adaptImportReportPayload(data);
}

export interface RestoreSQLiteBackupResponse {
  status: 'restored';
}

export async function restoreSQLiteBackup(file: File): Promise<RestoreSQLiteBackupResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await axios.post<RestoreSQLiteBackupResponse>('/api/backups/restore', formData);
  return data;
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
