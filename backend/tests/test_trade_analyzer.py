from models import Trade
from services.trade_analyzer import trade_analyzer


def test_calculate_stats_empty(db_session, dataset):
    stats = trade_analyzer.calculate_stats(db_session, dataset.id)
    assert stats["total_pnl"] == 0
    assert stats["win_rate"] == 0
    assert stats["trade_count"] == 0


def test_symbol_distribution_skips_invalid(db_session, dataset):
    db_session.add_all(
        [
            Trade(dataset_id=dataset.id, symbol="YFII-USDT", direction="long", entry_price=1.0, entry_time=1),
            Trade(dataset_id=dataset.id, symbol="BTC-USDT", direction="long", entry_price=1.0, entry_time=2),
        ]
    )
    db_session.commit()

    dist = trade_analyzer.symbol_distribution(db_session, dataset.id)
    assert dist == {"BTC-USDT": 1}
