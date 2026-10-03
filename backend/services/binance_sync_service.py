"""Incremental Binance futures sync via a read-only API key (docs/PRODUCT.md §四).

Fills are pulled with ccxt (USDT-M futures), stored as TradeFill rows in a
dedicated self-owned dataset, then aggregated into closed round-trip trades
through the existing binance_trade_aggregate. The sync is incremental: it
only fetches fills newer than the newest fill already stored.

Credentials come from BINANCE_API_KEY / BINANCE_API_SECRET (env or backend/.env,
gitignored — never committed, never logged). The key must have read-only
permissions; trading and withdrawal stay impossible by design.
"""

import logging
import os
import time
from pathlib import Path

import ccxt
from sqlalchemy.orm import Session

from models import Dataset, Trade, TradeFill
from services.binance_trade_aggregate import Fill, aggregate_fills_to_trades
from services.symbol_utils import normalize_symbol, is_valid_symbol

logger = logging.getLogger(__name__)

SYNC_DATASET_NAME = "币安合约 (自动同步)"
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
# userTrades/income look back at most ~6 months per query; fetch in bounded page runs.
MAX_PAGE_RUNS = 40
PAGE_LIMIT = 500
INCOME_LOOKBACK_MS = 180 * 24 * 3600 * 1000


def _read_env_file() -> dict[str, str]:
    if not ENV_FILE.is_file():
        return {}
    out: dict[str, str] = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        out[key.strip()] = value.strip().strip("'\"")
    return out


def get_credentials() -> tuple[str, str] | None:
    env = _read_env_file()
    key = os.environ.get("BINANCE_API_KEY") or env.get("BINANCE_API_KEY")
    secret = os.environ.get("BINANCE_API_SECRET") or env.get("BINANCE_API_SECRET")
    if key and secret:
        return key, secret
    return None


def _make_exchange(key: str, secret: str):
    return ccxt.binanceusdm({"apiKey": key, "secret": secret, "enableRateLimit": True})


def _get_or_create_sync_dataset(db: Session) -> Dataset:
    ds = db.query(Dataset).filter(Dataset.name == SYNC_DATASET_NAME).first()
    if ds is None:
        ds = Dataset(name=SYNC_DATASET_NAME, owner="self")
        db.add(ds)
        db.flush()
    return ds


def _existing_fill_ids(db: Session, dataset_id: int) -> set[str]:
    rows = (
        db.query(TradeFill.order_id)
        .filter(TradeFill.dataset_id == dataset_id, TradeFill.order_id.isnot(None))
        .all()
    )
    return {r[0] for r in rows}


def _fetch_symbol_fills(exchange, symbol: str, since_ms: int) -> list[dict]:
    """Page fetchMyTrades forward from since_ms until now or the run cap."""
    out: list[dict] = []
    since = max(0, since_ms)
    for _ in range(MAX_PAGE_RUNS):
        batch = exchange.fetch_my_trades(symbol, since=since, limit=PAGE_LIMIT) or []
        out.extend(batch)
        if len(batch) < PAGE_LIMIT:
            break
        last_ts = max(int(t.get("timestamp") or 0) for t in batch)
        if last_ts <= since:
            break
        since = last_ts + 1
        time.sleep(exchange.rateLimit / 1000)
    return out


def _synced_symbols(db: Session, dataset_id: int) -> list[str]:
    rows = db.query(TradeFill.symbol).filter(TradeFill.dataset_id == dataset_id).distinct().all()
    return [r[0] for r in rows]


def _fetch_income(exchange, since_ms: int) -> list[dict]:
    """Fetch account income across ccxt versions.

    ccxt 4.5.32 exposes Binance's signed income endpoint as a raw method,
    not the unified ``fetch_income`` used by older integrations.
    """
    unified = getattr(exchange, "fetch_income", None)
    if callable(unified):
        return unified(since=since_ms, limit=PAGE_LIMIT) or []

    raw = getattr(exchange, "fapiPrivateGetIncome", None)
    if not callable(raw):
        raise AttributeError("Binance exchange has no income history method")
    return raw({"startTime": since_ms, "limit": PAGE_LIMIT}) or []


