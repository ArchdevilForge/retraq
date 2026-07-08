import pandas as pd

from services.trade_importer import TradeImporter


def test_parse_rate_percent_string():
    imp = TradeImporter()
    assert imp._parse_rate("10%") == 0.1


def test_parse_rate_decimal():
    imp = TradeImporter()
    assert imp._parse_rate(0.1) == 0.1


def test_parse_rate_whole_percent_number():
    imp = TradeImporter()
    assert imp._parse_rate(10) == 0.1


def test_parse_rate_none():
    imp = TradeImporter()
    assert imp._parse_rate(pd.NA) is None
