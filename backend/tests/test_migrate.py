"""migrate.py runs at import time against the user's real DB and its repairs are destructive."""
import os
import sqlite3
import subprocess
import sys

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _boot(db_path) -> None:
    """Run ensure_database() the way main.py does — in a fresh process, so the module
    level engine/Base really are built against this DB."""
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{db_path}"}
    proc = subprocess.run(
        [sys.executable, "-c", "from migrate import ensure_database; ensure_database()"],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr


@pytest.fixture()
def migrated(tmp_path):
    """Boot against a throwaway DB and hand back a raw connection to inspect it."""
    db_path = tmp_path / "m.db"

    def run(setup_sql: str = "") -> sqlite3.Connection:
        if setup_sql:
            raw = sqlite3.connect(db_path)
            raw.executescript(setup_sql)
            raw.commit()
            raw.close()
        _boot(db_path)
        return sqlite3.connect(db_path)

    run.db_path = db_path  # type: ignore[attr-defined]
    run.boot = lambda: _boot(db_path)  # type: ignore[attr-defined]
    return run


LEGACY_PROFILES = """
CREATE TABLE profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(128) NOT NULL UNIQUE, created_at DATETIME);
CREATE TABLE trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id INTEGER NOT NULL,
  symbol VARCHAR(32) NOT NULL, direction VARCHAR(8) NOT NULL, leverage FLOAT,
  entry_price FLOAT NOT NULL, exit_price FLOAT, profit FLOAT, profit_rate FLOAT,
  entry_time BIGINT NOT NULL, exit_time BIGINT, margin FLOAT);
INSERT INTO profiles (id, name) VALUES (1, '我的老数据');
INSERT INTO trades (profile_id, symbol, direction, leverage, entry_price, entry_time)
  VALUES (1, 'BTC-USDT', 'long', 10, 100, 1000), (1, 'ETH-USDT', 'short', 5, 200, 2000);
"""


def _columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]


def test_legacy_profiles_become_datasets_and_rows_survive(migrated):
    conn = migrated(LEGACY_PROFILES)
    assert "profile_id" not in _columns(conn, "trades"), "NOT NULL profile_id breaks every later insert"
    assert conn.execute("SELECT name FROM datasets").fetchall() == [("我的老数据",)]
    rows = conn.execute("SELECT dataset_id, symbol, leverage FROM trades ORDER BY id").fetchall()
    assert rows == [(1, "BTC-USDT", 10.0), (1, "ETH-USDT", 5.0)]
    assert not conn.execute("SELECT name FROM sqlite_master WHERE name='profiles'").fetchall()


def test_migration_is_idempotent(migrated):
    conn = migrated(LEGACY_PROFILES)
    conn.close()
    for _ in range(2):
        migrated.boot()
    conn = sqlite3.connect(migrated.db_path)
    assert conn.execute("SELECT COUNT(*) FROM trades").fetchone()[0] == 2
    assert conn.execute("SELECT COUNT(*) FROM datasets").fetchone()[0] == 1
    assert "profile_id" not in _columns(conn, "trades")


def test_profile_id_repaired_even_when_profiles_table_is_gone(migrated):
    """The upgrade path that previously left a NOT NULL profile_id behind."""
    conn = migrated(
        """
        CREATE TABLE datasets (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(128) NOT NULL UNIQUE, created_at DATETIME);
        CREATE TABLE trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id INTEGER NOT NULL, dataset_id INTEGER,
          symbol VARCHAR(32) NOT NULL, direction VARCHAR(8) NOT NULL, leverage FLOAT,
          entry_price FLOAT NOT NULL, exit_price FLOAT, profit FLOAT, profit_rate FLOAT,
          entry_time BIGINT NOT NULL, exit_time BIGINT, margin FLOAT);
        INSERT INTO datasets (id, name) VALUES (1, '我的');
        INSERT INTO trades (profile_id, dataset_id, symbol, direction, entry_price, entry_time)
          VALUES (1, 1, 'BTC-USDT', 'long', 100, 1);
        """
    )
    assert "profile_id" not in _columns(conn, "trades")
    assert conn.execute("SELECT COUNT(*) FROM trades").fetchone()[0] == 1


