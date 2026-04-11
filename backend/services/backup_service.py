from __future__ import annotations

from pathlib import Path
import shutil

from sqlalchemy.engine import Engine

from migrations.runner import MigrationRunner


SQLITE_BACKUP_HEADER = b"SQLite format 3\x00"


def _sqlite_path_from_engine(engine: Engine) -> Path:
    database = engine.url.database
    if engine.url.get_backend_name() != "sqlite" or not database:
        raise ValueError("Backup service only supports SQLite file databases")
    return Path(database).expanduser()


def _is_sqlite_backup(backup_path: Path) -> bool:
    with backup_path.open("rb") as backup_file:
        return backup_file.read(len(SQLITE_BACKUP_HEADER)) == SQLITE_BACKUP_HEADER


def create_sqlite_backup(engine: Engine) -> Path:
    return MigrationRunner(engine=engine).backup_database()


def restore_sqlite_backup(engine: Engine, backup_path: Path) -> None:
    sqlite_path = _sqlite_path_from_engine(engine)
    if not backup_path.exists():
        raise FileNotFoundError(f"SQLite backup not found: {backup_path}")
    if not _is_sqlite_backup(backup_path):
        raise ValueError("Only SQLite backup files are supported")

    engine.dispose()
    try:
        _ = shutil.copy2(backup_path, sqlite_path)
    finally:
        engine.dispose()
