"""Tests for cross-dataset analysis reports and review notes (docs/PRODUCT.md §三/§七)."""

from models import Dataset, ReviewNote, Trade, TradeAnnotation


def _make_world(db_session):
    """self dataset with annotated trades + a sim dataset trade; master stays out."""
    ds_self = Dataset(name="实盘", owner="self")
    ds_sim = Dataset(name="训练", owner="sim")
    ds_master = Dataset(name="高手", owner="master:t1")
    db_session.add_all([ds_self, ds_sim, ds_master])
    db_session.flush()

    t1 = Trade(dataset_id=ds_self.id, symbol="BTC-USDT", direction="long", leverage=10,
               entry_price=60000, exit_price=61000, profit=500, profit_rate=0.083,
               margin=6000, entry_time=1700000000000, exit_time=1700003600000)
    t2 = Trade(dataset_id=ds_self.id, symbol="ETH-USDT", direction="short", leverage=20,
               entry_price=3000, exit_price=3100, profit=-400, profit_rate=-0.133,
               margin=3000, entry_time=1700040000000, exit_time=1700047200000)
    t3 = Trade(dataset_id=ds_self.id, symbol="BTC-USDT", direction="long", leverage=10,
               entry_price=59000, exit_price=59500, profit=250, profit_rate=0.042,
               margin=5900, entry_time=1700100000000, exit_time=1700103600000)
    t_sim = Trade(dataset_id=ds_sim.id, symbol="BTC-USDT", direction="long", leverage=10,
                  entry_price=60000, exit_price=62000, profit=1000, profit_rate=0.166,
                  margin=6000, entry_time=1700200000000, exit_time=1700203600000)
    t_master = Trade(dataset_id=ds_master.id, symbol="BTC-USDT", direction="long", leverage=10,
                     entry_price=60000, exit_price=65000, profit=9999, profit_rate=0.5,
                     margin=6000, entry_time=1700300000000, exit_time=1700303600000)
    db_session.add_all([t1, t2, t3, t_sim, t_master])
    db_session.flush()

    db_session.add_all(
        [
            TradeAnnotation(subject_type="trade", subject_id=t1.id, note=None,
                            setup_tags='["回踩","关键位狙击"]', error_tags="[]",
                            grade="A+", emotion="冷静", planned_stop=59000.0, planned_target=65000.0),
            TradeAnnotation(subject_type="trade", subject_id=t2.id, note=None,
                            setup_tags='["追高"]', error_tags='["追高","没止损"]',
                            grade="C", emotion="急躁", planned_stop=None, planned_target=None),
            TradeAnnotation(subject_type="trade", subject_id=t3.id, note=None,
                            setup_tags='["回踩"]', error_tags="[]",
                            grade="A", emotion=None, planned_stop=58500.0, planned_target=None),
        ]
    )
    db_session.commit()
    return ds_self, ds_sim


def test_by_setup_joins_annotations_and_excludes_master(client, db_session):
    _make_world(db_session)
    res = client.get("/api/analysis/by-setup")
    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {"self", "sim"}
    tags = {row["tag"]: row for row in body["self"]}
    assert tags["回踩"]["trade_count"] == 2
    assert tags["回踩"]["total_profit"] == 750.0
    assert tags["回踩"]["win_rate"] == 1.0
    assert tags["追高"]["trade_count"] == 1
    assert tags["追高"]["total_profit"] == -400.0
    # master dataset trades never leak in
    assert all(row["tag"] != "回踩" or row["trade_count"] == 2 for row in body["self"])
    assert body["sim"] == []


def test_by_setup_with_sim_comparison(client, db_session):
    _make_world(db_session)
    res = client.get("/api/analysis/by-setup", params={"include_sim": True})
    body = res.json()
    assert body["sim"] == []


def test_by_error_accumulates_costs(client, db_session):
    _make_world(db_session)
    res = client.get("/api/analysis/by-error")
    body = res.json()
    tags = {row["tag"]: row for row in body["self"]}
    assert tags["追高"]["trade_count"] == 1
    assert tags["追高"]["total_profit"] == -400.0
    assert tags["没止损"]["trade_count"] == 1


def test_r_distribution_buckets_and_without_stop(client, db_session):
    _make_world(db_session)
    res = client.get("/api/analysis/r-distribution")
    body = res.json()
    self_block = body["self"]
    # t1: risk = 6000 × |60000-59000|/60000 = 100 → R = 5.0 → ≥3 bucket
    # t3: risk = 5900 × |59000-58500|/59000 = 50 → R = 5.0 → ≥3 bucket
    buckets = {b["bucket"]: b["count"] for b in self_block["buckets"]}
    assert buckets["≥3"] == 2
    assert self_block["without_stop"] == 0
    assert self_block["avg_r"] == 5.0
    # t2 has no planned stop but also no... it does have an annotation; without margin
    # or stop it is excluded from buckets entirely
    assert sum(b["count"] for b in self_block["buckets"]) == 2


def test_discipline_rate(client, db_session):
    _make_world(db_session)
    res = client.get("/api/analysis/discipline")
    body = res.json()
    self_block = body["self"]
    assert self_block["annotated"] == 3
    assert self_block["clean"] == 2
    assert self_block["with_error"] == 1
    assert self_block["unannotated"] == 0


def test_checklists_shape(client):
    res = client.get("/api/analysis/checklists")
    assert res.status_code == 200
    data = res.json()["data"]
    cadences = {row["cadence"] for row in data}
    assert cadences == {"daily", "weekly", "monthly"}
    for row in data:
        assert row["questions"]


def test_review_upsert_and_list(client, db_session):
    payload = {"cadence": "daily", "period_key": "2026-08-29", "content": "今天没追高，保持。"}
    res = client.put("/api/reviews", json=payload)
    assert res.status_code == 200
    first = res.json()

    # upsert same period → replace, not duplicate
    res2 = client.put("/api/reviews", json={**payload, "content": "改成：明天少做多看。"})
    assert res2.status_code == 200
    assert db_session.query(ReviewNote).count() == 1
    assert res2.json()["content"] == "改成：明天少做多看。"

    res_list = client.get("/api/reviews", params={"cadence": "daily"})
    assert res_list.status_code == 200
    rows = res_list.json()["data"]
    assert len(rows) == 1
    assert rows[0]["id"] == first["id"]

    res_bad = client.put("/api/reviews", json={"cadence": "hourly", "period_key": "x", "content": "y"})
    assert res_bad.status_code == 400
