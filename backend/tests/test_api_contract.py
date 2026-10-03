"""API contract: response shapes align with frontend/src/services/api.ts."""
from fastapi.testclient import TestClient

import os

import pytest

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


def test_dataset_created_at_is_utc(client: TestClient, dataset):
    """SQLite's CURRENT_TIMESTAMP is UTC; a bare ISO string would render 8h off in Asia/Shanghai."""
    row = client.get("/api/datasets").json()["data"][0]
    assert row["created_at"] is not None
    assert row["created_at"].endswith("+00:00"), row["created_at"]


def test_dataset_patch_shape(client: TestClient, dataset):
    r = client.patch(f"/api/datasets/{dataset.id}", json={"name": "renamed"})
    assert r.status_code == 200
    assert set(r.json().keys()) == DATASET_FIELDS
    assert r.json()["name"] == "renamed"


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

def _binance_trades_sheet() -> bytes:
    """Minimal 币安 U 本位交易历史 sheet: 9 filler rows, then the real header."""
    import io

    import pandas as pd

    header = ["代币名称/币种名称/币对", "时间", "方向", "价格", "数量", "已实现利润"]
    rows = [
        ["BTCUSDT", "2026-01-02 10:00:00", "BUY", 100.0, 1.0, 0.0],
        ["BTCUSDT", "2026-01-02 11:00:00", "SELL", 110.0, 1.0, 10.0],
    ]
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        pd.DataFrame([[None]] * 9).to_excel(writer, index=False, header=False, startrow=0)
        pd.DataFrame(rows, columns=header).to_excel(writer, index=False, startrow=9)
    return buf.getvalue()


