"""Aggregate Binance futures trade-history fills into closed round-trips."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Fill:
    time_ms: int
    symbol: str
    side: str
    price: float
    qty: float
    realized_pnl: float


@dataclass
class ClosedTrade:
    symbol: str
    direction: str
    entry_price: float
    exit_price: float
    profit: float
    profit_rate: float | None
    entry_time: int
    exit_time: int
    margin: float | None


def _signed_qty(side: str, qty: float) -> float:
    return qty if str(side).upper() == "BUY" else -qty


def aggregate_fills_to_trades(fills: list[Fill]) -> list[ClosedTrade]:
    by_symbol: dict[str, list[Fill]] = {}
    for f in fills:
        by_symbol.setdefault(f.symbol, []).append(f)

    trades: list[ClosedTrade] = []

    for symbol, rows in by_symbol.items():
        rows.sort(key=lambda x: x.time_ms)
        pos = 0.0
        lots: list[dict] = []
        round_pnl = 0.0
        round_entry_time: int | None = None
        round_direction: str | None = None

        def emit_closed(
            entry_qty: float,
            entry_sum: float,
            exit_qty: float,
            exit_sum: float,
            exit_time: int,
        ):
            if entry_qty <= 0 or exit_qty <= 0 or round_direction is None:
                return
            ep = entry_sum / entry_qty
            xp = exit_sum / exit_qty
            if round_direction == "long":
                rate = (xp - ep) / ep if ep else None
            else:
                rate = (ep - xp) / ep if ep else None
            trades.append(
                ClosedTrade(
                    symbol=symbol,
                    direction=round_direction,
                    entry_price=ep,
                    exit_price=xp,
                    profit=round(round_pnl, 8),
                    profit_rate=rate,
                    entry_time=round_entry_time or rows[0].time_ms,
                    exit_time=exit_time,
                    margin=ep * entry_qty,
                )
            )

        for f in rows:
            s = _signed_qty(f.side, f.qty)
            close_qty = abs(s)

            if pos == 0:
                round_pnl = f.realized_pnl
                round_direction = "long" if s > 0 else "short"
                round_entry_time = f.time_ms
                lots = [{"qty": close_qty, "price": f.price}]
                pos = s
                continue

            same_side = (pos > 0 and s > 0) or (pos < 0 and s < 0)
            if same_side:
                round_pnl += f.realized_pnl
                lots.append({"qty": close_qty, "price": f.price})
                pos += s
                continue

            round_pnl += f.realized_pnl
            remaining = close_qty
            entry_sum = 0.0
            entry_qty_acc = 0.0
            exit_sum = 0.0
            exit_qty_acc = 0.0

            while remaining > 1e-12 and lots:
                lot = lots[0]
                take = min(remaining, lot["qty"])
                entry_sum += lot["price"] * take
                entry_qty_acc += take
                exit_sum += f.price * take
                exit_qty_acc += take
                lot["qty"] -= take
                remaining -= take
                if lot["qty"] <= 1e-12:
                    lots.pop(0)

            pos += s
            if abs(pos) <= 1e-12:
                pos = 0.0
                emit_closed(entry_qty_acc, entry_sum, exit_qty_acc, exit_sum, f.time_ms)
                lots = []
                round_pnl = 0.0
                round_entry_time = None
                round_direction = None

    return trades