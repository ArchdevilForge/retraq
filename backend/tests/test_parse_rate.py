"""收益率 is a decimal ratio of return-on-margin (保证金*收益率=收益 in the langge sheet)."""
import os

import pandas as pd
import pytest

from models import Trade
from services.trade_importer import TradeImporter, trade_importer


def test_parse_rate_percent_string():
    imp = TradeImporter()
    assert imp._parse_rate("10%") == 0.1


def test_parse_rate_decimal_string():
    imp = TradeImporter()
    assert imp._parse_rate("0.1") == 0.1


def test_parse_rate_decimal():
    imp = TradeImporter()
    assert imp._parse_rate(0.1) == 0.1


def test_parse_rate_sample_row_is_kept_as_ratio():
    # samples/bit-langge-delivery-example.xlsx first row: 收益率 0.2264 means +22.64%
    imp = TradeImporter()
    assert imp._parse_rate(0.2264) == 0.2264


def test_parse_rate_above_one_is_not_divided():
    """Real >100% rows: 933*1.4855≈1387 and 2833*3.7011≈10500 in the sample sheet.

    The old heuristic divided any number >1 by 100 and silently destroyed these.
    """
    imp = TradeImporter()
    assert imp._parse_rate(1.4855) == 1.4855
    assert imp._parse_rate(3.7011) == 3.7011


def test_parse_rate_none():
    imp = TradeImporter()
    assert imp._parse_rate(pd.NA) is None


def test_parse_rate_unparseable_string():
    imp = TradeImporter()
    assert imp._parse_rate("暂无") is None


SAMPLE_LANGGE = os.path.join(
    os.path.dirname(__file__), "..", "..", "samples", "bit-langge-delivery-example.xlsx"
)


def _import_sample(db_session, dataset):
    if not os.path.isfile(SAMPLE_LANGGE):
        pytest.skip(f"sample workbook missing: {SAMPLE_LANGGE}")
    trade_importer.parse_file(db_session, SAMPLE_LANGGE, dataset.id, "langge")
    db_session.flush()
    return (
        db_session.query(Trade)
        .filter(Trade.profit_rate.isnot(None))
        .all()
    )


def test_imported_sample_rates_are_passed_through_unscaled(db_session, dataset):
    """Import must store 收益率 verbatim; the old /100 heuristic rewrote every row >1."""
    rows = _import_sample(db_session, dataset)
    assert len(rows) > 100

    sheet = pd.read_excel(SAMPLE_LANGGE, engine="openpyxl", header=0)
    sheet_rates = {
        round(v, 6)
        for v in pd.to_numeric(sheet["收益率"], errors="coerce").dropna().tolist()
    }
    stored_rates = {round(t.profit_rate, 6) for t in rows}
    assert stored_rates <= sheet_rates

    assert round(1.4855, 6) in stored_rates
    assert round(3.7011, 6) in stored_rates
    assert max(stored_rates) > 1, "a >100% row must stay >1 after import"


def test_imported_sample_over_100_percent_rows_keep_margin_identity(db_session, dataset):
    """保证金（最大时）* 收益率 = 收益 (USDT), i.e. the rate is a ratio, not a percent.

    The workbook rounds its own columns, so this compares the two competing
    readings instead of demanding an exact match: read as a ratio the identity
    is essentially exact, read as a whole percent every row is ~99% wrong.
    """
    rows = [
        t
        for t in _import_sample(db_session, dataset)
        if t.profit_rate > 1 and t.margin and t.profit
    ]
    assert len(rows) >= 40, "sample must carry enough >100% rows to be meaningful"

    as_ratio = sorted(abs(t.margin * t.profit_rate - t.profit) / abs(t.profit) for t in rows)
    as_percent = [
        abs(t.margin * t.profit_rate / 100 - t.profit) / abs(t.profit) for t in rows
    ]
    assert as_ratio[len(as_ratio) // 2] < 0.01
    assert min(as_percent) > 0.5


# --- _resolve_rate: the two exporters disagree on what 收益率 means ---------------------

def test_resolve_rate_keeps_a_ratio_sheet_verbatim():
    """samples/bit-langge: 265 / 1170 = 0.2265, the sheet wrote 0.2264."""
    imp = TradeImporter()
    assert imp._resolve_rate(0.2264, 265.0, 1170.0) == 0.2264


def test_resolve_rate_scales_a_percent_sheet():
    """A live 交割单: 3030.48 / 1399.88 = 2.1648, the sheet wrote 216.48."""
    imp = TradeImporter()
    assert imp._resolve_rate(216.480898, 3030.47919674, 1399.8829528592) == pytest.approx(
        2.16480898, rel=1e-6
    )
    assert imp._resolve_rate(86.353345, 419.78951687, 486.13) == pytest.approx(0.86353345, rel=1e-6)
    assert imp._resolve_rate(5.0, 150.0, 3000.0) == pytest.approx(0.05, rel=1e-6)


def test_resolve_rate_never_invents_a_number_when_the_identity_is_noisy():
    """Fees/funding make both readings fail; the platform's own number stays."""
    imp = TradeImporter()
    assert imp._resolve_rate(1.4855, 100.0, 933.0) == 1.4855


def test_resolve_rate_without_margin_falls_back_to_the_parsed_value():
    imp = TradeImporter()
    assert imp._resolve_rate("10%", 100.0, None) == 0.1
    assert imp._resolve_rate(0.2264, None, 1170.0) == 0.2264
    assert imp._resolve_rate(pd.NA, 100.0, 1170.0) is None


def test_resolve_rate_property_matches_every_real_percent_row():
    """The shipped DB rows are percent-style: profit/margin x 100 == the stored value."""
    imp = TradeImporter()
    for profit, margin, stored_percent in (
        (331.42503082, 3658.382352941176, 9.059332000000001),
        (3030.47919674, 1399.8829528592, 216.48089800000002),
        (1483.99347406, 449.9306019954, 329.82719199999997),
    ):
        resolved = imp._resolve_rate(stored_percent, profit, margin)
        # The sheet rounds 收益率 to 6 decimals, so compare as units, not to the last digit.
        assert resolved == pytest.approx(profit / margin, rel=1e-5)