def test_legacy_named_dataset_with_trades_is_never_deleted(migrated):
    """默认 was a seed name; a user who owns that name must keep their data."""
    conn = migrated(
        """
        CREATE TABLE datasets (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(128) NOT NULL UNIQUE, created_at DATETIME);
        CREATE TABLE trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT, dataset_id INTEGER NOT NULL,
          symbol VARCHAR(32) NOT NULL, direction VARCHAR(8) NOT NULL, leverage FLOAT,
          entry_price FLOAT NOT NULL, exit_price FLOAT, profit FLOAT, profit_rate FLOAT,
          entry_time BIGINT NOT NULL, exit_time BIGINT, margin FLOAT);
        INSERT INTO datasets (id, name) VALUES (1, '默认'), (2, '空的默认副本');
        INSERT INTO trades (dataset_id, symbol, direction, entry_price, entry_time)
          VALUES (1, 'BTC-USDT', 'long', 100, 1);
        """
    )
    assert conn.execute("SELECT name FROM datasets WHERE id=1").fetchone() == ("默认",)
    assert conn.execute("SELECT COUNT(*) FROM trades").fetchone()[0] == 1


def test_empty_legacy_seed_dataset_is_still_cleaned_up(migrated):
    conn = migrated(
        """
        CREATE TABLE datasets (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(128) NOT NULL UNIQUE, created_at DATETIME);
        INSERT INTO datasets (id, name) VALUES (1, '默认'), (2, '我的');
        """
    )
    assert [r[0] for r in conn.execute("SELECT name FROM datasets ORDER BY id")] == ["我的"]


def test_orphans_and_legacy_fill_sides_are_repaired_once(migrated):
    conn = migrated(
        """
        CREATE TABLE datasets (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(128) NOT NULL UNIQUE, created_at DATETIME);
        CREATE TABLE trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT, dataset_id INTEGER NOT NULL,
          symbol VARCHAR(32) NOT NULL, direction VARCHAR(8) NOT NULL, leverage FLOAT,
          entry_price FLOAT NOT NULL, exit_price FLOAT, profit FLOAT, profit_rate FLOAT,
          entry_time BIGINT NOT NULL, exit_time BIGINT, margin FLOAT);
        CREATE TABLE trade_fills (
          id INTEGER PRIMARY KEY AUTOINCREMENT, dataset_id INTEGER NOT NULL, trade_id INTEGER,
          symbol VARCHAR(32) NOT NULL, side VARCHAR(8) NOT NULL, price FLOAT NOT NULL,
          qty FLOAT NOT NULL, time_ms BIGINT NOT NULL, realized_pnl FLOAT, order_id VARCHAR(64));
        INSERT INTO datasets (id, name) VALUES (1, '我的');
        INSERT INTO trades (dataset_id, symbol, direction, entry_price, entry_time)
          VALUES (1, 'BTC-USDT', 'long', 100, 1), (99, 'ORPHAN-USDT', 'long', 1, 1);
        INSERT INTO trade_fills (dataset_id, symbol, side, price, qty, time_ms)
          VALUES (1, 'BTC-USDT', '买入', 100, 1, 1), (1, 'BTC-USDT', '卖出', 110, 1, 2),
                 (1, 'BTC-USDT', 'BUY', 100, 1, 3);
        """
    )
    # Orphans left by deletes made while SQLite FK enforcement was off; a reused
    # dataset id would otherwise re-attach them to the next dataset created.
    assert conn.execute("SELECT COUNT(*) FROM trades WHERE dataset_id=99").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM trades").fetchone()[0] == 1
    # TradeFill.side is a 'BUY' | 'SELL' union the frontend types against.
    sides = sorted(r[0] for r in conn.execute("SELECT side FROM trade_fills"))
    assert sides == ["BUY", "BUY", "SELL"]