def _rebuild_trades(db: Session, dataset: Dataset) -> int:
    """Re-aggregate all stored fills into closed round-trips.

    Upsert by the natural key (dataset, symbol, entry_time) so existing trade
    ids — and therefore their annotations — stay stable across syncs.
    """
    fills = (
        db.query(TradeFill)
        .filter(TradeFill.dataset_id == dataset.id)
        .order_by(TradeFill.time_ms.asc())
        .all()
    )
    agg_fills = [
        Fill(
            time_ms=int(f.time_ms),
            symbol=str(f.symbol),
            side=str(f.side),
            price=float(f.price),
            qty=float(f.qty),
            realized_pnl=float(f.realized_pnl or 0.0),
        )
        for f in fills
    ]
    closed = aggregate_fills_to_trades(agg_fills)

    existing = db.query(Trade).filter(Trade.dataset_id == dataset.id).all()
    by_key = {(str(t.symbol), int(t.entry_time)): t for t in existing}
    seen: set[tuple[str, int]] = set()

    for c in closed:
        key = (c.symbol, c.entry_time)
        seen.add(key)
        row = by_key.get(key)
        if row is None:
            row = Trade(dataset_id=dataset.id)
            # setattr keeps mypy calm about SQLAlchemy's Column[T] descriptors.
            setattr(row, "symbol", c.symbol)
            db.add(row)
        setattr(row, "direction", c.direction)
        setattr(row, "entry_price", c.entry_price)
        setattr(row, "exit_price", c.exit_price)
        setattr(row, "profit", c.profit)
        setattr(row, "profit_rate", c.profit_rate)
        setattr(row, "entry_time", c.entry_time)
        setattr(row, "exit_time", c.exit_time)
        setattr(row, "margin", c.margin)
        setattr(row, "leverage", 1.0)

    # positions no longer present in the aggregate (history rewritten upstream)
    stale = [t for t in existing if (t.symbol, t.entry_time) not in seen]
    for t in stale:
        db.delete(t)

    db.commit()
    return len(closed)


def _to_ccxt_symbol(repo_symbol: str) -> str:
    """Repo symbol 'BTC-USDT' → ccxt USDT-M unified 'BTC/USDT:USDT'."""
    base, quote = repo_symbol.split("-", 1)
    return f"{base}/{quote}:USDT"


class BinanceSyncService:
    def sync(self, db: Session, exchange=None) -> dict:
        creds = get_credentials()
        if creds is None:
            raise ValueError("未配置币安 API Key：请在 backend/.env 写入 BINANCE_API_KEY / BINANCE_API_SECRET（只读权限）")
        exchange = exchange or _make_exchange(*creds)

        dataset = _get_or_create_sync_dataset(db)
        setattr(dataset, "owner", "self")
        db.commit()

        cursor_row = (
            db.query(TradeFill.time_ms)
            .filter(TradeFill.dataset_id == dataset.id)
            .order_by(TradeFill.time_ms.desc())
            .first()
        )
        cursor = int(cursor_row[0]) if cursor_row else 0
        fetch_since = max(0, cursor - 24 * 3600 * 1000)  # overlap window for late fills

        # Discover symbols to query: userTrades needs a symbol, income history
        # is the cross-symbol index of account activity. Keep both the repo
        # form (BTC-USDT) and the ccxt unified form (BTC/USDT:USDT).
        symbols: dict[str, str] = {_to_ccxt_symbol(s): s for s in _synced_symbols(db, int(dataset.id))}
        try:
            income_since = max(fetch_since, int(time.time() * 1000) - INCOME_LOOKBACK_MS)
            incomes = _fetch_income(exchange, income_since)
            for entry in incomes:
                raw = str(entry.get("symbol") or "")
                sym = normalize_symbol(raw.split(":")[0])
                if sym and is_valid_symbol(sym):
                    symbols.setdefault(_to_ccxt_symbol(sym), sym)
        except Exception as e:  # income discovery is best-effort; symbols may overlap
            logger.warning("fetch_income discovery failed: %s", e)

        known_ids = _existing_fill_ids(db, int(dataset.id))
        new_fills = 0
        for ccxt_symbol in sorted(symbols):
            sym = symbols[ccxt_symbol]
            try:
                trades = _fetch_symbol_fills(exchange, ccxt_symbol, fetch_since)
            except Exception as e:
                logger.warning("fetch_my_trades failed for %s: %s", ccxt_symbol, e)
                continue
            rows = []
            for t in trades:
                order_id = str(t.get("id") or "")
                if not order_id or order_id in known_ids:
                    continue
                info = t.get("info") or {}
                realized = float(info.get("realizedPnl") or 0.0)
                rows.append(
                    TradeFill(
                        dataset_id=dataset.id,
                        symbol=sym,
                        side="BUY" if str(t.get("side") or "").upper() == "BUY" else "SELL",
                        price=float(t.get("price") or 0.0),
                        qty=float(t.get("amount") or 0.0),
                        time_ms=int(t.get("timestamp") or 0),
                        realized_pnl=realized,
                        order_id=order_id,
                    )
                )
            if rows:
                db.add_all(rows)
                known_ids.update(str(r.order_id) for r in rows)
                new_fills += len(rows)
        db.commit()

        trade_count = _rebuild_trades(db, dataset)
        return {
            "success": True,
            "dataset_id": dataset.id,
            "dataset_name": dataset.name,
            "new_fills": new_fills,
            "trade_count": trade_count,
        }


binance_sync_service = BinanceSyncService()
