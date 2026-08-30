"""Tests for saving training sessions into sim datasets (docs/PRODUCT.md §六)."""


from models import Dataset


def _payload():
    return {
        "symbol": "BTC-USDT",
        "timeframe": "15m",
        "start_equity": 1000.0,
        "realized_pnl": 120.0,
        "fees": 0.0,
        "trades": [
            {
                "symbol": "BTC-USDT",
                "direction": "long",
                "leverage": 10,
                "entry_price": 60000.0,
                "exit_price": 61200.0,
                "profit": 120.0,
                "margin": 1000.0,
                "entry_time": 1700000000000,
                "exit_time": 1700003600000,
            }
        ],
    }


def test_save_creates_sim_dataset(client, db_session):
    res = client.post("/api/train/save", json=_payload())
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["trade_count"] == 1

    ds = db_session.query(Dataset).filter(Dataset.id == body["dataset_id"]).one()
    assert ds.owner == "sim"
    assert "[训练]" in ds.name


def test_save_rejects_empty_session(client):
    payload = _payload() | {"trades": []}
    res = client.post("/api/train/save", json=payload)
    assert res.status_code == 400


def test_save_disambiguates_same_minute_sessions(client, db_session):
    """同一分钟两局同名会话：第二局加序号落库，绝不静默丢弃（PRODUCT §六 结果落库）。"""
    res = client.post("/api/train/save", json=_payload())
    assert res.status_code == 200
    res2 = client.post("/api/train/save", json=_payload())
    assert res2.status_code == 200
    assert res2.json()["dataset_id"] != res.json()["dataset_id"]
    assert res2.json()["dataset_name"].endswith("#2")

    res3 = client.post("/api/train/save", json=_payload())
    assert res3.status_code == 200
    assert res3.json()["dataset_name"].endswith("#3")


def test_save_rejects_invalid_trade_fields(client):
    payload = _payload() | {"trades": [{"symbol": "BTC-USDT"}]}
    res = client.post("/api/train/save", json=payload)
    assert res.status_code == 400
