from sqlalchemy import Column, Integer, String, Float, BigInteger, Index, ForeignKey, DateTime, Boolean, Text
from sqlalchemy.sql import func
from database import Base

# Annotation subjects: a locally imported trade or a synced master delivery slip.
SUBJECT_TRADE = "trade"
SUBJECT_MASTER_POSITION = "master_position"


class Dataset(Base):
    __tablename__ = "datasets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(128), nullable=False, unique=True)
    # Trade subject: self (own trades) | master:{trader_id} | sim (training replay)
    owner = Column(String(64), nullable=False, default="self", server_default="self")
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
    # Which exchange produced this candle; NULL for rows cached before the column existed.
    source = Column(String(16), nullable=True)

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


class TradeAnnotation(Base):
    """Per-position replay annotation bound to the position itself (docs/DESIGN.md §6)."""

    __tablename__ = "trade_annotations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    subject_type = Column(String(16), nullable=False, default=SUBJECT_TRADE)  # trade | master_position
    subject_id = Column(Integer, nullable=False)
    note = Column(Text, nullable=True)
    setup_tags = Column(Text, nullable=True)  # JSON array
    error_tags = Column(Text, nullable=True)  # JSON array
    grade = Column(String(4), nullable=True)  # A+ | A | B | C
    emotion = Column(String(16), nullable=True)
    planned_stop = Column(Float, nullable=True)
    planned_target = Column(Float, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_annotation_subject", "subject_type", "subject_id", unique=True),
    )


class ChartDrawing(Base):
    """Chart drawing bound to symbol + time region, independent of any position (docs/DESIGN.md §6)."""

    __tablename__ = "chart_drawings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(32), nullable=False, index=True)
    kind = Column(String(8), nullable=False)  # hline | trend | region | fib
    payload = Column(Text, nullable=False)  # JSON: [{time_ms, price}, ...]
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ReviewNote(Base):
    """Review-cadence note on a global timeline, independent of datasets (docs/PRODUCT.md §三)."""

    __tablename__ = "review_notes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    cadence = Column(String(8), nullable=False)  # daily | weekly | monthly
    period_key = Column(String(16), nullable=False)  # 2026-08-29 | 2026-W35 | 2026-08
    content = Column(Text, nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_review_period", "cadence", "period_key", unique=True),
    )


class MasterTrader(Base):
    """Futures Master Trader Profile (币安合约跟单顶级交易员)"""

    __tablename__ = "master_traders"

    id = Column(String(64), primary_key=True)
    nickname = Column(String(128), nullable=False, index=True)
    market = Column(String(16), default="futures", nullable=False)
    avatar_url = Column(String(512), nullable=True)
    roi = Column(Float, nullable=True)
    pnl = Column(Float, nullable=True)
    mdd = Column(Float, nullable=True)
    win_rate = Column(Float, nullable=True)
    sharp_ratio = Column(Float, nullable=True)
    trading_days = Column(Integer, nullable=True)
    badge = Column(String(32), nullable=True)
    # equity_chart powers the master list sparkline + detail panel curve; the
    # 30d/90d variants and the copy-count/AUM columns never reached the UI.
    equity_chart = Column(Text, nullable=True)
    detail_url = Column(String(512), nullable=True)
    has_positions = Column(Boolean, default=False, nullable=False, index=True)
    position_count = Column(Integer, default=0, nullable=False)


class MasterPosition(Base):
    """Futures Master Trader Delivery Slip Position (合约交割单真实仓位)"""

    __tablename__ = "master_positions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    position_id = Column(String(64), nullable=True, index=True)
    trader_id = Column(String(64), ForeignKey("master_traders.id", ondelete="CASCADE"), nullable=False, index=True)
    symbol = Column(String(32), nullable=False, index=True)
    side = Column(String(8), nullable=False)  # LONG | SHORT
    margin_mode = Column(String(16), nullable=True)  # Cross | Isolated
    leverage = Column(Float, default=20.0)
    entry_price = Column(Float, nullable=False)
    close_price = Column(Float, nullable=True)
    pnl = Column(Float, nullable=True)
    roi = Column(Float, nullable=True)
    opened_at = Column(BigInteger, nullable=False, index=True)
    closed_at = Column(BigInteger, nullable=True, index=True)
    max_amount = Column(Float, nullable=True)
    closed_amount = Column(Float, nullable=True)
    status = Column(String(32), nullable=True)

    __table_args__ = (
        Index("ix_master_pos_sym_opened", "symbol", "opened_at"),
        Index("ix_master_pos_trader_opened", "trader_id", "opened_at"),
    )