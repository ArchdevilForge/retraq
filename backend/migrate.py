"""DB bootstrap + profiles → datasets one-time migration. No auto seed."""
from sqlalchemy import inspect, text

from database import engine, Base
from models import Dataset  # noqa: F401 — register models

LEGACY_DATASET_NAMES = ("默认", "浪哥（示例）")


def _table_exists(name: str) -> bool:
    return name in inspect(engine).get_table_names()


def _column_exists(table: str, col: str) -> bool:
    if not _table_exists(table):
        return False
    return col in {c["name"] for c in inspect(engine).get_columns(table)}


def _migrate_legacy_profiles() -> None:
    if not _table_exists("profiles"):
        return
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
        if _column_exists("trades", "profile_id") and not _column_exists("trades", "dataset_id"):
            conn.execute(text("ALTER TABLE trades ADD COLUMN dataset_id INTEGER"))
            conn.execute(text("UPDATE trades SET dataset_id = profile_id WHERE dataset_id IS NULL"))
        conn.execute(text("DROP TABLE IF EXISTS profiles"))


def _purge_legacy_default_datasets() -> None:
    if not _table_exists("datasets"):
        return
    from database import SessionLocal

    db = SessionLocal()
    try:
        for name in LEGACY_DATASET_NAMES:
            row = db.query(Dataset).filter(Dataset.name == name).first()
            if row:
                db.delete(row)
        db.commit()
    finally:
        db.close()


def ensure_database() -> None:
    Base.metadata.create_all(bind=engine)
    _migrate_legacy_profiles()
    _purge_legacy_default_datasets()
    if _table_exists("trades") and _column_exists("trades", "profile_id") and _column_exists("trades", "dataset_id"):
        with engine.begin() as conn:
            conn.execute(
                text("UPDATE trades SET dataset_id = profile_id WHERE dataset_id IS NULL")
            )