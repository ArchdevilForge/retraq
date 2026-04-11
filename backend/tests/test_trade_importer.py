from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import Trade
from services import import_types
from services.trade_importer import trade_importer


def _make_session(db_path: Path):
    engine = create_engine(
        f"sqlite:///{db_path}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine, autocommit=False, autoflush=False)()


def _write_excel(path: Path, rows: list[dict[str, object]]) -> Path:
    pd.DataFrame(rows).to_excel(path, index=False)
    return path


def test_D02_missing_required_columns_rejects_the_entire_file(tmp_path: Path):
    """D-02: missing required columns rejects the whole workbook."""

    db = _make_session(tmp_path / "trading.db")
    workbook = _write_excel(
        tmp_path / "missing_required_columns.xlsx",
        [
            {
                "交易对（币对）": "btc/usdt",
                "方向": "做多",
                "开仓均价": "1234.5",
            }
        ],
    )

    report = trade_importer.parse_excel(db, str(workbook))

    assert isinstance(report, import_types.ImportReport)
    assert report.file_rejection is not None
    assert report.file_rejection.missing_columns == ("entry_time",)
    assert report.summary.total_rows == 0
    assert report.summary.success_count == 0
    assert report.row_outcomes == ()
    assert report.normalization_events == ()


def test_D09_D10_D12_importer_returns_structured_report_for_mixed_rows(tmp_path: Path):
    """D-09/D-10/D-12: mixed rows keep row-level outcomes, normalization, and report metadata."""

    db = _make_session(tmp_path / "trading.db")
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

    workbook = _write_excel(
        tmp_path / "mixed_rows.xlsx",
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
            },
            {
                "交易对（币对）": "btc/usdt",
                "方向": "做多",
                "开仓均价": "1,234.5",
                "平仓均价": "1,400.0",
                "收益率": "12.5%",
                "收益 (USDT)": "1,000",
                "保证金（最大时）": "600",
                "开仓时间": "2024-01-02 09:15:00",
                "平仓时间": "2024-01-02 10:15:00",
            },
            {
                "交易对（币对）": "eth/usdt",
                "方向": "做空",
                "开仓均价": "2200",
                "平仓均价": "2000",
                "收益率": "-9.1%",
                "收益 (USDT)": "-200",
                "保证金（最大时）": "300",
                "开仓时间": "2024-01-03 09:15:00",
                "平仓时间": "2024-01-03 10:15:00",
            },
            {
                "交易对（币对）": "eth/usdt",
                "方向": "做空",
                "开仓均价": "2200",
                "平仓均价": "2000",
                "收益率": "-9.1%",
                "收益 (USDT)": "-200",
                "保证金（最大时）": "300",
                "开仓时间": "2024-01-03 09:15:00",
                "平仓时间": "2024-01-03 10:15:00",
            },
            {
                "交易对（币对）": "xrp/usdt",
                "方向": "做多",
                "开仓均价": "not-a-number",
                "平仓均价": "0.52",
                "收益率": "5%",
                "收益 (USDT)": "12",
                "保证金（最大时）": "50",
                "开仓时间": "2024-01-04 09:15:00",
                "平仓时间": "2024-01-04 10:15:00",
            },
        ],
    )

    report = trade_importer.parse_excel(db, str(workbook))

    assert isinstance(report, import_types.ImportReport)
    assert report.file_rejection is None
    assert report.summary.total_rows == 5
    assert report.summary.success_count == 1
    assert report.summary.duplicate_count == 2
    assert report.summary.conflict_count == 1
    assert report.summary.failed_count == 1
    assert report.summary.timestamp_normalization_count == 8
    assert db.query(Trade).count() == 2
    assert report.download_reference is not None
    assert report.download_reference.format == "csv"
    assert report.download_reference.mime_type == "text/csv"
    assert report.download_reference.download_url
    assert len(report.row_outcomes) == 5
    assert len(report.normalization_events) == 8
    assert any(outcome.outcome == "duplicate" for outcome in report.row_outcomes)
    assert any(outcome.outcome == "conflict" for outcome in report.row_outcomes)
    assert any(outcome.outcome == "failed" for outcome in report.row_outcomes)


def test_manual_rows_import_reuses_structured_report_pipeline(tmp_path: Path):
    db = _make_session(tmp_path / "trading.db")
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

    report = trade_importer.parse_rows(
        db,
        [
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
            {
                "symbol": "xrp/usdt",
                "direction": "做多",
                "entry_price": "not-a-number",
                "entry_time": "2024-01-04 09:15:00",
            },
        ],
        source_filename="manual-entry",
    )

    assert isinstance(report, import_types.ImportReport)
    assert report.file_rejection is None
    assert report.summary.total_rows == 3
    assert report.summary.success_count == 1
    assert report.summary.duplicate_count == 1
    assert report.summary.conflict_count == 0
    assert report.summary.failed_count == 1
    assert report.summary.timestamp_normalization_count == 4
    assert db.query(Trade).count() == 2
    assert report.download_reference is not None
    assert report.download_reference.filename.startswith("import-report-manual-entry-")
    assert [outcome.outcome for outcome in report.row_outcomes] == [
        "duplicate",
        "success",
        "failed",
    ]
