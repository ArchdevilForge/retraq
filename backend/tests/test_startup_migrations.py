from __future__ import annotations

import importlib
import sys

import database


def _pop_module(name: str) -> None:
    sys.modules.pop(name, None)


def test_main_invokes_migrations_before_schema_bootstrap(monkeypatch):
    events: list[str] = []

    class RecordingMigrationRunner:
        def __init__(self, *args, **kwargs):
            events.append("runner.init")

        def run(self) -> str:
            events.append("runner.run")
            return "001"

    def record_create_all(*args, **kwargs):
        events.append("create_all")

    import migrations.runner as migration_runner

    monkeypatch.setattr(migration_runner, "MigrationRunner", RecordingMigrationRunner)
    monkeypatch.setattr(database.Base.metadata, "create_all", record_create_all)

    _pop_module("main")
    _ = importlib.import_module("main")

    assert "runner.run" in events
    if "create_all" in events:
        assert events.index("runner.run") < events.index("create_all")


def test_import_data_invokes_migrations_before_startup_schema_access(monkeypatch):
    events: list[str] = []

    class RecordingMigrationRunner:
        def __init__(self, *args, **kwargs):
            events.append("runner.init")

        def run(self) -> str:
            events.append("runner.run")
            return "001"

    class RecordingQuery:
        def count(self) -> int:
            events.append("query_count")
            return 0

    class RecordingSession:
        def query(self, model):
            events.append("session.query")
            return RecordingQuery()

        def close(self) -> None:
            events.append("session.close")

    def record_create_all(*args, **kwargs):
        events.append("create_all")

    def record_session_local():
        events.append("session_factory")
        return RecordingSession()

    import migrations.runner as migration_runner

    monkeypatch.setattr(migration_runner, "MigrationRunner", RecordingMigrationRunner)
    monkeypatch.setattr(database.Base.metadata, "create_all", record_create_all)
    monkeypatch.setattr(database, "SessionLocal", record_session_local)

    _pop_module("import_data")
    import_data = importlib.import_module("import_data")
    monkeypatch.setattr(import_data.os.path, "exists", lambda *_args, **_kwargs: False)

    import_data.main()

    assert "runner.run" in events
    assert events.index("runner.run") < events.index("query_count")
    if "create_all" in events:
        assert events.index("runner.run") < events.index("create_all")
