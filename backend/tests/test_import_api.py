from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pandas as pd
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import database
from database import Base
from models import Trade


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


def _excel_bytes(tmp_path: Path, rows: list[dict[str, object]]) -> bytes:
    workbook = tmp_path / "workbook.xlsx"
    pd.DataFrame(rows).to_excel(workbook, index=False)
    return workbook.read_bytes()


def test_import_api_rejects_non_excel_files(tmp_path: Path):
    client = _make_client(tmp_path / "trading.db")

    response = client.post(
        "/api/trades/import",
        files={"file": ("notes.txt", b"not-an-excel-file", "text/plain")},
    )

    assert response.status_code == 400
    assert "Only Excel files" in response.json()["detail"]


def test_import_api_returns_structured_report_for_missing_columns(tmp_path: Path):
    client = _make_client(tmp_path / "trading.db")
    workbook = _excel_bytes(
        tmp_path,
        [
            {
                "交易对（币对）": "btc/usdt",
                "方向": "做多",
                "开仓均价": "1234.5",
            }
        ],
    )

    response = client.post(
        "/api/trades/import",
        files={
            "file": (
                "missing.xlsx",
                workbook,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["file_rejection"]["reason"] == "missing_required_columns"
    assert payload["file_rejection"]["missing_columns"] == ["entry_time"]
    assert payload["summary"]["success_count"] == 0
    assert payload["download_reference"] is None


def test_import_api_returns_downloadable_structured_report(tmp_path: Path):
    client = _make_client(tmp_path / "trading.db")
    workbook = _excel_bytes(
        tmp_path,
        [
            {
                "交易对（币对）": "btc/usdt",
                "方向": "做多",
                "开仓均价": "1,234.5",
                "平仓均价": "1,400.0",
                "收益率": "12.5%",
                "收益 (USDT)": "1,000",
                "保证金（最大时）": "500",
                "开仓时间": "2024-01-02 09:15:00",
                "平仓时间": "2024-01-02 10:15:00",
            }
        ],
    )

    response = client.post(
        "/api/trades/import",
        files={
            "file": (
                "report.xlsx",
                workbook,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["success_count"] == 1
    assert payload["summary"]["duplicate_count"] == 0
    assert payload["download_reference"]["format"] == "csv"
    assert payload["download_reference"]["download_url"].startswith(
        "/api/trades/import/reports/"
    )

    download_response = client.get(payload["download_reference"]["download_url"])
    assert download_response.status_code == 200
    assert download_response.headers["content-type"].startswith("text/csv")
    assert "row_number,outcome,field" in download_response.text
    assert "success" in download_response.text


def test_import_api_serializes_blank_required_cell_failures_without_nan(tmp_path: Path):
    client = _make_client(tmp_path / "trading.db")
    workbook = _excel_bytes(
        tmp_path,
        [
            {
                "交易对（币对）": "btc/usdt",
                "方向": "做多",
                "开仓均价": None,
                "开仓时间": "2024-01-02 09:15:00",
            }
        ],
    )

    response = client.post(
        "/api/trades/import",
        files={
            "file": (
                "blank-entry-price.xlsx",
                workbook,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["failed_count"] == 1
    assert payload["row_outcomes"][0]["field"] == "entry_price"
    assert payload["row_outcomes"][0]["raw_value"] is None


def test_import_api_accepts_manual_rows_payload(tmp_path: Path):
    client = _make_client(tmp_path / "trading.db")
    db = database.SessionLocal()
    db.add(
        Trade(
            symbol="BTC-USDT",
            direction="long",
            leverage=1.0,
            entry_price=1234.5,
            exit_price=1400.0,
            profit=1000.0,
            profit_rate=0.125,
            margin=500.0,
            entry_time=1704158100000,
            exit_time=1704161700000,
        )
    )
    db.commit()
    db.close()

    response = client.post(
        "/api/trades/import/rows",
        json={
            "source_filename": "manual-entry",
            "rows": [
                {
                    "symbol": "btc/usdt",
                    "direction": "做多",
                    "entry_price": "1,234.5",
                    "exit_price": "1,400.0",
                    "profit_rate": "12.5%",
                    "profit": "1,000",
                    "margin": "500",
                    "entry_time": "2024-01-02 09:15:00",
                    "exit_time": "2024-01-02 10:15:00",
                },
                {
                    "symbol": "eth/usdt",
                    "direction": "做空",
                    "entry_price": "2200",
                    "exit_price": "2000",
                    "profit_rate": "-9.1%",
                    "profit": "-200",
                    "margin": "300",
                    "entry_time": "2024-01-03 09:15:00",
                    "exit_time": "2024-01-03 10:15:00",
                },
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["total_rows"] == 2
    assert payload["summary"]["success_count"] == 1
    assert payload["summary"]["duplicate_count"] == 1
    assert payload["summary"]["failed_count"] == 0
    assert payload["download_reference"]["download_url"].startswith(
        "/api/trades/import/reports/"
    )
    assert [row["outcome"] for row in payload["row_outcomes"]] == [
        "duplicate",
        "success",
    ]
