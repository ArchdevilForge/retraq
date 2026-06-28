# State Management

> How state is managed in this project.

---

## Overview

- **Active dataset**: `DatasetContext` (`frontend/src/context/DatasetContext.tsx`) + `localStorage` key `retraq.activeDatasetId` (`constants/datasetStorage.ts`).
- Trade/stats API calls send header **`X-Dataset-Id`** via axios interceptor in `services/api.ts`.
- **`tradesRevision`**: bump after import (`notifyTradesChanged`) so `TradeList` refetches without full page reload.
- **No ProfileContext** — one imported file = one `datasets` row; switch in top-bar `DatasetPicker`.

---

## Dataset lifecycle

| Action | Behavior |
|--------|----------|
| Import | `POST /api/trades/import?template=auto` → `detect_template()` on backend → create/replace dataset by filename label |
| Switch | `setActiveDatasetId` persists to localStorage; dependent hooks refetch |
| Empty | `activeDatasetId == null` → trade endpoints skip header until user imports |

---

## Server state

- Pages fetch trades with `fetchTrades()`; pass `{ limit, maxPages }` for analysis aggregates.
- Klines and fills are **local component state** in `ChartManagerInner` (not global).

---

## UI feedback

- Use **`ToastProvider` + `useToast()`** (DaisyUI `toast` + `alert`) — never `alert()` for import/errors.

---

## Common mistakes

| Wrong | Correct |
|-------|---------|
| Hardcode `binance_futures_trades` on import | `template=auto` for mixed langge/binance files |
| Show dataset name in trade list header | Switch dataset only in top-bar picker |
| `ProfileContext` / manual profile CRUD | `DatasetContext` + import only |