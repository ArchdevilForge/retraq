from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from collections.abc import Sequence
from pathlib import Path
import shutil
from typing import Callable, cast

from sqlalchemy import Connection, Engine, text


SCHEMA_VERSION_TABLE = "schema_version"


def _version_sort_key(version: str) -> tuple[int, str]:
    try:
        return (int(version), version)
    except ValueError:
        return (0, version)


def _sqlite_path_from_engine(engine: Engine) -> Path:
    database = engine.url.database
    if engine.url.get_backend_name() != "sqlite" or not database:
        raise ValueError("MigrationRunner only supports SQLite file databases")
    return Path(database).expanduser()


@dataclass(frozen=True, slots=True)
class MigrationStep:
    version: str
    name: str
    apply: Callable[[Connection], None]


def bootstrap_schema(connection: Connection) -> None:
    _ = connection.execute(
        text(
            """
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
            )
            """
        )
    )
    _ = connection.execute(
        text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ix_kline_symbol_tf_ts
            ON klines(symbol, timeframe, timestamp)
            """
        )
    )
    _ = connection.execute(
        text(
            """
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
            )
            """
        )
    )
    _ = connection.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS ix_trade_symbol
            ON trades(symbol)
            """
        )
    )


DEFAULT_MIGRATIONS: tuple[MigrationStep, ...] = (
    MigrationStep(version="001", name="bootstrap_schema", apply=bootstrap_schema),
)


@dataclass(slots=True)
class MigrationRunner:
    engine: Engine
    migrations: Sequence[MigrationStep] = DEFAULT_MIGRATIONS
    backup_dir: Path | None = None

    def run(self) -> str:
        ordered_migrations = self._ordered_migrations()
        if not ordered_migrations:
            return self.current_version() or ""

        current_version = self.current_version()
        target_version = ordered_migrations[-1].version
        if current_version == target_version:
            return target_version

        pending_migrations = [
            migration
            for migration in ordered_migrations
            if current_version is None
            or _version_sort_key(migration.version) > _version_sort_key(current_version)
        ]

        if not pending_migrations:
            return current_version or target_version

        _ = self.backup_database()

        with self.engine.begin() as connection:
            self._ensure_schema_version_table(connection)
            for migration in pending_migrations:
                migration.apply(connection)
                self._write_schema_version(connection, migration.version)

        return self.current_version() or pending_migrations[-1].version

    def current_version(self) -> str | None:
        with self.engine.connect() as connection:
            if not self._schema_version_table_exists(connection):
                return None
            version = cast(
                str | None,
                connection.execute(
                    text(
                        f"SELECT version FROM {SCHEMA_VERSION_TABLE} ORDER BY id DESC LIMIT 1"
                    )
                ).scalar_one_or_none(),
            )
            return version

    def backup_database(self) -> Path:
        sqlite_path = _sqlite_path_from_engine(self.engine)
        if not sqlite_path.exists():
            raise FileNotFoundError(f"SQLite database not found: {sqlite_path}")

        backup_root = self.backup_dir or sqlite_path.parent / "backups"
        backup_root.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
        backup_path = backup_root / f"{sqlite_path.stem}-{timestamp}.sqlite3"
        _ = shutil.copy2(sqlite_path, backup_path)
        return backup_path

    def _ordered_migrations(self) -> list[MigrationStep]:
        seen_versions: set[str] = set()
        ordered = sorted(
            self.migrations, key=lambda migration: _version_sort_key(migration.version)
        )
        for migration in ordered:
            if migration.version in seen_versions:
                raise ValueError(f"Duplicate migration version: {migration.version}")
            seen_versions.add(migration.version)
        return ordered

    def _schema_version_table_exists(self, connection: Connection) -> bool:
        result = connection.execute(
            text(
                "SELECT name FROM sqlite_master WHERE type='table' AND name = :table_name"
            ),
            {"table_name": SCHEMA_VERSION_TABLE},
        ).scalar_one_or_none()
        return result is not None

    def _ensure_schema_version_table(self, connection: Connection) -> None:
        _ = connection.execute(
            text(
                f"""
                CREATE TABLE IF NOT EXISTS {SCHEMA_VERSION_TABLE} (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    version TEXT NOT NULL,
                    applied_at TEXT NOT NULL
                )
                """
            )
        )

    def _write_schema_version(self, connection: Connection, version: str) -> None:
        _ = connection.execute(
            text(
                f"""
                INSERT INTO {SCHEMA_VERSION_TABLE} (id, version, applied_at)
                VALUES (1, :version, :applied_at)
                ON CONFLICT(id) DO UPDATE SET
                    version = excluded.version,
                    applied_at = excluded.applied_at
                """
            ),
            {"version": version, "applied_at": datetime.now(timezone.utc).isoformat()},
        )
