# Database Guidelines

> ORM patterns, queries, migrations in Retraq.

---

## Models (SQLite)

- **`datasets`**: `name` unique; trades/fills CASCADE on delete.
- **`trades`**: Scoped by `dataset_id`; langge/binance position rows.
- **`trade_fills`**: Per-fill from Binance trade history; `trade_id` nullable until linked to aggregated position.

---

## Import templates

`trade_importer.detect_template(path)`:

| Template id | Detection |
|-------------|-----------|
| `langge` | Header row 0, column `交易对` |
| `binance_futures_trades` | Header row 9, trade history columns |
| `binance_futures` | Header row 9, position history columns |

Import API: `template=auto` resolves template after temp file write.

---

## Migrations

- Run `backend/migrate.py` on deploy; multi-dataset migration from legacy single-db.

---

## API scope

- `dataset_scope` / `X-Dataset-Id` required for trade and stats routes; reject or default consistently in `main.py`.