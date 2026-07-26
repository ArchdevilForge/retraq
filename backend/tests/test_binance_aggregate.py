import pytest

from services.binance_trade_aggregate import Fill, aggregate_fills_to_trades, normalize_side


def _fill(time_ms, side, price, qty, pnl=0.0, symbol="BTCUSDT"):
    return Fill(
        time_ms=time_ms, symbol=symbol, side=side, price=price, qty=qty, realized_pnl=pnl
    )


def test_long_round_trip():
    fills = [
        Fill(time_ms=1000, symbol="BTCUSDT", side="BUY", price=100.0, qty=1.0, realized_pnl=0.0),
        Fill(time_ms=2000, symbol="BTCUSDT", side="SELL", price=110.0, qty=1.0, realized_pnl=10.0),
    ]
    trades = aggregate_fills_to_trades(fills)
    assert len(trades) == 1
    t = trades[0]
    assert t.direction == "long"
    assert t.entry_price == 100.0
    assert t.exit_price == 110.0
    assert t.profit == 10.0
    assert t.exit_time == 2000


def test_short_round_trip():
    fills = [
        _fill(1000, "SELL", 110.0, 1.0),
        _fill(2000, "BUY", 100.0, 1.0, pnl=10.0),
    ]
    trades = aggregate_fills_to_trades(fills)
    assert len(trades) == 1
    t = trades[0]
    assert t.direction == "short"
    assert t.entry_price == 110.0
    assert t.exit_price == 100.0
    assert t.profit == 10.0
    assert t.entry_time == 1000
    assert t.exit_time == 2000


def test_partial_close_keeps_whole_cycle_vwap():
    """A cycle closed in two legs must average both, not report only the last leg."""
    fills = [
        _fill(1000, "BUY", 100.0, 10.0),
        _fill(2000, "SELL", 150.0, 9.0, pnl=450.0),
        _fill(3000, "SELL", 101.0, 1.0, pnl=1.0),
    ]
    trades = aggregate_fills_to_trades(fills)
    assert len(trades) == 1
    t = trades[0]
    assert t.direction == "long"
    assert t.entry_price == pytest.approx(100.0)
    assert t.exit_price == pytest.approx(145.1)
    assert t.margin == pytest.approx(1000.0)
    assert t.entry_time == 1000
    assert t.exit_time == 3000
    assert t.profit == pytest.approx(451.0)


def test_scale_in_averages_entry_and_exit():
    fills = [
        _fill(1000, "BUY", 100.0, 1.0),
        _fill(2000, "BUY", 102.0, 1.0),
        _fill(3000, "SELL", 110.0, 1.0, pnl=10.0),
        _fill(4000, "SELL", 112.0, 1.0, pnl=10.0),
    ]
    trades = aggregate_fills_to_trades(fills)
    assert len(trades) == 1
    t = trades[0]
    assert t.entry_price == pytest.approx(101.0)
    assert t.exit_price == pytest.approx(111.0)
    assert t.margin == pytest.approx(202.0)


def test_position_flip_emits_two_trades():
    """SELL 2 closes the long and opens a short; both cycles must surface.

    Before the fix the excess quantity was dropped and this returned [].
    """
    fills = [
        _fill(1000, "BUY", 100.0, 1.0),
        _fill(2000, "SELL", 110.0, 2.0, pnl=10.0),
        _fill(3000, "BUY", 105.0, 1.0, pnl=5.0),
    ]
    trades = aggregate_fills_to_trades(fills)
    assert len(trades) == 2

    long_leg, short_leg = trades
    assert long_leg.direction == "long"
    assert long_leg.entry_price == pytest.approx(100.0)
    assert long_leg.exit_price == pytest.approx(110.0)
    assert long_leg.entry_time == 1000
    assert long_leg.exit_time == 2000

    assert short_leg.direction == "short"
    assert short_leg.entry_price == pytest.approx(110.0)
    assert short_leg.exit_price == pytest.approx(105.0)
    assert short_leg.entry_time == 2000
    assert short_leg.exit_time == 3000
    assert short_leg.profit == pytest.approx(5.0)


def test_open_position_emits_nothing():
    trades = aggregate_fills_to_trades([_fill(1000, "BUY", 100.0, 1.0)])
    assert trades == []


def test_symbols_are_aggregated_independently():
    fills = [
        _fill(1000, "BUY", 100.0, 1.0, symbol="BTCUSDT"),
        _fill(1500, "SELL", 2000.0, 1.0, symbol="ETHUSDT"),
        _fill(2000, "SELL", 110.0, 1.0, pnl=10.0, symbol="BTCUSDT"),
        _fill(2500, "BUY", 1900.0, 1.0, pnl=100.0, symbol="ETHUSDT"),
    ]
    trades = aggregate_fills_to_trades(fills)
    assert {t.symbol for t in trades} == {"BTCUSDT", "ETHUSDT"}
    assert len(trades) == 2


def test_profit_rate_is_return_on_margin_not_price_move():
    """Realized pnl is net of fees, so it must not be re-derived from the prices."""
    fills = [
        _fill(1000, "BUY", 100.0, 2.0),
        _fill(2000, "SELL", 120.0, 2.0, pnl=35.0),
    ]
    t = aggregate_fills_to_trades(fills)[0]
    assert t.margin == pytest.approx(200.0)
    assert t.profit == pytest.approx(35.0)
    assert t.profit_rate == pytest.approx(t.profit / t.margin)
    assert t.profit_rate == pytest.approx(0.175)
    price_move = (t.exit_price - t.entry_price) / t.entry_price
    assert t.profit_rate != pytest.approx(price_move)


def test_profit_rate_is_none_without_margin():
    fills = [
        _fill(1000, "BUY", 0.0, 1.0),
        _fill(2000, "SELL", 110.0, 1.0, pnl=110.0),
    ]
    trades = aggregate_fills_to_trades(fills)
    assert len(trades) == 1
    assert trades[0].margin == 0.0
    assert trades[0].profit_rate is None


@pytest.mark.parametrize("token", ["BUY", "buy", "买入", "买", "开多", "平空", "LONG"])
def test_normalize_side_buy_tokens(token):
    assert normalize_side(token) == "BUY"


@pytest.mark.parametrize("token", ["SELL", "sell", "卖出", "卖", "开空", "平多", "SHORT"])
def test_normalize_side_sell_tokens(token):
    assert normalize_side(token) == "SELL"


def test_normalize_side_unknown_raises():
    with pytest.raises(ValueError):
        normalize_side("HODL")


def test_chinese_side_tokens_aggregate_like_english():
    fills = [
        _fill(1000, "买入", 100.0, 1.0),
        _fill(2000, "卖出", 110.0, 1.0, pnl=10.0),
    ]
    trades = aggregate_fills_to_trades(fills)
    assert len(trades) == 1
    assert trades[0].direction == "long"
    assert trades[0].exit_price == pytest.approx(110.0)
