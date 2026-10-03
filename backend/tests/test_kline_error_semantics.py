"""Exchange-facing kline semantics: 400 unknown symbol, 404 empty range, 502 transport.

Those three codes drive the frontend retry loop (fetchKlines only retries 5xx), so
mislabeling an empty range as a failure both hides the truth and re-asks an exchange
that will never have the data.
"""

import ccxt
import pytest
import threading
import time

from models import Kline
from services.kline_service import KlineService

STEP = 15 * 60 * 1000
START = 1785914100000  # 2026-08-04, comfortably in the past so ranges stay "closed"
END = START + 10 * STEP


class FakeExchange:
    """Minimal ccxt stand-in: rows to return, or the error to raise."""

    def __init__(self, exchange_id="fake", rows=None, error=None):
        self.id = exchange_id
        self._rows = rows or []
        self._error = error
        self.calls = 0
        # Non-empty: KlineService._ensure_markets must not try to load real markets here.
        self.markets = {"FAKE/USDT:USDT": {}}

    def fetch_ohlcv(self, symbol, timeframe, since=None, limit=None):
        self.calls += 1
        if self._error is not None:
            raise self._error
        return [list(row) for row in self._rows]


def _service(*exchanges) -> KlineService:
    """Bypass __init__ so the test never builds real ccxt clients or touches the network."""
    svc = KlineService.__new__(KlineService)
    svc.exchanges = list(exchanges)
    svc._empty_gaps = set()
    svc._markets_lock = threading.Lock()
    return svc


def _rows(count: int = 11) -> list[list]:
    return [[START + i * STEP, 1.0, 2.0, 0.5, 1.5, 10.0] for i in range(count)]


def test_unknown_symbol_raises_bad_symbol(db_session):
    """main.py maps ccxt.BadSymbol to 400; the client must not retry it."""
    svc = _service(
        FakeExchange("okx", error=ccxt.BadSymbol("no such market")),
        FakeExchange("gate", error=ccxt.BadSymbol("no such market")),
    )
    with pytest.raises(ccxt.BadSymbol):
        svc.fetch_klines_range(db_session, "NOSUCHCOIN-USDT", "15m", limit=500, start_ts=START, end_ts=END)


def test_bad_symbol_wins_over_another_exchanges_451(db_session):
    """A blocked exchange must not turn "this symbol will never work" into a retryable 502."""
    svc = _service(
        FakeExchange("okx", error=ccxt.BadSymbol("no such market")),
        FakeExchange("gate", error=ccxt.BadSymbol("no such market")),
        FakeExchange("binance", error=ccxt.ExchangeNotAvailable("451 restricted location")),
    )
    with pytest.raises(ccxt.BadSymbol):
        svc.fetch_klines_range(db_session, "NOSUCHCOIN-USDT", "15m", limit=500, start_ts=START, end_ts=END)


def test_empty_answer_is_an_answer_and_is_memoized(db_session):
    exchange = FakeExchange("gate", rows=[])
    svc = _service(exchange)

    assert svc.fetch_klines_range(db_session, "ETH-USDT", "15m", limit=500, start_ts=START, end_ts=END) == []
    assert svc._empty_gaps, "an answered-empty range must not be re-asked on every request"

    asked = exchange.calls
    assert svc.fetch_klines_range(db_session, "ETH-USDT", "15m", limit=500, start_ts=START, end_ts=END) == []
    assert exchange.calls == asked


def test_answered_empty_beats_another_exchanges_transport_failure(db_session):
    """Regression: with binance always 451-ing, an empty range used to surface as 502."""
    svc = _service(
        FakeExchange("okx", rows=[]),
        FakeExchange("binance", error=ccxt.ExchangeNotAvailable("451 restricted location")),
    )
    assert svc.fetch_klines_range(db_session, "ETH-USDT", "15m", limit=500, start_ts=START, end_ts=END) == []


def test_transport_failure_alone_still_raises(db_session):
    """Nobody answered, so the 502 (and the client's retry) is the honest outcome."""
    svc = _service(FakeExchange("gate", error=ccxt.ExchangeNotAvailable("451 restricted location")))
    with pytest.raises(ccxt.ExchangeNotAvailable):
        svc.fetch_klines_range(db_session, "ETH-USDT", "15m", limit=500, start_ts=START, end_ts=END)


def test_fallback_exchange_fills_the_gap_and_records_its_source(db_session):
    svc = _service(
        FakeExchange("okx", error=ccxt.BadSymbol("no such market")),
        FakeExchange("gate", rows=_rows()),
    )
    bars = svc.fetch_klines_range(db_session, "ETH-USDT", "15m", limit=500, start_ts=START, end_ts=END)

    assert len(bars) == 11
    assert bars[0]["close"] == 1.5
    sources = {row.source for row in db_session.query(Kline).all()}
    assert sources == {"gate"}


def test_cached_range_never_calls_an_exchange(db_session):
    exchange = FakeExchange("gate", rows=_rows())
    svc = _service(exchange)
    svc.fetch_klines_range(db_session, "ETH-USDT", "15m", limit=500, start_ts=START, end_ts=END)

    asked = exchange.calls
    bars = svc.fetch_klines_range(db_session, "ETH-USDT", "15m", limit=500, start_ts=START, end_ts=END)
    assert len(bars) == 11
    assert exchange.calls == asked


def test_markets_load_once_when_the_warmup_and_a_request_race():
    """gate's load_markets takes ~19s; two concurrent copies would double the stall."""

    class SlowExchange:
        id = "slow"

        def __init__(self):
            self.markets = {}
            self.loads = 0

        def load_markets(self):
            self.loads += 1
            time.sleep(0.2)
            self.markets = {"ETH/USDT:USDT": {}}

    exchange = SlowExchange()
    svc = _service(exchange)
    threads = [threading.Thread(target=svc._ensure_markets, args=(exchange,)) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert exchange.loads == 1
