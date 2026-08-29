"""Tests for Master Traders and Futures Positions API."""

from models import MasterTrader, MasterPosition, Dataset


def _seed_sample_masters(db_session):
    t1 = MasterTrader(
        id="trader_001",
        nickname="TrendMaster",
        market="futures",
        roi=125.5,
        pnl=4500.0,
        mdd=4.2,
        win_rate=75.0,
        has_positions=True,
        position_count=2,
    )
    t2 = MasterTrader(
        id="trader_002",
        nickname="ScalperKing",
        market="futures",
        roi=80.0,
        pnl=1200.0,
        mdd=12.0,
        win_rate=60.0,
        has_positions=False,
        position_count=0,
    )
    db_session.add_all([t1, t2])
    db_session.flush()

    p1 = MasterPosition(
        position_id="pos_1",
        trader_id="trader_001",
        symbol="BTC-USDT",
        side="LONG",
        leverage=20.0,
        entry_price=60000.0,
        close_price=63000.0,
        pnl=600.0,
        roi=100.0,
        opened_at=1700000000000,
        closed_at=1700003600000,
    )
    p2 = MasterPosition(
        position_id="pos_2",
        trader_id="trader_001",
        symbol="ETH-USDT",
        side="SHORT",
        leverage=20.0,
        entry_price=3000.0,
        close_price=2900.0,
        pnl=200.0,
        roi=66.6,
        opened_at=1700010000000,
        closed_at=1700013600000,
    )
    db_session.add_all([p1, p2])
    db_session.commit()


def test_list_masters_filter_and_sort(client, db_session):
    _seed_sample_masters(db_session)

    # 1. has_positions_only=True (default)
    res = client.get("/api/masters")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 1
    assert data["data"][0]["id"] == "trader_001"

    # 2. has_positions_only=False
    res_all = client.get("/api/masters?has_positions_only=false")
    assert res_all.status_code == 200
    assert res_all.json()["total"] == 2

    # 3. Search
    res_search = client.get("/api/masters?search=Scalper&has_positions_only=false")
    assert res_search.status_code == 200
    assert res_search.json()["total"] == 1
    assert res_search.json()["data"][0]["nickname"] == "ScalperKing"


def test_master_detail(client, db_session):
    _seed_sample_masters(db_session)

    res = client.get("/api/masters/trader_001")
    assert res.status_code == 200
    assert res.json()["nickname"] == "TrendMaster"

    res_404 = client.get("/api/masters/non_existent")
    assert res_404.status_code == 404


def test_master_positions(client, db_session):
    _seed_sample_masters(db_session)

    res = client.get("/api/masters/trader_001/positions")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 2

    # Filter by symbol
    res_btc = client.get("/api/masters/trader_001/positions?symbol=BTC-USDT")
    assert res_btc.status_code == 200
    assert res_btc.json()["total"] == 1
    assert res_btc.json()["data"][0]["symbol"] == "BTC-USDT"

    # Sort by roi desc
    res_sort = client.get("/api/masters/trader_001/positions?sort_by=roi&sort_order=desc")
    assert res_sort.status_code == 200
    rois = [p["roi"] for p in res_sort.json()["data"]]
    assert rois[0] >= rois[1]


def test_master_sync_endpoint(client, db_session):
    _seed_sample_masters(db_session)

    res_404 = client.post("/api/masters/non_existent/sync")
    assert res_404.status_code == 404

    # Note: real Binance sync will fail gracefully on network or dummy id and return success with 0 new
    res = client.post("/api/masters/trader_001/sync")
    assert res.status_code == 200
    assert res.json()["success"] is True


def test_master_overlay(client, db_session):
    _seed_sample_masters(db_session)

    # Query range covering BTC trade
    res = client.get("/api/masters/overlay?symbol=BTC-USDT&start_ts=1699999000000&end_ts=1700005000000")
    assert res.status_code == 200
    data = res.json()
    assert data["symbol"] == "BTC-USDT"
    assert len(data["data"]) == 1
    assert data["data"][0]["trader_nickname"] == "TrendMaster"


def test_clone_master_dataset_removed(client, db_session):
    """owner 隔离后，克隆高手交易到数据集的路径已废弃（docs/PRODUCT.md §三）。"""
    _seed_sample_masters(db_session)

    res = client.post("/api/masters/trader_001/clone")
    assert res.status_code in (404, 405)


def test_datasets_list_exposes_owner(client, db_session):
    db_session.add(Dataset(name="默认数据集"))
    db_session.commit()

    res = client.get("/api/datasets")
    assert res.status_code == 200
    rows = res.json()["data"]
    assert rows
    for row in rows:
        assert row["owner"] == "self"


def test_master_quotes(client):
    res = client.get("/api/masters/quotes")
    assert res.status_code == 200
    data = res.json()["data"]
    assert len(data) >= 5
    assert any(q["id"] == "bitking" for q in data)
    assert any(q["id"] == "tony" for q in data)
