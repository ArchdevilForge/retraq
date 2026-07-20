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
        "win_rate",
        "profit_factor",
        "max_drawdown",
        "avg_holding_time",
        "symbol_distribution",
        "trade_count",
    }
)

SYMBOL_STATS_FIELDS = frozenset({"trade_count", "symbol_distribution"})

KLINE_FIELDS = frozenset({"timestamp", "open", "high", "low", "close", "volume"})

IMPORT_RESULT_FIELDS = frozenset(
    {"total", "success", "failed", "template", "dataset_id", "dataset_name", "replaced"}
)

TIMEFRAMES = ("5m", "15m", "1h", "4h", "1d")
