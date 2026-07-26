import pytest

from services.symbol_utils import INVALID_SYMBOLS, is_valid_symbol, normalize_symbol


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("BTCUSDT", "BTC-USDT"),
        ("BTC-USDT", "BTC-USDT"),
        ("BTC-USDT-SWAP", "BTC-USDT"),
        ("btc/usdt", "BTC-USDT"),
        ("  btcusdt  ", "BTC-USDT"),
        ("1000PEPEUSDT", "1000PEPE-USDT"),
        ("BTCUSDC", "BTC-USDC"),
        ("ETHBTC", "ETH-BTC"),
        ("FOO", ""),
        ("", ""),
        ("USDT", ""),
    ],
)
def test_normalize_symbol(raw, expected):
    assert normalize_symbol(raw) == expected


@pytest.mark.parametrize(
    "symbol,expected",
    [
        ("BTC-USDT", True),
        ("1000PEPE-USDT", True),
        ("", False),
        ("BTCUSDT", False),
        ("1000-USDT", False),
        ("BTC-", False),
        ("-USDT", False),
        ("BTC USDT", False),
    ],
)
def test_is_valid_symbol(symbol, expected):
    assert is_valid_symbol(symbol) is expected


def test_blocklisted_symbol_is_rejected():
    assert INVALID_SYMBOLS, "blocklist must not be empty or this test proves nothing"
    for blocked in INVALID_SYMBOLS:
        # shape-wise it would pass every other rule; only the blocklist rejects it
        assert "-" in blocked
        assert is_valid_symbol(blocked) is False


def test_normalized_swap_symbol_is_valid():
    assert is_valid_symbol(normalize_symbol("BTC-USDT-SWAP")) is True
