/** localStorage key for active dataset id (also used by DatasetContext). */
export const ACTIVE_DATASET_STORAGE_KEY = 'retraq.activeDatasetId';

type ApiFetchInit = RequestInit & {
  params?: Record<string, string | number | boolean | undefined | null>;
  /** Skip dataset header even on dataset-scoped paths. */
  skipDataset?: boolean;
  /** Pin the dataset header instead of re-reading localStorage (paged loops must not drift). */
  datasetId?: string | null;
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
  const { params, skipDataset, datasetId, headers: initHeaders, ...rest } = init;
  const headers = new Headers(initHeaders);
  if (!skipDataset && needsDatasetHeader(path)) {
    const id = datasetId !== undefined ? datasetId : localStorage.getItem(ACTIVE_DATASET_STORAGE_KEY);
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
  /** Nullable column; the 1.0 default only applies on insert. */
  leverage: number | null;
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
  /** Trade subject: self | master:{trader_id} | sim */
  owner: string;
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

/** Paged loader; `total` is the server-side row count, which may exceed `trades.length`. */
export async function fetchTradesWithTotal(
  filters?: { symbol?: string; start_date?: number; end_date?: number },
  options?: { limit?: number; maxPages?: number; page?: number },
): Promise<{ trades: Trade[]; total: number }> {
  const limit = options?.limit ?? 2000;
  const maxPages = options?.maxPages ?? 20;
  const startPage = options?.page ?? 1;
  // Pin the dataset once so a mid-flight switch cannot merge two datasets into one array.
  const datasetId = localStorage.getItem(ACTIVE_DATASET_STORAGE_KEY);

  const allTrades: Trade[] = [];
  let total = 0;
  for (let page = startPage; page < startPage + maxPages; page += 1) {
    const data = await apiFetch<TradesResponse>('/api/trades', {
      params: { ...filters, page, limit },
      datasetId,
    });
    allTrades.push(...data.data);
    total = data.total;
    if (allTrades.length >= data.total || data.data.length === 0) break;
  }

  return { trades: allTrades, total };
}

export async function fetchTrades(
  filters?: { symbol?: string; start_date?: number; end_date?: number },
  options?: { limit?: number; maxPages?: number; page?: number },
): Promise<Trade[]> {
  const { trades } = await fetchTradesWithTotal(filters, options);
  return trades;
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
  /** Null when there are no losing trades (the factor is undefined). */
  profit_factor: number | null;
  max_drawdown: number;
  /** Hours. */
  avg_holding_time: number;
  symbol_distribution: Record<string, number>;
  trade_count: number;
}

export async function fetchStats(): Promise<StatsOverview> {
  return apiFetch<StatsOverview>('/api/stats/overview');
}

// --- Master Traders API ---

export interface MasterTrader {
  id: string;
  nickname: string;
  market: string;
  avatar_url: string | null;
  roi: number | null;
  pnl: number | null;
  mdd: number | null;
  win_rate: number | null;
  sharp_ratio: number | null;
  aum: number | null;
  trading_days: number | null;
  current_copy_count: number | null;
  max_copy_count: number | null;
  badge: string | null;
  tags: string[];
  equity_chart: Array<{ time: number; value: number }>;
  equity_chart_30d?: Array<{ time: number; value: number }>;
  equity_chart_90d?: Array<{ time: number; value: number }>;
  detail_url: string | null;
  has_positions: boolean;
  position_count: number;
}

export interface MasterPosition {
  id: number;
  position_id: string | null;
  trader_id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  margin_mode: string | null;
  leverage: number;
  entry_price: number;
  close_price: number | null;
  pnl: number | null;
  roi: number | null;
  opened_at: number;
  closed_at: number | null;
  max_amount: number | null;
  closed_amount: number | null;
  status: string | null;
}

export interface MasterOverlayAction {
  id: number;
  position_id: string | null;
  trader_id: string;
  trader_nickname: string;
  trader_avatar: string | null;
  symbol: string;
  side: 'LONG' | 'SHORT';
  leverage: number;
  margin_mode: string | null;
  entry_price: number;
  close_price: number | null;
  pnl: number | null;
  roi: number | null;
  opened_at: number;
  closed_at: number | null;
}

export interface MasterQuote {
  id: string;
  author: string;
  title: string;
  tags: string[];
  summary: string;
  quotes: string[];
}

export interface MasterListResponse {
  total: number;
  page: number;
  limit: number;
  data: MasterTrader[];
}

export interface MasterPositionsResponse {
  total: number;
  page: number;
  limit: number;
  data: MasterPosition[];
}

export async function fetchMasterTraders(params?: {
  search?: string;
  has_positions_only?: boolean;
  sort_by?: string;
  sort_order?: string;
  page?: number;
  limit?: number;
}): Promise<MasterListResponse> {
  return apiFetch<MasterListResponse>('/api/masters', {
    params: {
      search: params?.search,
      has_positions_only: params?.has_positions_only !== false,
      sort_by: params?.sort_by ?? 'roi',
      sort_order: params?.sort_order ?? 'desc',
      page: params?.page ?? 1,
      limit: params?.limit ?? 30,
    },
    skipDataset: true,
  });
}

export async function fetchMasterTrader(traderId: string): Promise<MasterTrader> {
  return apiFetch<MasterTrader>(`/api/masters/${traderId}`, { skipDataset: true });
}

export async function fetchMasterPositions(
  traderId: string,
  params?: {
    symbol?: string;
    side?: string;
    start_date?: number;
    end_date?: number;
    sort_by?: string;
    sort_order?: string;
    page?: number;
    limit?: number;
  },
): Promise<MasterPositionsResponse> {
  return apiFetch<MasterPositionsResponse>(`/api/masters/${traderId}/positions`, {
    params: {
      symbol: params?.symbol,
      side: params?.side,
      start_date: params?.start_date,
      end_date: params?.end_date,
      sort_by: params?.sort_by ?? 'opened_at',
      sort_order: params?.sort_order ?? 'desc',
      page: params?.page ?? 1,
      limit: params?.limit ?? 50,
    },
    skipDataset: true,
  });
}

export async function syncMasterTrader(traderId: string): Promise<{
  success: boolean;
  trader_id: string;
  new_count: number;
  total_positions: number;
  nickname: string;
}> {
  return apiFetch<{
    success: boolean;
    trader_id: string;
    new_count: number;
    total_positions: number;
    nickname: string;
  }>(`/api/masters/${traderId}/sync`, {
    method: 'POST',
    skipDataset: true,
  });
}

export async function fetchMasterOverlay(
  symbol: string,
  start_ts: number,
  end_ts: number,
  limit: number = 300,
): Promise<{ symbol: string; data: MasterOverlayAction[] }> {
  return apiFetch<{ symbol: string; data: MasterOverlayAction[] }>('/api/masters/overlay', {
    params: { symbol, start_ts, end_ts, limit },
    skipDataset: true,
  });
}

export async function fetchMasterQuotes(): Promise<MasterQuote[]> {
  const res = await apiFetch<{ data: MasterQuote[] }>('/api/masters/quotes', { skipDataset: true });
  return res.data;
}

/* ---- Annotations & drawings (docs/DESIGN.md §6) ---- */

export type AnnotationSubjectType = 'trade' | 'master_position';

export interface TradeAnnotation {
  subject_type: AnnotationSubjectType;
  subject_id: number;
  note: string | null;
  setup_tags: string[];
  error_tags: string[];
  grade: string | null;
  emotion: string | null;
  planned_stop: number | null;
  planned_target: number | null;
  updated_at: string | null;
}

export interface AnnotationPresets {
  setup_tags: string[];
  error_tags: string[];
  emotions: string[];
  grades: string[];
}

export async function fetchAnnotationPresets(): Promise<AnnotationPresets> {
  return apiFetch<AnnotationPresets>('/api/annotations/presets', { skipDataset: true });
}

export async function fetchAnnotation(
  subjectType: AnnotationSubjectType,
  subjectId: number,
): Promise<TradeAnnotation> {
  return apiFetch<TradeAnnotation>(`/api/annotations/${subjectType}/${subjectId}`, {
    skipDataset: true,
  });
}

export async function upsertAnnotation(
  subjectType: AnnotationSubjectType,
  subjectId: number,
  body: Omit<TradeAnnotation, 'subject_type' | 'subject_id' | 'updated_at'>,
): Promise<TradeAnnotation> {
  return apiFetch<TradeAnnotation>(`/api/annotations/${subjectType}/${subjectId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    skipDataset: true,
  });
}

export type DrawingKind = 'hline' | 'trend' | 'region' | 'fib';

export interface DrawingPoint {
  time_ms: number;
  price: number;
}

export interface ChartDrawing {
  id: number;
  symbol: string;
  kind: DrawingKind;
  payload: DrawingPoint[];
  created_at: string | null;
}

export async function fetchDrawings(symbol: string): Promise<ChartDrawing[]> {
  const res = await apiFetch<{ symbol: string; data: ChartDrawing[] }>('/api/drawings', {
    params: { symbol },
    skipDataset: true,
  });
  return res.data;
}

export async function createDrawing(
  symbol: string,
  kind: DrawingKind,
  payload: DrawingPoint[],
): Promise<ChartDrawing> {
  return apiFetch<ChartDrawing>('/api/drawings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, kind, payload }),
    skipDataset: true,
  });
}

export async function deleteDrawing(id: number): Promise<void> {
  await apiFetch<void>(`/api/drawings/${id}`, { method: 'DELETE', skipDataset: true });
}

/* ---- Binance auto sync (docs/PRODUCT.md §四) ---- */

export interface BinanceSyncStatus {
  configured: boolean;
  dataset_id: number | null;
  trade_count: number;
}

export interface BinanceSyncResult {
  success: boolean;
  dataset_id: number;
  dataset_name: string;
  new_fills: number;
  trade_count: number;
}

export async function fetchBinanceSyncStatus(): Promise<BinanceSyncStatus> {
  return apiFetch<BinanceSyncStatus>('/api/binance/sync/status', { skipDataset: true });
}

export async function runBinanceSync(): Promise<BinanceSyncResult> {
  return apiFetch<BinanceSyncResult>('/api/binance/sync', { method: 'POST', skipDataset: true });
}

/* ---- Cross-dataset analysis + review cadence (docs/PRODUCT.md §三/§七) ---- */

export interface SetupStat {
  tag: string;
  trade_count: number;
  win_rate: number | null;
  total_profit: number;
}

export interface ErrorStat {
  tag: string;
  trade_count: number;
  total_profit: number;
}

export interface RDistribution {
  buckets: { bucket: string; count: number }[];
  without_stop: number;
  avg_r: number | null;
}

export interface DisciplineStat {
  annotated: number;
  clean: number;
  with_error: number;
  unannotated: number;
}

export type OwnerGroup<T> = { self: T; sim: T };

export async function fetchSetupStats(includeSim: boolean): Promise<OwnerGroup<SetupStat[]>> {
  return apiFetch<OwnerGroup<SetupStat[]>>('/api/analysis/by-setup', {
    params: { include_sim: includeSim },
    skipDataset: true,
  });
}

export async function fetchErrorStats(includeSim: boolean): Promise<OwnerGroup<ErrorStat[]>> {
  return apiFetch<OwnerGroup<ErrorStat[]>>('/api/analysis/by-error', {
    params: { include_sim: includeSim },
    skipDataset: true,
  });
}

export async function fetchRDistribution(includeSim: boolean): Promise<OwnerGroup<RDistribution>> {
  return apiFetch<OwnerGroup<RDistribution>>('/api/analysis/r-distribution', {
    params: { include_sim: includeSim },
    skipDataset: true,
  });
}

export async function fetchDiscipline(includeSim: boolean): Promise<OwnerGroup<DisciplineStat>> {
  return apiFetch<OwnerGroup<DisciplineStat>>('/api/analysis/discipline', {
    params: { include_sim: includeSim },
    skipDataset: true,
  });
}

export interface ReviewChecklist {
  cadence: 'daily' | 'weekly' | 'monthly';
  label: string;
  questions: string[];
}

export interface ReviewNote {
  id: number;
  cadence: 'daily' | 'weekly' | 'monthly';
  period_key: string;
  content: string;
  updated_at: string | null;
}

export async function fetchReviewChecklists(): Promise<ReviewChecklist[]> {
  const res = await apiFetch<{ data: ReviewChecklist[] }>('/api/analysis/checklists', {
    skipDataset: true,
  });
  return res.data;
}

export async function fetchReviews(cadence?: string): Promise<ReviewNote[]> {
  const res = await apiFetch<{ data: ReviewNote[] }>('/api/reviews', {
    params: { cadence },
    skipDataset: true,
  });
  return res.data;
}

export async function upsertReview(
  cadence: ReviewNote['cadence'],
  periodKey: string,
  content: string,
): Promise<ReviewNote> {
  return apiFetch<ReviewNote>('/api/reviews', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cadence, period_key: periodKey, content }),
    skipDataset: true,
  });
}

/* ---- Training session persistence (docs/PRODUCT.md §六) ---- */

export interface TrainingCycleInput {
  symbol: string;
  direction: 'long' | 'short';
  leverage: number;
  entry_price: number;
  exit_price: number;
  profit: number;
  margin: number;
  entry_time: number;
  exit_time: number;
}

export interface TrainingSaveResult {
  success: boolean;
  dataset_id: number;
  dataset_name: string;
  trade_count: number;
  realized_pnl: number;
  fees: number;
}

export async function saveTrainingSession(input: {
  symbol: string;
  timeframe: string;
  start_equity: number;
  realized_pnl: number;
  fees: number;
  trades: TrainingCycleInput[];
}): Promise<TrainingSaveResult> {
  return apiFetch<TrainingSaveResult>('/api/train/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    skipDataset: true,
  });
}
