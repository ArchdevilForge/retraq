"""API contract: response shapes align with frontend/src/services/api.ts."""
from fastapi.testclient import TestClient

import os

from tests.api_contract import (
    DATASET_FIELDS,
    IMPORT_RESULT_FIELDS,
    KLINE_FIELDS,
    STATS_OVERVIEW_FIELDS,
    SYMBOL_STATS_FIELDS,
    TRADE_FIELDS,
    TRADE_FILL_FIELDS,
)
from models import Dataset, Kline, Trade, TradeFill
from services.trade_importer import TEMPLATES

SAMPLE_LANGGE = os.path.join(
    os.path.dirname(__file__), "..", "..", "samples", "bit-langge-delivery-example.xlsx"
)


def test_trades_requires_dataset_header(client: TestClient):
    r = client.get("/api/trades")
    assert r.status_code == 400
    assert "X-Dataset-Id" in r.json()["detail"]


def test_stats_requires_dataset_header(client: TestClient):
    r = client.get("/api/stats/overview")
    assert r.status_code == 400
    assert "X-Dataset-Id" in r.json()["detail"]


def test_fills_requires_dataset_header(client: TestClient):
    r = client.get("/api/trades/1/fills")
    assert r.status_code == 400
    assert "X-Dataset-Id" in r.json()["detail"]


def test_trades_empty_with_valid_dataset(client: TestClient, dataset_headers):
    r = client.get("/api/trades", headers=dataset_headers)
    assert r.status_code == 200
    body = r.json()
    assert body == {"total": 0, "page": 1, "limit": 50, "data": []}


def test_trade_row_fields_match_frontend(client: TestClient, db_session, dataset, dataset_headers):
    db_session.add(
        Trade(
            dataset_id=dataset.id,
            symbol="BTC-USDT",
            direction="long",
            leverage=2.0,
            entry_price=100.0,
            exit_price=110.0,
            profit=10.0,
            profit_rate=0.1,
            margin=50.0,
            entry_time=1_700_000_000_000,
            exit_time=1_700_000_100_000,
        )
    )
    db_session.commit()

    r = client.get("/api/trades", headers=dataset_headers, params={"limit": 10})
    assert r.status_code == 200
    row = r.json()["data"][0]
    assert set(row.keys()) == TRADE_FIELDS
    assert row["direction"] == "long"


def test_invalid_symbol_filtered_from_trades(client: TestClient, db_session, dataset, dataset_headers):
    db_session.add_all(
        [
            Trade(
                dataset_id=dataset.id,
                symbol="YFII-USDT",
                direction="long",
                entry_price=1.0,
                entry_time=1,
            ),
            Trade(
                dataset_id=dataset.id,
                symbol="BTC-USDT",
                direction="short",
                entry_price=2.0,
                entry_time=2,
            ),
        ]
    )
    db_session.commit()

    r = client.get("/api/trades", headers=dataset_headers, params={"limit": 10})
    assert r.status_code == 200
    body = r.json()
    # total must match filtered data (not raw DB count)
    assert body["total"] == 1
    assert len(body["data"]) == 1
    assert body["data"][0]["symbol"] == "BTC-USDT"


def test_trade_fills_fields_and_scoping(client: TestClient, db_session, dataset, dataset_headers):
    trade = Trade(
        dataset_id=dataset.id,
        symbol="ETH-USDT",
        direction="short",
        entry_price=2000.0,
        entry_time=1000,
    )
    db_session.add(trade)
    db_session.flush()
    db_session.add(
        TradeFill(
            dataset_id=dataset.id,
            trade_id=trade.id,
            symbol="ETH-USDT",
            side="SELL",
            price=2000.0,
            qty=0.5,
            time_ms=1000,
            realized_pnl=None,
        )
    )
    db_session.commit()

    r = client.get(f"/api/trades/{trade.id}/fills", headers=dataset_headers)
    assert r.status_code == 200
    row = r.json()["data"][0]
    assert set(row.keys()) == TRADE_FILL_FIELDS
    assert row["side"] == "SELL"

    other = Dataset(name="other")
    db_session.add(other)
    db_session.commit()
    r2 = client.get(f"/api/trades/{trade.id}/fills", headers={"X-Dataset-Id": str(other.id)})
    assert r2.status_code == 404


def test_stats_overview_empty_dataset(client: TestClient, dataset_headers):
    r = client.get("/api/stats/overview", headers=dataset_headers)
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == STATS_OVERVIEW_FIELDS
    assert body["trade_count"] == 0
    assert body["win_rate"] == 0


