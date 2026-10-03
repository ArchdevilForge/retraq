"""Tests for the incremental Binance sync service (mocked exchange)."""

import pytest

from models import Dataset, TradeFill
from services.binance_sync_service import BinanceSyncService, _rebuild_trades


class FakeExchange:
    """fetch_income → symbol discovery; fetch_my_trades → canned fills."""

    def __init__(self, incomes, trades):
        self._incomes = incomes
        self._trades = trades
        self.rateLimit = 1

    def fapiPrivateGetIncome(self, params=None):
        return self._incomes

    def fetch_my_trades(self, symbol, since=None, limit=None):
        return self._trades.get(symbol, [])


def _fill(trade_id, ts, side, price, qty, pnl):
    return {
        "id": trade_id,
        "info": {"realizedPnl": str(pnl)},
        "side": side,
        "price": price,
        "amount": qty,
        "timestamp": ts,
    }


def test_sync_requires_credentials(db_session):
    import services.binance_sync_service as svc

    orig = svc.get_credentials
    svc.get_credentials = lambda: None
    try:
        with pytest.raises(ValueError):
            BinanceSyncService().sync(db_session)
    finally:
        svc.get_credentials = orig


def test_sync_creates_dataset_and_round_trips(db_session, monkeypatch):
    import services.binance_sync_service as svc

    monkeypatch.setattr(svc, "get_credentials", lambda: ("k", "s"))
    exchange = FakeExchange(
        incomes=[{"symbol": "BTC/USDT:USDT"}],
        trades={
            "BTC/USDT:USDT": [
                _fill("t1", 1700000000000, "buy", 60000.0, 1.0, 0.0),   # open long
                _fill("t2", 1700003600000, "sell", 61000.0, 1.0, 100.0),  # close → +100
            ],
        },
    )

    result = BinanceSyncService().sync(db_session, exchange=exchange)
    assert result["success"] is True
    assert result["new_fills"] == 2
    assert result["trade_count"] == 1

    ds = db_session.query(Dataset).filter(Dataset.id == result["dataset_id"]).one()
    assert ds.owner == "self"
    trade = db_session.query(TradeFill).filter(TradeFill.dataset_id == ds.id).count()
    assert trade == 2


def test_sync_is_incremental_and_dedupes(db_session, monkeypatch):
    import services.binance_sync_service as svc

    monkeypatch.setattr(svc, "get_credentials", lambda: ("k", "s"))
    fills = [
        _fill("t1", 1700000000000, "buy", 60000.0, 1.0, 0.0),
        _fill("t2", 1700003600000, "sell", 61000.0, 1.0, 100.0),
    ]
    exchange = FakeExchange(incomes=[{"symbol": "BTC/USDT:USDT"}], trades={"BTC/USDT:USDT": fills})

    first = BinanceSyncService().sync(db_session, exchange=exchange)
    assert first["new_fills"] == 2

    # Same fills again → nothing new
    second = BinanceSyncService().sync(db_session, exchange=exchange)
    assert second["new_fills"] == 0
    # Plus one extra fill → only that one is stored
    fills.append(_fill("t3", 1700007200000, "sell", 61500.0, 1.0, -20.0))
    third = BinanceSyncService().sync(db_session, exchange=exchange)
    assert third["new_fills"] == 1


def test_rebuild_trades_keeps_trade_ids_stable(db_session):
    """Re-aggregation upserts by natural key so annotation subject ids survive."""
    from models import Trade

    ds = Dataset(name="币安合约 (自动同步)", owner="self")
    db_session.add(ds)
    db_session.flush()

    db_session.add_all(
        [
            TradeFill(dataset_id=ds.id, symbol="BTC-USDT", side="BUY", price=60000.0, qty=1.0,
                      time_ms=1700000000000, realized_pnl=0.0, order_id="t1"),
            TradeFill(dataset_id=ds.id, symbol="BTC-USDT", side="SELL", price=61000.0, qty=1.0,
                      time_ms=1700003600000, realized_pnl=100.0, order_id="t2"),
        ]
    )
    db_session.commit()
    _rebuild_trades(db_session, ds)
    first = db_session.query(Trade).filter(Trade.dataset_id == ds.id).one()
    first_id = first.id
    assert first.profit == 100.0

    # Rebuild again with identical fills → same row, not a new one
    _rebuild_trades(db_session, ds)
    rows = db_session.query(Trade).filter(Trade.dataset_id == ds.id).all()
    assert len(rows) == 1
    assert rows[0].id == first_id