def test_kline_cache_is_reset_once_then_left_alone(migrated):
    """klines cached SPOT candles before the swap-market switch; the reset must not repeat."""
    conn = migrated(
        """
        CREATE TABLE klines (
          id INTEGER PRIMARY KEY AUTOINCREMENT, symbol VARCHAR(32) NOT NULL, timeframe VARCHAR(8) NOT NULL,
          timestamp BIGINT NOT NULL, open FLOAT NOT NULL, high FLOAT NOT NULL, low FLOAT NOT NULL,
          close FLOAT NOT NULL, volume FLOAT NOT NULL);
        INSERT INTO klines (symbol, timeframe, timestamp, open, high, low, close, volume)
          VALUES ('BTC-USDT', '15m', 0, 1, 1, 1, 1, 1);
        """
    )
    assert conn.execute("SELECT COUNT(*) FROM klines").fetchone()[0] == 0
    assert conn.execute("PRAGMA user_version").fetchone()[0] >= 1

    # A later boot must leave freshly cached candles in place.
    conn.execute(
        "INSERT INTO klines (symbol, timeframe, timestamp, open, high, low, close, volume)"
        " VALUES ('BTC-USDT', '15m', 1, 1, 1, 1, 1, 1)"
    )
    conn.commit()
    conn.close()
    migrated.boot()
    conn = sqlite3.connect(migrated.db_path)
    assert conn.execute("SELECT COUNT(*) FROM klines").fetchone()[0] == 1


PERCENT_RATE_DB = """
CREATE TABLE datasets (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(128) NOT NULL UNIQUE, created_at DATETIME);
CREATE TABLE trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT, dataset_id INTEGER NOT NULL,
  symbol VARCHAR(32) NOT NULL, direction VARCHAR(8) NOT NULL, leverage FLOAT,
  entry_price FLOAT NOT NULL, exit_price FLOAT, profit FLOAT, profit_rate FLOAT,
  entry_time BIGINT NOT NULL, exit_time BIGINT, margin FLOAT);
CREATE TABLE trade_annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, subject_type VARCHAR(16) NOT NULL DEFAULT 'trade',
  subject_id INTEGER NOT NULL, note TEXT, setup_tags TEXT, error_tags TEXT,
  grade VARCHAR(4), emotion VARCHAR(16), planned_stop FLOAT, planned_target FLOAT,
  updated_at DATETIME);
INSERT INTO datasets (id, name) VALUES (1, '我的');
INSERT INTO trades (dataset_id, symbol, direction, entry_price, profit, margin, profit_rate, entry_time)
  VALUES (1, 'TRUMP-USDT', 'short', 2.48, 3030.47919674, 1399.8829528592, 216.480898, 1),
         (1, 'ETH-USDT', 'long', 3000, 419.78951687, 486.13, 86.353345, 2),
         (1, 'SOL-USDT', 'long', 100, 265, 1170, 0.2264, 3),
         (1, 'BTC-USDT', 'long', 100, 150, 3000, 5.0, 4);
INSERT INTO trade_annotations (subject_type, subject_id, note)
  VALUES ('trade', 1, 'kept'), ('trade', 99, 'orphan');
"""


def test_percent_style_profit_rate_is_normalized_once(migrated):
    """\u6536\u76ca\u7387 arrived as percent in a live \u4ea4\u5272\u5355 and as a ratio in the sample sheet."""
    conn = migrated(PERCENT_RATE_DB)
    rates = [r[0] for r in conn.execute("SELECT profit_rate FROM trades ORDER BY id")]
    assert rates[0] == pytest.approx(2.16480898, rel=1e-6), "percent row must be scaled"
    assert rates[1] == pytest.approx(0.86353345, rel=1e-6)
    assert rates[2] == 0.2264, "a ratio row is already correct and stays verbatim"
    assert rates[3] == pytest.approx(0.05, rel=1e-6)

    conn.close()
    migrated.boot()
    conn = sqlite3.connect(migrated.db_path)
    again = [r[0] for r in conn.execute("SELECT profit_rate FROM trades ORDER BY id")]
    assert again == rates, "a second boot must not divide again"


def test_orphan_annotations_are_removed(migrated):
    conn = migrated(PERCENT_RATE_DB)
    notes = [r[0] for r in conn.execute("SELECT note FROM trade_annotations ORDER BY id")]
    assert notes == ["kept"]
