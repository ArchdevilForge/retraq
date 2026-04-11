from pathlib import Path
from typing import cast

from sqlalchemy import Connection, create_engine, text

from migrations.runner import MigrationRunner, MigrationStep


def test_migration_runner_creates_backup_before_applying_migrations(
    sqlite_database_url: str, tmp_path: Path
):
    engine = create_engine(sqlite_database_url)
    backup_dir = tmp_path / "backups"
    observed_backup_files: list[Path] = []

    def apply_migration(connection: Connection) -> None:
        observed_backup_files.extend(sorted(backup_dir.glob("*.sqlite3")))
        _ = connection.execute(
            text("CREATE TABLE sentinel_table (id INTEGER PRIMARY KEY)")
        )

    runner = MigrationRunner(
        engine=engine,
        migrations=[
            MigrationStep(version="001", name="bootstrap", apply=apply_migration)
        ],
        backup_dir=backup_dir,
    )

    result = runner.run()

    assert result == "001"
    assert observed_backup_files
    assert observed_backup_files[0].exists()


def test_migration_runner_records_schema_version_and_noops_when_current(
    sqlite_database_url: str, tmp_path: Path
):
    engine = create_engine(sqlite_database_url)
    backup_dir = tmp_path / "backups"
    calls: list[str] = []

    def apply_migration(connection: Connection) -> None:
        calls.append("called")
        _ = connection.execute(
            text("CREATE TABLE bootstrap_marker (id INTEGER PRIMARY KEY)")
        )

    runner = MigrationRunner(
        engine=engine,
        migrations=[
            MigrationStep(version="001", name="bootstrap", apply=apply_migration)
        ],
        backup_dir=backup_dir,
    )

    first_result = runner.run()
    second_result = runner.run()

    with engine.connect() as connection:
        version = cast(
            str,
            connection.execute(
                text("SELECT version FROM schema_version LIMIT 1")
            ).scalar_one(),
        )

    backup_files = sorted(backup_dir.glob("*.sqlite3"))

    assert first_result == "001"
    assert second_result == "001"
    assert version == "001"
    assert calls == ["called"]
    assert len(backup_files) == 1


def test_migration_runner_preserves_existing_rows_on_legacy_database(
    sqlite_database_url: str, tmp_path: Path
):
    engine = create_engine(sqlite_database_url)
    backup_dir = tmp_path / "backups"

    with engine.begin() as connection:
        _ = connection.execute(
            text("CREATE TABLE trades (id INTEGER PRIMARY KEY, symbol TEXT NOT NULL)")
        )
        _ = connection.execute(
            text("INSERT INTO trades (id, symbol) VALUES (1, 'BTC-USDT')")
        )

    def bootstrap_legacy_schema(connection: Connection) -> None:
        _ = connection.execute(
            text("CREATE TABLE sentinel_table (id INTEGER PRIMARY KEY)")
        )

    runner = MigrationRunner(
        engine=engine,
        migrations=[
            MigrationStep(
                version="001", name="bootstrap", apply=bootstrap_legacy_schema
            )
        ],
        backup_dir=backup_dir,
    )

    result = runner.run()

    with engine.connect() as connection:
        count = cast(
            int, connection.execute(text("SELECT COUNT(*) FROM trades")).scalar_one()
        )
        version = cast(
            str,
            connection.execute(
                text("SELECT version FROM schema_version LIMIT 1")
            ).scalar_one(),
        )

    assert result == "001"
    assert count == 1
    assert version == "001"