def test_import_binance_result_optional_fields(client: TestClient):
    """The optional keys must come from the real aggregate path, not from a constant."""
    from tests.api_contract import IMPORT_RESULT_FIELDS, IMPORT_RESULT_OPTIONAL_FIELDS

    assert IMPORT_RESULT_FIELDS.isdisjoint(IMPORT_RESULT_OPTIONAL_FIELDS)
    r = client.post(
        "/api/trades/import",
        params={"template": "binance_futures_trades", "replace": True, "label": "binance-contract"},
        files={
            "file": (
                "b.xlsx",
                _binance_trades_sheet(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert IMPORT_RESULT_FIELDS.issubset(body.keys())
    assert IMPORT_RESULT_OPTIONAL_FIELDS.issubset(body.keys())
    assert body["fills"] == 2
    assert body["closed_positions"] == body["success"] == 1

    headers = {"X-Dataset-Id": str(body["dataset_id"])}
    row = client.get("/api/trades", headers=headers).json()["data"][0]
    assert row["direction"] == "long"
    # 100 -> 110 on 1 unit at 1x: +10 on 100 margin = a 0.1 decimal ratio.
    assert row["profit"] == 10.0
    assert row["profit_rate"] == pytest.approx(0.1)
    fills = client.get(f"/api/trades/{row['id']}/fills", headers=headers).json()["data"]
    assert [f["side"] for f in fills] == ["BUY", "SELL"]


def test_import_langge_result_fields(client: TestClient):
    if not os.path.isfile(SAMPLE_LANGGE):
        pytest.skip(f"sample workbook missing: {SAMPLE_LANGGE}")
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

    # profit_rate is a decimal return-on-margin ratio: 保证金（最大时）* 收益率 ≈ 收益.
    # 保证金 is the max-margin snapshot, so scaled-in rows drift; assert on the MEDIAN
    # relative error, which stays ~0.2% when correct and jumps to ~99% if the value is
    # rescaled by 100. A loose "abs(rate) <= 10" bound would hide exactly that error.
    import statistics

    all_rows = client.get("/api/trades", headers=headers, params={"limit": 2000}).json()["data"]
    rated = [
        t for t in all_rows if t["profit_rate"] and t["profit"] and t["margin"]
    ]
    assert len(rated) > 100, "sample must yield rows with margin, profit and profit_rate"
    errors = [abs(t["margin"] * t["profit_rate"] - t["profit"]) / abs(t["profit"]) for t in rated]
    assert statistics.median(errors) < 0.05

    # And the >100% rows must survive unscaled — the exact rows the old heuristic broke.
    assert any(t["profit_rate"] > 1 for t in rated)



def test_trades_non_integer_dataset_header(client: TestClient):
    r = client.get("/api/trades", headers={"X-Dataset-Id": "abc"})
    assert r.status_code == 400
    assert "Invalid X-Dataset-Id" in r.json()["detail"]


def test_trades_unknown_dataset_id(client: TestClient, dataset):
    r = client.get("/api/trades", headers={"X-Dataset-Id": str(dataset.id + 999)})
    assert r.status_code == 400
    assert r.json()["detail"] == "Dataset not found"


def test_stats_unknown_dataset_id(client: TestClient):
    r = client.get("/api/stats/overview", headers={"X-Dataset-Id": "424242"})
    assert r.status_code == 400
    assert r.json()["detail"] == "Dataset not found"


def test_trades_pagination_slices_entry_time_desc(client: TestClient, db_session, dataset, dataset_headers):
    db_session.add_all(
        [
            Trade(
                dataset_id=dataset.id,
                symbol="BTC-USDT",
                direction="long",
                entry_price=1.0,
                entry_time=1_700_000_000_000 + i * 1000,
            )
            for i in range(5)
        ]
    )
    db_session.commit()

    page1 = client.get("/api/trades", headers=dataset_headers, params={"page": 1, "limit": 2})
    assert page1.status_code == 200
    body1 = page1.json()
    assert body1["total"] == 5
    assert body1["page"] == 1
    assert body1["limit"] == 2
    assert [t["entry_time"] for t in body1["data"]] == [
        1_700_000_004_000,
        1_700_000_003_000,
    ]

    page2 = client.get("/api/trades", headers=dataset_headers, params={"page": 2, "limit": 2})
    body2 = page2.json()
    assert body2["total"] == 5
    assert [t["entry_time"] for t in body2["data"]] == [
        1_700_000_002_000,
        1_700_000_001_000,
    ]

    page3 = client.get("/api/trades", headers=dataset_headers, params={"page": 3, "limit": 2})
    assert [t["entry_time"] for t in page3.json()["data"]] == [1_700_000_000_000]

    page4 = client.get("/api/trades", headers=dataset_headers, params={"page": 4, "limit": 2})
    assert page4.json()["data"] == []
    assert page4.json()["total"] == 5


def test_delete_dataset_leaves_no_orphan_rows(client: TestClient, db_session, dataset, dataset_headers):
    trade = Trade(
        dataset_id=dataset.id,
        symbol="BTC-USDT",
        direction="long",
        entry_price=100.0,
        entry_time=1000,
    )
    db_session.add(trade)
    db_session.flush()
    db_session.add(
        TradeFill(
            dataset_id=dataset.id,
            trade_id=trade.id,
            symbol="BTC-USDT",
            side="BUY",
            price=100.0,
            qty=1.0,
            time_ms=1000,
            realized_pnl=0.0,
        )
    )
    db_session.commit()
    assert db_session.query(Trade).filter(Trade.dataset_id == dataset.id).count() == 1
    assert db_session.query(TradeFill).filter(TradeFill.dataset_id == dataset.id).count() == 1

    r = client.delete(f"/api/datasets/{dataset.id}")
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    db_session.expire_all()
    assert db_session.query(Dataset).filter(Dataset.id == dataset.id).first() is None
    assert db_session.query(Trade).filter(Trade.dataset_id == dataset.id).count() == 0
    assert db_session.query(TradeFill).filter(TradeFill.dataset_id == dataset.id).count() == 0

    # Observable via the API too: the id can no longer be used as a scope.
    assert client.get("/api/trades", headers=dataset_headers).status_code == 400


def test_delete_missing_dataset_is_404(client: TestClient):
    assert client.delete("/api/datasets/987654").status_code == 404


@pytest.mark.parametrize("limit", [-1, 0, 1001, 100000])
def test_klines_rejects_out_of_range_limit(client: TestClient, limit):
    r = client.get("/api/klines/BTC-USDT/5m", params={"limit": limit, "start": 0, "end": 300000})
    assert r.status_code == 422


def test_import_rejects_legacy_xls(client: TestClient):
    r = client.post(
        "/api/trades/import",
        params={"template": "auto", "replace": True},
        files={"file": ("old.xls", b"\xd0\xcf\x11\xe0", "application/vnd.ms-excel")},
    )
    assert r.status_code == 400
    assert ".xls" in r.json()["detail"]


def test_import_rejects_unsupported_extension(client: TestClient):
    r = client.post(
        "/api/trades/import",
        params={"template": "auto", "replace": True},
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert r.status_code == 400