def test_stats_overview_win_rate_is_percent(client: TestClient, db_session, dataset, dataset_headers):
    db_session.add_all(
        [
            Trade(
                dataset_id=dataset.id,
                symbol="BTC-USDT",
                direction="long",
                entry_price=1.0,
                profit=10.0,
                entry_time=1,
                exit_time=2,
            ),
            Trade(
                dataset_id=dataset.id,
                symbol="BTC-USDT",
                direction="long",
                entry_price=1.0,
                profit=-5.0,
                entry_time=3,
                exit_time=4,
            ),
        ]
    )
    db_session.commit()

    r = client.get("/api/stats/overview", headers=dataset_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["win_rate"] == 50.0
    assert body["trade_count"] == 2


def test_stats_symbols_shape(client: TestClient, db_session, dataset, dataset_headers):
    db_session.add(
        Trade(
            dataset_id=dataset.id,
            symbol="BTC-USDT",
            direction="long",
            entry_price=1.0,
            entry_time=1,
        )
    )
    db_session.commit()

    r = client.get("/api/stats/symbols", headers=dataset_headers)
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == SYMBOL_STATS_FIELDS
    assert body["trade_count"] == 1
    assert body["symbol_distribution"] == {"BTC-USDT": 1}


def test_datasets_list_shape(client: TestClient, dataset):
    r = client.get("/api/datasets")
    assert r.status_code == 200
    row = r.json()["data"][0]
    assert set(row.keys()) == DATASET_FIELDS
    assert row["id"] == dataset.id


def test_dataset_patch_shape(client: TestClient, dataset):
    r = client.patch(f"/api/datasets/{dataset.id}", json={"name": "renamed"})
    assert r.status_code == 200
    assert set(r.json().keys()) == DATASET_FIELDS
    assert r.json()["name"] == "renamed"


def test_import_templates_shape(client: TestClient):
    r = client.get("/api/import/templates")
    assert r.status_code == 200
    templates = r.json()["templates"]
    assert len(templates) == len(TEMPLATES)
    for item in templates:
        assert set(item.keys()) == {"id", "label"}
        assert item["id"] in TEMPLATES


def test_klines_invalid_timeframe(client: TestClient):
    r = client.get("/api/klines/BTC-USDT/3m")
    assert r.status_code == 400
    assert "Invalid timeframe" in r.json()["detail"]


def test_klines_cached_shape(client: TestClient, db_session):
    step = 5 * 60 * 1000
    db_session.add(
        Kline(
            symbol="BTC-USDT",
            timeframe="5m",
            timestamp=0,
            open=1.0,
            high=2.0,
            low=0.5,
            close=1.5,
            volume=10.0,
        )
    )
    db_session.add(
        Kline(
            symbol="BTC-USDT",
            timeframe="5m",
            timestamp=step,
            open=1.5,
            high=2.5,
            low=1.0,
            close=2.0,
            volume=12.0,
        )
    )
    db_session.commit()

    r = client.get(
        "/api/klines/BTC-USDT/5m",
        params={"start": 0, "end": step, "nocache": 0},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["symbol"] == "BTC-USDT"
    assert body["timeframe"] == "5m"
    assert len(body["data"]) == 2
    assert set(body["data"][0].keys()) == KLINE_FIELDS
    assert body["data"][0]["timestamp"] == 0

def test_import_result_optional_fields_disjoint():
    from tests.api_contract import IMPORT_RESULT_FIELDS, IMPORT_RESULT_OPTIONAL_FIELDS

    assert IMPORT_RESULT_FIELDS.isdisjoint(IMPORT_RESULT_OPTIONAL_FIELDS)
    assert "fills" in IMPORT_RESULT_OPTIONAL_FIELDS
    assert "closed_positions" in IMPORT_RESULT_OPTIONAL_FIELDS


def test_import_langge_result_fields(client: TestClient):
    if not os.path.isfile(SAMPLE_LANGGE):
        return
    with open(SAMPLE_LANGGE, "rb") as f:
        r = client.post(
            "/api/trades/import",
            params={"template": "auto", "replace": True, "label": "contract-sample"},
            files={
                "file": (
                    "bit-langge-delivery-example.xlsx",
                    f,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert IMPORT_RESULT_FIELDS.issubset(body.keys())
    assert body["template"] == "langge"
    assert body["dataset_name"] == "contract-sample"
    assert body["replaced"] is True
    assert body["success"] >= 1

    headers = {"X-Dataset-Id": str(body["dataset_id"])}
    trades = client.get("/api/trades", headers=headers, params={"limit": 50})
    assert trades.status_code == 200
    assert trades.json()["total"] == body["success"]
    row = trades.json()["data"][0]
    assert set(row.keys()) == TRADE_FIELDS
    if row["profit_rate"] is not None:
        # API stores decimal ratio for Intl percent formatting
        assert abs(row["profit_rate"]) <= 10

