-- Phase 1 import reliability bootstrap + additive upgrade script.
-- Version: 001

CREATE TABLE IF NOT EXISTS klines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_kline_symbol_tf_ts
ON klines(symbol, timeframe, timestamp);

CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    leverage REAL DEFAULT 1.0,
    entry_price REAL NOT NULL,
    exit_price REAL,
    profit REAL,
    profit_rate REAL,
    entry_time INTEGER NOT NULL,
    exit_time INTEGER,
    margin REAL
);

CREATE INDEX IF NOT EXISTS ix_trade_symbol
ON trades(symbol);

CREATE TABLE IF NOT EXISTS import_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_filename TEXT NOT NULL,
    status TEXT NOT NULL,
    total_rows INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    conflict_count INTEGER NOT NULL DEFAULT 0,
    timestamp_normalization_count INTEGER NOT NULL DEFAULT 0,
    file_rejection_reason TEXT,
    file_rejection_message TEXT,
    download_filename TEXT,
    download_mime_type TEXT NOT NULL DEFAULT 'text/csv',
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_import_sessions_status
ON import_sessions(status);

CREATE TABLE IF NOT EXISTS import_report_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    row_number INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    field TEXT NOT NULL,
    raw_value TEXT,
    normalized_value TEXT,
    reason TEXT NOT NULL,
    business_key TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES import_sessions(id)
);

CREATE INDEX IF NOT EXISTS ix_import_report_rows_session_id
ON import_report_rows(session_id);

CREATE INDEX IF NOT EXISTS ix_import_report_rows_session_outcome
ON import_report_rows(session_id, outcome);

CREATE INDEX IF NOT EXISTS ix_import_report_rows_business_key
ON import_report_rows(business_key);
