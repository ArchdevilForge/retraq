import os

import ccxt
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session
from models import Kline

TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d"]
TIMEFRAME_MS = {
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
}


class KlineService:
    def __init__(self):
        self.exchanges: list[object] = []
        exchange_ids = os.getenv("KLINE_EXCHANGES", "okx,binance")
        for exchange_id in [x.strip() for x in exchange_ids.split(",") if x.strip()]:
            exchange_factory = getattr(ccxt, exchange_id, None)
            if exchange_factory is None:
                continue
            try:
                self.exchanges.append(exchange_factory({"enableRateLimit": True}))
            except Exception:
                continue

    def fetch_klines(
        self, db: Session, symbol: str, timeframe: str, limit: int = 500
    ) -> list[dict]:
        return self.fetch_klines_range(db, symbol, timeframe, limit=limit)

    def _query_range(
        self,
        db: Session,
        symbol: str,
        timeframe: str,
        start_ts: int,
        end_ts: int,
    ) -> list[Kline]:
        return (
            db.query(Kline)
            .filter(Kline.symbol == symbol, Kline.timeframe == timeframe)
            .filter(Kline.timestamp >= start_ts, Kline.timestamp <= end_ts)
            .order_by(Kline.timestamp.asc())
            .all()
        )

    def _range_is_covered(self, cached: list[Kline], start_ts: int, end_ts: int, step_ms: int) -> bool:
        if not cached:
            return False
        if cached[0].timestamp > start_ts:
            return False
        if cached[-1].timestamp < end_ts:
            return False
        prev = cached[0].timestamp
        for item in cached[1:]:
            ts = item.timestamp
            if ts <= prev:
                continue
            if ts - prev != step_ms:
                return False
            prev = ts
        return True

    def _store_ohlcv(self, db: Session, symbol: str, timeframe: str, ohlcv: list[list]) -> None:
        if not ohlcv:
            return

        rows = [
            {
                "symbol": symbol,
                "timeframe": timeframe,
                "timestamp": candle[0],
                "open": candle[1],
                "high": candle[2],
                "low": candle[3],
                "close": candle[4],
                "volume": candle[5],
            }
            for candle in ohlcv
        ]

        stmt = sqlite_insert(Kline).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["symbol", "timeframe", "timestamp"],
            set_={
                "open": stmt.excluded.open,
                "high": stmt.excluded.high,
                "low": stmt.excluded.low,
                "close": stmt.excluded.close,
                "volume": stmt.excluded.volume,
            },
        )
        db.execute(stmt)

    def _fetch_and_store_range(
        self,
        exchange,
        db: Session,
        symbol: str,
        timeframe: str,
        limit: int,
        start_ts: int,
        end_ts: int,
        step_ms: int,
    ) -> None:
        ccxt_symbol = symbol.replace("-", "/")
        since = start_ts
        last_ts = None
        max_batch = int((end_ts - start_ts) // (step_ms * max(1, min(limit, 500)))) + 4
        max_batch = min(500, max(4, max_batch))

        for _ in range(max_batch):
            if since > end_ts:
                break
            ohlcv = exchange.fetch_ohlcv(ccxt_symbol, timeframe, since=since, limit=min(limit, 500))
            if not ohlcv:
                break

            batch_min_ts = ohlcv[0][0]
            batch_last_ts = ohlcv[-1][0]
            if batch_min_ts > end_ts or batch_last_ts < start_ts:
                break

            filtered = [c for c in ohlcv if start_ts <= c[0] <= end_ts]
            if filtered:
                self._store_ohlcv(db, symbol, timeframe, filtered)

            if last_ts is not None and batch_last_ts <= last_ts:
                break
            last_ts = batch_last_ts
            since = batch_last_ts + step_ms
            if batch_last_ts >= end_ts - step_ms:
                break

        db.commit()

    def _align_range(self, start_ts: int, end_ts: int, step_ms: int) -> tuple[int, int]:
        aligned_start = (start_ts // step_ms) * step_ms
        aligned_end = ((end_ts + step_ms - 1) // step_ms) * step_ms
        return aligned_start, aligned_end

    def _find_missing_ranges(
        self,
        cached: list[Kline],
        start_ts: int,
        end_ts: int,
        step_ms: int,
    ) -> list[tuple[int, int]]:
        if not cached:
            return [(start_ts, end_ts)]

        missing: list[tuple[int, int]] = []
        first_ts = int(cached[0].timestamp)
        if first_ts > start_ts:
            gap_end = first_ts - step_ms
            if start_ts <= gap_end:
                missing.append((start_ts, gap_end))

        prev_ts = first_ts
        for k in cached[1:]:
            ts = int(k.timestamp)
            if ts <= prev_ts:
                continue
            if ts - prev_ts > step_ms:
                gap_start = prev_ts + step_ms
                gap_end = ts - step_ms
                if gap_start <= gap_end:
                    missing.append((gap_start, gap_end))
            prev_ts = ts

        last_ts = int(cached[-1].timestamp)
        if last_ts < end_ts:
            gap_start = last_ts + step_ms
            if gap_start <= end_ts:
                missing.append((gap_start, end_ts))

        return missing

    def fetch_klines_range(
        self,
        db: Session,
        symbol: str,
        timeframe: str,
        limit: int = 500,
        start_ts: int | None = None,
        end_ts: int | None = None,
        force_refresh: bool = False,
    ) -> list[dict]:
        if timeframe not in TIMEFRAMES:
            raise ValueError(f"Invalid timeframe. Supported: {TIMEFRAMES}")

        step_ms = TIMEFRAME_MS[timeframe]
        last_error: Exception | None = None

        def fetch_latest_from_exchanges() -> list[dict]:
            nonlocal last_error
            ccxt_symbol = symbol.replace("-", "/")
            for exchange in self.exchanges:
                try:
                    ohlcv = exchange.fetch_ohlcv(ccxt_symbol, timeframe, limit=limit)  # type: ignore[attr-defined]
                    self._store_ohlcv(db, symbol, timeframe, ohlcv)
                    db.commit()
                    return [self._candle_to_dict(c) for c in ohlcv]
                except Exception as exc:
                    last_error = exc
                    try:
                        db.rollback()
                    except Exception:
                        pass
            raise last_error or RuntimeError("Failed to fetch klines")

        if start_ts is None and end_ts is None:
            cached = (
                db.query(Kline)
                .filter(Kline.symbol == symbol, Kline.timeframe == timeframe)
                .order_by(Kline.timestamp.desc())
                .limit(limit)
                .all()
            )

            if force_refresh:
                try:
                    return fetch_latest_from_exchanges()
                except RuntimeError:
                    if cached:
                        return [self._to_dict(k) for k in reversed(cached)]
                    raise

            if cached:
                return [self._to_dict(k) for k in reversed(cached)]

            return fetch_latest_from_exchanges()

        if start_ts is None:
            assert end_ts is not None
            start_ts = end_ts - (limit * step_ms)
        if end_ts is None:
            end_ts = start_ts + (limit * step_ms)

        start_ts, end_ts = self._align_range(start_ts, end_ts, step_ms)

        # Check cache
        cached = self._query_range(db, symbol, timeframe, start_ts, end_ts)
        missing = self._find_missing_ranges(cached, start_ts, end_ts, step_ms)
        if not force_refresh and not missing and self._range_is_covered(cached, start_ts, end_ts, step_ms):
            return [self._to_dict(k) for k in cached]

        last_error = None
        for gap_start, gap_end in missing:
            for exchange in self.exchanges:
                try:
                    self._fetch_and_store_range(exchange, db, symbol, timeframe, limit, gap_start, gap_end, step_ms)
                except Exception as exc:
                    last_error = exc
                    try:
                        db.rollback()
                    except Exception:
                        pass
                    continue

                gap_cached = self._query_range(db, symbol, timeframe, gap_start, gap_end)
                if self._range_is_covered(gap_cached, gap_start, gap_end, step_ms):
                    break

        cached = self._query_range(db, symbol, timeframe, start_ts, end_ts)
        if cached:
            return [self._to_dict(k) for k in cached]
        raise last_error or RuntimeError("Failed to fetch klines")

    def _to_dict(self, k: Kline) -> dict:
        return {
            "timestamp": k.timestamp,
            "open": k.open,
            "high": k.high,
            "low": k.low,
            "close": k.close,
            "volume": k.volume,
        }

    def _candle_to_dict(self, c: list) -> dict:
        return {
            "timestamp": c[0],
            "open": c[1],
            "high": c[2],
            "low": c[3],
            "close": c[4],
            "volume": c[5],
        }


kline_service = KlineService()
