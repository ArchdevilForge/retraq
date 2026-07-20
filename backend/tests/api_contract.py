"""Field sets shared with frontend types (frontend/src/services/api.ts)."""

TRADE_FIELDS = frozenset(
    {
        "id",
        "symbol",
        "direction",
        "leverage",
        "entry_price",
        "exit_price",
        "profit",
        "profit_rate",
        "margin",
        "entry_time",
        "exit_time",
    }
)

TRADE_FILL_FIELDS = frozenset(
    {
        "id",
        "side",
        "price",
        "qty",
        "time_ms",
        "realized_pnl",
    }
)

DATASET_FIELDS = frozenset({"id", "name", "created_at"})

STATS_OVERVIEW_FIELDS = frozenset(
    {
        "total_pnl",
        "win_rate",  # percent 0–100, not 0–1 ratio
        "profit_factor",
        "max_drawdown",
        "avg_holding_time",  # hours
        "symbol_distribution",
        "trade_count",
    }
)

SYMBOL_STATS_FIELDS = frozenset({"trade_count", "symbol_distribution"})

KLINE_FIELDS = frozenset({"timestamp", "open", "high", "low", "close", "volume"})

# Core keys always present after /api/trades/import succeeds.
IMPORT_RESULT_FIELDS = frozenset(
    {"total", "success", "failed", "template", "dataset_id", "dataset_name", "replaced"}
)
# Present for fill-based templates (e.g. Binance trade history).
IMPORT_RESULT_OPTIONAL_FIELDS = frozenset({"fills", "closed_positions"})

TIMEFRAMES = ("5m", "15m", "1h", "4h", "1d")
