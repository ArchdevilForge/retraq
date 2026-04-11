from __future__ import annotations

import importlib
import sys
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

import database
from database import Base


def _make_client(db_path: Path) -> TestClient:
    engine = create_engine(
        f"sqlite:///{db_path}", connect_args={"check_same_thread": False}
    )
    database.engine = engine
    database.SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(bind=engine)

    sys.modules.pop("main", None)
    main = importlib.import_module("main")
    return TestClient(main.app)


def _seed_trade(symbol: str, entry_price: float) -> None:
    with database.SessionLocal() as session:
        _ = session.execute(
            text(
                "INSERT INTO trades (symbol, direction, leverage, entry_price, entry_time) "
                "VALUES (:symbol, :direction, :leverage, :entry_price, :entry_time)"
            ),
            {
                "symbol": symbol,
                "direction": "long",
                "leverage": 2,
                "entry_price": entry_price,
                "entry_time": 1710000000000,
            },
        )
        session.commit()


def test_backup_download_returns_current_sqlite_database(tmp_path: Path):
    db_path = tmp_path / "trading.db"
    client = _make_client(db_path)

    _seed_trade("BTC-USDT", 65000)

    response = client.get("/api/backups/download")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/octet-stream")
    assert response.headers["content-disposition"].endswith('.sqlite3"')
    assert response.content == db_path.read_bytes()


def test_backup_restore_replaces_the_database_contents(tmp_path: Path):
    db_path = tmp_path / "trading.db"
    client = _make_client(db_path)

    _seed_trade("BTC-USDT", 65000)

    backup_response = client.get("/api/backups/download")
    backup_bytes = backup_response.content

    _seed_trade("ETH-USDT", 2500)

    restore_response = client.post(
        "/api/backups/restore",
        files={"file": ("backup.sqlite3", backup_bytes, "application/octet-stream")},
    )

    assert restore_response.status_code == 200
    assert restore_response.json()["status"] == "restored"

    with database.SessionLocal() as session:
        rows = session.execute(
            text(
                "SELECT symbol, direction, leverage, entry_price FROM trades ORDER BY id"
            )
        ).all()

    assert rows == [("BTC-USDT", "long", 2.0, 65000.0)]
