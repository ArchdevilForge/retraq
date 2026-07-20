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


def test_calculate_stats_trade_count_skips_invalid(db_session, dataset):
    db_session.add_all(
        [
            Trade(
                dataset_id=dataset.id,
                symbol="YFII-USDT",
                direction="long",
                entry_price=1.0,
                profit=1.0,
                entry_time=1,
                exit_time=2,
            ),
            Trade(
                dataset_id=dataset.id,
                symbol="BTC-USDT",
                direction="long",
                entry_price=1.0,
                profit=10.0,
                entry_time=3,
                exit_time=4,
            ),
            Trade(
                dataset_id=dataset.id,
                symbol="ETH-USDT",
                direction="long",
                entry_price=1.0,
                profit=-5.0,
                entry_time=5,
                exit_time=6,
            ),
        ]
    )
    db_session.commit()

    stats = trade_analyzer.calculate_stats(db_session, dataset.id)
    assert stats["trade_count"] == 2
    assert stats["win_rate"] == 50.0
    assert stats["symbol_distribution"] == {"BTC-USDT": 1, "ETH-USDT": 1}
