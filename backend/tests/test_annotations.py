"""Tests for position annotations and chart drawings (docs/DESIGN.md §6)."""

import pytest

from models import ChartDrawing, Dataset, Trade, TradeAnnotation


def test_annotation_get_returns_default_shape(client, db_session):
    res = client.get("/api/annotations/trade/123")
    assert res.status_code == 200
    body = res.json()
    assert body["subject_type"] == "trade"
    assert body["subject_id"] == 123
    assert body["note"] is None
    assert body["setup_tags"] == []
    assert body["grade"] is None


def test_annotation_get_rejects_unknown_subject(client):
    res = client.get("/api/annotations/alien/1")
    assert res.status_code == 400


def test_annotation_upsert_full_replace(client, db_session):
    payload = {
        "note": "回踩确认后进场，执行到位",
        "setup_tags": ["回踩", "关键位狙击"],
        "error_tags": [],
        "grade": "A+",
        "emotion": "冷静",
        "planned_stop": 59000.0,
        "planned_target": 65000.0,
    }
    res = client.put("/api/annotations/trade/123", json=payload)
    assert res.status_code == 200
    body = res.json()
    assert body["note"] == "回踩确认后进场，执行到位"
    assert body["setup_tags"] == ["回踩", "关键位狙击"]
    assert body["grade"] == "A+"
    assert body["planned_stop"] == 59000.0

    row = (
        db_session.query(TradeAnnotation)
        .filter(TradeAnnotation.subject_type == "trade", TradeAnnotation.subject_id == 123)
        .one()
    )
    assert row.grade == "A+"

    # Full replace: clearing fields sticks
    res_clear = client.put(
        "/api/annotations/trade/123",
        json={"note": None, "setup_tags": [], "error_tags": [], "grade": None, "emotion": None,
              "planned_stop": None, "planned_target": None},
    )
    assert res_clear.status_code == 200
    assert res_clear.json()["note"] is None
    assert res_clear.json()["grade"] is None

    # Still exactly one row for the subject
    assert (
        db_session.query(TradeAnnotation)
        .filter(TradeAnnotation.subject_type == "trade", TradeAnnotation.subject_id == 123)
        .count()
        == 1
    )


def test_annotation_upsert_master_position_subject(client, db_session):
    res = client.put(
        "/api/annotations/master_position/7",
        json={"note": None, "setup_tags": ["突破"], "error_tags": [], "grade": "B",
              "emotion": None, "planned_stop": None, "planned_target": None},
    )
    assert res.status_code == 200
    assert res.json()["subject_type"] == "master_position"
    assert res.json()["grade"] == "B"


def test_annotation_presets(client):
    res = client.get("/api/annotations/presets")
    assert res.status_code == 200
    body = res.json()
    assert "追高" in body["error_tags"]
    assert "回踩" in body["setup_tags"]
    assert "A+" in body["grades"]


def test_drawing_create_list_delete(client, db_session):
    res = client.post(
        "/api/drawings",
        json={"symbol": "BTC-USDT", "kind": "hline", "payload": [{"time_ms": 1700000000000, "price": 60000}]},
    )
    assert res.status_code == 200
    drawing = res.json()
    assert drawing["kind"] == "hline"

    res_list = client.get("/api/drawings", params={"symbol": "BTC-USDT"})
    assert res_list.status_code == 200
    assert len(res_list.json()["data"]) == 1

    res_del = client.delete(f"/api/drawings/{drawing['id']}")
    assert res_del.status_code == 200
    assert db_session.query(ChartDrawing).count() == 0

    res_del_again = client.delete(f"/api/drawings/{drawing['id']}")
    assert res_del_again.status_code == 404


@pytest.mark.parametrize(
    "kind,points",
    [("trend", 2), ("region", 2), ("fib", 2)],
)
def test_drawing_two_point_kinds(client, kind, points):
    payload = [
        {"time_ms": 1700000000000 + i * 60000, "price": 60000 + i * 100}
        for i in range(points)
    ]
    res = client.post("/api/drawings", json={"symbol": "ETH-USDT", "kind": kind, "payload": payload})
    assert res.status_code == 200
    assert len(res.json()["payload"]) == points


def test_drawing_validates_shape(client):
    # hline with 2 points → invalid
    res = client.post(
        "/api/drawings",
        json={"symbol": "BTC-USDT", "kind": "hline",
              "payload": [{"time_ms": 1, "price": 1}, {"time_ms": 2, "price": 2}]},
    )
    assert res.status_code == 400

    # bad kind
    res_bad = client.post(
        "/api/drawings",
        json={"symbol": "BTC-USDT", "kind": "spiral", "payload": [{"time_ms": 1, "price": 1}]},
    )
    assert res_bad.status_code == 400

    # non-positive price
    res_zero = client.post(
        "/api/drawings",
        json={"symbol": "BTC-USDT", "kind": "hline", "payload": [{"time_ms": 1, "price": 0}]},
    )
    assert res_zero.status_code == 400


def test_annotation_rejects_unknown_grade(client, db_session):
    """评分 is a closed set (A+ | A | B | C); else the analysis buckets grow junk."""
    res = client.put("/api/annotations/trade/11", json={"grade": "Z"})
    assert res.status_code == 400
    assert db_session.query(TradeAnnotation).filter(TradeAnnotation.subject_id == 11).count() == 0


def test_deleting_a_dataset_drops_its_annotations(client, db_session):
    """(subject_type, subject_id) cannot cascade, so the delete path must clean up."""
    ds = Dataset(name="annotated")
    db_session.add(ds)
    db_session.commit()
    trade = Trade(
        dataset_id=ds.id, symbol="BTC-USDT", direction="long", entry_price=100.0, entry_time=1
    )
    db_session.add(trade)
    db_session.commit()
    client.put(f"/api/annotations/trade/{trade.id}", json={"note": "doomed"})
    assert db_session.query(TradeAnnotation).count() == 1

    assert client.delete(f"/api/datasets/{ds.id}").status_code == 200
    assert db_session.query(TradeAnnotation).count() == 0
