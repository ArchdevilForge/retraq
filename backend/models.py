from sqlalchemy import Column, Integer, String, Float, BigInteger, Index, ForeignKey, DateTime
from sqlalchemy.sql import func
from database import Base


class Dataset(Base):
    __tablename__ = "datasets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(128), nullable=False, unique=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Kline(Base):
    __tablename__ = "klines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(32), nullable=False)
    timeframe = Column(String(8), nullable=False)
    timestamp = Column(BigInteger, nullable=False)
    open = Column(Float, nullable=False)
    high = Column(Float, nullable=False)
    low = Column(Float, nullable=False)
    close = Column(Float, nullable=False)
    volume = Column(Float, nullable=False)

    __table_args__ = (
        Index("ix_kline_symbol_tf_ts", "symbol", "timeframe", "timestamp", unique=True),
    )


class Trade(Base):
    __tablename__ = "trades"

    id = Column(Integer, primary_key=True, autoincrement=True)
    dataset_id = Column(Integer, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False, index=True)
    symbol = Column(String(32), nullable=False)
    direction = Column(String(8), nullable=False)
    leverage = Column(Float, default=1.0)
    entry_price = Column(Float, nullable=False)
    exit_price = Column(Float)
    profit = Column(Float)
    profit_rate = Column(Float)
    entry_time = Column(BigInteger, nullable=False)
    exit_time = Column(BigInteger)
    margin = Column(Float)

    __table_args__ = (
        Index("ix_trade_symbol", "symbol"),
        Index("ix_trade_dataset_entry", "dataset_id", "entry_time"),
    )


class TradeFill(Base):
    """Per-fill from exchange export (e.g. Binance trade history)."""

    __tablename__ = "trade_fills"

    id = Column(Integer, primary_key=True, autoincrement=True)
    dataset_id = Column(Integer, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False, index=True)
    trade_id = Column(Integer, ForeignKey("trades.id", ondelete="CASCADE"), nullable=True, index=True)
    symbol = Column(String(32), nullable=False)
    side = Column(String(8), nullable=False)  # BUY | SELL
    price = Column(Float, nullable=False)
    qty = Column(Float, nullable=False)
    time_ms = Column(BigInteger, nullable=False)
    realized_pnl = Column(Float, nullable=True)
    order_id = Column(String(64), nullable=True)