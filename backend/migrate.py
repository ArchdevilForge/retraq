"""DB bootstrap + profiles → datasets one-time migration. No auto seed."""
from sqlalchemy import bindparam, inspect, text

from database import engine, Base
from models import Dataset, Trade, MasterTrader, MasterPosition  # noqa: F401 — register models

LEGACY_DATASET_NAMES = ("默认", "浪哥（示例）")

# Bumped when a one-shot repair is added; tracked in SQLite's PRAGMA user_version.
SCHEMA_VERSION = 1

TRADES_TABLE_SQL = """
CREATE TABLE trades_new (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    symbol VARCHAR(32) NOT NULL,
    direction VARCHAR(8) NOT NULL,
    leverage FLOAT,
    entry_price FLOAT NOT NULL,
    exit_price FLOAT,
    profit FLOAT,
    profit_rate FLOAT,
    entry_time BIGINT NOT NULL,
    exit_time BIGINT,
    margin FLOAT
)
"""

TRADES_INDEX_SQL = (
    "CREATE INDEX IF NOT EXISTS ix_trades_dataset_id ON trades (dataset_id)",
    "CREATE INDEX IF NOT EXISTS ix_trade_symbol ON trades (symbol)",
    "CREATE INDEX IF NOT EXISTS ix_trade_dataset_entry ON trades (dataset_id, entry_time)",
)


def _table_exists(name: str) -> bool:
    return name in inspect(engine).get_table_names()


def _column_exists(table: str, col: str) -> bool:
    if not _table_exists(table):
        return False
    return col in {c["name"] for c in inspect(engine).get_columns(table)}


def _read_user_version() -> int:
    if engine.dialect.name != "sqlite":
        return SCHEMA_VERSION
    with engine.connect() as conn:
        return int(conn.execute(text("PRAGMA user_version")).scalar() or 0)


def _set_user_version(version: int) -> None:
    if engine.dialect.name != "sqlite":
        return
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(text(f"PRAGMA user_version = {int(version)}"))


def _rebuild_trades_without_profile_id() -> None:
    """SQLite cannot drop the legacy NOT NULL profile_id column, so rebuild the table."""
    kept = [
        c
        for c in (
            "id",
            "dataset_id",
            "symbol",
            "direction",
            "leverage",
            "entry_price",
            "exit_price",
            "profit",
            "profit_rate",
            "entry_time",
            "exit_time",
            "margin",
        )
        if _column_exists("trades", c)
    ]
    cols = ", ".join(kept)
    # FK enforcement must be off while the old table is dropped and the new one renamed.
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(text("PRAGMA foreign_keys=OFF"))
        try:
            conn.execute(text("DROP TABLE IF EXISTS trades_new"))
            conn.execute(text(TRADES_TABLE_SQL))
            conn.execute(
                text(f"INSERT INTO trades_new ({cols}) SELECT {cols} FROM trades WHERE dataset_id IS NOT NULL")
            )
            conn.execute(text("DROP TABLE trades"))
            conn.execute(text("ALTER TABLE trades_new RENAME TO trades"))
            for stmt in TRADES_INDEX_SQL:
                conn.execute(text(stmt))
        finally:
            conn.execute(text("PRAGMA foreign_keys=ON"))


def _migrate_legacy_profiles() -> None:
    if _table_exists("profiles"):
        with engine.begin() as conn:
            if not _table_exists("datasets"):
                conn.execute(
                    text(
                        """
                        CREATE TABLE datasets (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            name VARCHAR(128) NOT NULL UNIQUE,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                        )
                        """
                    )
                )
            conn.execute(
                text(
                    """
                    INSERT OR IGNORE INTO datasets (id, name, created_at)
                    SELECT id, name, COALESCE(created_at, CURRENT_TIMESTAMP) FROM profiles
                    """
                )
            )
            conn.execute(text("DROP TABLE IF EXISTS profiles"))

    # The profiles table may already be gone while trades still carries NOT NULL profile_id.
    if not _column_exists("trades", "profile_id"):
        return
    with engine.begin() as conn:
        if not _column_exists("trades", "dataset_id"):
            conn.execute(text("ALTER TABLE trades ADD COLUMN dataset_id INTEGER"))
        conn.execute(text("UPDATE trades SET dataset_id = profile_id WHERE dataset_id IS NULL"))
    _rebuild_trades_without_profile_id()


def _purge_legacy_default_datasets() -> None:
    if not _table_exists("datasets"):
        return
    from database import SessionLocal

    db = SessionLocal()
    try:
        for name in LEGACY_DATASET_NAMES:
            row = db.query(Dataset).filter(Dataset.name == name).first()
            if not row:
                continue
            # Only drop an untouched leftover: a user who owns a dataset by this
            # name keeps it, data and all.
            if db.query(Trade).filter(Trade.dataset_id == row.id).count():
                continue
            db.delete(row)
        db.commit()
    finally:
        db.close()


def _delete_orphan_rows() -> None:
    """Rows left by dataset deletes made while FK enforcement was off; a reused id re-attaches them."""
    if not _table_exists("datasets"):
        return
    for table in ("trade_fills", "trades"):
        if not _table_exists(table):
            continue
        with engine.begin() as conn:
            conn.execute(text(f"DELETE FROM {table} WHERE dataset_id NOT IN (SELECT id FROM datasets)"))


def _normalize_legacy_fill_sides() -> None:
    """Older imports stored the export's raw token; TradeFill.side is now BUY | SELL."""
    if not _table_exists("trade_fills"):
        return
    buy = ("买入", "买", "开多", "平空", "LONG", "buy", "Buy", "long")
    sell = ("卖出", "卖", "开空", "平多", "SHORT", "sell", "Sell", "short")
    with engine.begin() as conn:
        for target, tokens in (("BUY", buy), ("SELL", sell)):
            conn.execute(
                text(f"UPDATE trade_fills SET side = '{target}' WHERE side IN :tokens").bindparams(
                    bindparam("tokens", expanding=True)
                ),
                {"tokens": list(tokens)},
            )


def _reset_kline_cache() -> None:
    """klines is a pure network cache; drop pre-swap SPOT candles, they refetch on demand."""
    if not _table_exists("klines"):
        return
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM klines"))


def _add_dataset_owner_column() -> None:
    """Datasets gained an owner discriminator (self | master:* | sim); legacy rows are self."""
    if not _table_exists("datasets"):
        return
    if _column_exists("datasets", "owner"):
        return
    with engine.begin() as conn:
        conn.execute(
            text("ALTER TABLE datasets ADD COLUMN owner VARCHAR(64) NOT NULL DEFAULT 'self'")
        )


def ensure_database() -> None:
    Base.metadata.create_all(bind=engine)
    _migrate_legacy_profiles()
    _add_dataset_owner_column()
    if _read_user_version() < SCHEMA_VERSION:
        # One-shot repairs; never repeated, so a user dataset named 默认 survives later boots.
        _purge_legacy_default_datasets()
        _delete_orphan_rows()
        _normalize_legacy_fill_sides()
        _reset_kline_cache()
        _set_user_version(SCHEMA_VERSION)
