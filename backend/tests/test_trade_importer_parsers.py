"""Row-level parsers of TradeImporter: timestamps, direction, synthetic fills."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pandas as pd
import pytest

from models import Trade, TradeFill
from services.trade_importer import TradeImporter

SHANGHAI = ZoneInfo("Asia/Shanghai")


def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def test_naive_timestamp_is_read_as_shanghai():
    imp = TradeImporter()
    got = imp._parse_timestamp(pd.Timestamp("2024-01-01 00:00:00"))
    assert got == _ms(datetime(2024, 1, 1, 0, 0, tzinfo=SHANGHAI))
    # Same wall clock read as UTC would be 8h later; the sheet is UTC+8.
    assert got != _ms(datetime(2024, 1, 1, 0, 0, tzinfo=timezone.utc))


def test_naive_datetime_is_read_as_shanghai():
    imp = TradeImporter()
    got = imp._parse_timestamp(datetime(2024, 1, 1, 0, 0))
    assert got == _ms(datetime(2024, 1, 1, 0, 0, tzinfo=SHANGHAI))


def test_tz_aware_string_is_not_double_shifted():
    """tz_localize on an already-aware value used to raise TypeError."""
    imp = TradeImporter()
    got = imp._parse_timestamp("2024-01-01T00:00:00+00:00")
    assert got == _ms(datetime(2024, 1, 1, 0, 0, tzinfo=timezone.utc))


def test_naive_string_is_read_as_shanghai():
    imp = TradeImporter()
    got = imp._parse_timestamp("2024-01-01 00:00:00")
    assert got == _ms(datetime(2024, 1, 1, 0, 0, tzinfo=SHANGHAI))


@pytest.mark.parametrize("raw", ["", "nan", "not-a-date"])
def test_unparseable_timestamp_strings_return_none(raw):
    imp = TradeImporter()
    assert imp._parse_timestamp(raw) is None


def test_missing_timestamp_returns_none():
    imp = TradeImporter()
    assert imp._parse_timestamp(pd.NaT) is None
    assert imp._parse_timestamp(pd.NA) is None


def test_numeric_epoch_seconds_and_millis():
    imp = TradeImporter()
    assert imp._parse_timestamp(1_700_000_000) == 1_700_000_000_000
    assert imp._parse_timestamp(1_700_000_000_000) == 1_700_000_000_000


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("多", "long"),
        ("做多", "long"),
        ("买入", "long"),
        ("long", "long"),
        ("LONG", "long"),
        ("空", "short"),
        ("做空", "short"),
        ("卖出", "short"),
        ("short", "short"),
        ("SHORT", "short"),
    ],
)
def test_normalize_direction(raw, expected):
    assert TradeImporter()._normalize_direction(raw) == expected


@pytest.mark.parametrize("raw", ["", "横盘", "nan", "unknown"])
def test_normalize_direction_rejects_unknown(raw):
    """Must raise so the caller counts the row failed instead of writing junk."""
    with pytest.raises(ValueError):
        TradeImporter()._normalize_direction(raw)


def _make_trade(db_session, dataset, direction, exit_price=110.0, exit_time=2000):
    trade = Trade(
        dataset_id=dataset.id,
        symbol="BTC-USDT",
        direction=direction,
        entry_price=100.0,
        exit_price=exit_price,
        profit=10.0,
        entry_time=1000,
        exit_time=exit_time,
    )
    db_session.add(trade)
    db_session.flush()
    return trade


def _fills_of(db_session, trade):
    return (
        db_session.query(TradeFill)
        .filter(TradeFill.trade_id == trade.id)
        .order_by(TradeFill.time_ms.asc())
        .all()
    )


def test_synthetic_fills_long_is_buy_then_sell(db_session, dataset):
    trade = _make_trade(db_session, dataset, "long")
    TradeImporter()._attach_synthetic_fills(db_session, dataset.id, trade)
    db_session.flush()

    fills = _fills_of(db_session, trade)
    assert [f.side for f in fills] == ["BUY", "SELL"]
    assert [f.price for f in fills] == [100.0, 110.0]
    assert [f.time_ms for f in fills] == [1000, 2000]
    assert fills[1].realized_pnl == 10.0


def test_synthetic_fills_short_is_sell_then_buy(db_session, dataset):
    trade = _make_trade(db_session, dataset, "short")
    TradeImporter()._attach_synthetic_fills(db_session, dataset.id, trade)
    db_session.flush()

    assert [f.side for f in _fills_of(db_session, trade)] == ["SELL", "BUY"]


def test_open_trade_gets_only_the_entry_fill(db_session, dataset):
    trade = _make_trade(db_session, dataset, "long", exit_price=None, exit_time=None)
    TradeImporter()._attach_synthetic_fills(db_session, dataset.id, trade)
    db_session.flush()

    fills = _fills_of(db_session, trade)
    assert len(fills) == 1
    assert fills[0].side == "BUY"


def test_attach_synthetic_fills_is_idempotent(db_session, dataset):
    imp = TradeImporter()
    trade = _make_trade(db_session, dataset, "long")
    imp._attach_synthetic_fills(db_session, dataset.id, trade)
    db_session.flush()
    imp._attach_synthetic_fills(db_session, dataset.id, trade)
    db_session.flush()

    assert len(_fills_of(db_session, trade)) == 2
