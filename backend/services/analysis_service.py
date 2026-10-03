"""Cross-dataset analysis over self/sim trades + annotations (docs/PRODUCT.md §七).

Aggregates join TradeAnnotation (subject_type='trade') so setup tags, error
tags and discipline stats follow the annotation system. Every report splits
results by owner group ('self' | 'sim') so the UI can compare 模拟 vs 实盘;
master datasets are never included.
"""

import json
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from models import SUBJECT_TRADE, Dataset, Trade, TradeAnnotation


# R 值分布桶（右开区间）；两端桶无界。
R_BUCKETS = [
    ("≤-3", float("-inf"), -3.0),
    ("-3~-2", -3.0, -2.0),
    ("-2~-1", -2.0, -1.0),
    ("-1~0", -1.0, 0.0),
    ("0~1", 0.0, 1.0),
    ("1~2", 1.0, 2.0),
    ("2~3", 2.0, 3.0),
    ("≥3", 3.0, float("inf")),
]


def _parse_tags(raw: Optional[str]) -> list[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _owner_group(owner: str) -> str:
    if owner == "sim":
        return "sim"
    if owner.startswith("master:"):
        return "master"
    return "self"


def _scoped_trades(db: Session, include_sim: bool, include_master: bool = False) -> list[tuple[Trade, str]]:
    owners = ("self", "sim") if include_sim else ("self",)
    # master:{trader_id} 数据集与 self/sim 互不混入，只在显式要求时并入
    flt = or_(Dataset.owner.in_(owners), Dataset.owner.like("master:%")) if include_master else Dataset.owner.in_(owners)
    rows = (
        db.query(Trade, Dataset.owner)
        .join(Dataset, Trade.dataset_id == Dataset.id)
        .filter(flt)
        .all()
    )
    return [(trade, _owner_group(owner)) for trade, owner in rows]


def _annotations_by_trade(db: Session, trade_ids: list[int]) -> dict[int, TradeAnnotation]:
    if not trade_ids:
        return {}
    rows = (
        db.query(TradeAnnotation)
        .filter(
            TradeAnnotation.subject_type == SUBJECT_TRADE,
            TradeAnnotation.subject_id.in_(trade_ids),
        )
        .all()
    )
    return {int(row.subject_id): row for row in rows}


class AnalysisService:
    @staticmethod
    def by_setup(db: Session, include_sim: bool, include_master: bool = False) -> dict:
        """Per setup tag: trade count, win rate, total profit — grouped by owner."""
        scoped = _scoped_trades(db, include_sim, include_master)
        annotations = _annotations_by_trade(db, [int(t.id) for t, _ in scoped])
        groups: dict[str, dict[str, dict[str, float]]] = {"self": {}, "sim": {}, "master": {}}
        for trade, owner in scoped:
            row = annotations.get(int(trade.id))
            if row is None:
                continue
            profit = float(trade.profit or 0.0)
            for tag in _parse_tags(str(row.setup_tags)):
                bucket = groups[owner].setdefault(tag, {"count": 0, "wins": 0, "profit": 0.0})
                bucket["count"] += 1
                bucket["wins"] += 1 if profit > 0 else 0
                bucket["profit"] += profit
        return {
            group: [
                {
                    "tag": tag,
                    "trade_count": int(b["count"]),
                    "win_rate": b["wins"] / b["count"] if b["count"] else None,
                    "total_profit": round(b["profit"], 2),
                }
                for tag, b in sorted(buckets.items(), key=lambda kv: -kv[1]["count"])
            ]
            for group, buckets in groups.items()
        }

    @staticmethod
    def by_error(db: Session, include_sim: bool, include_master: bool = False) -> dict:
        """Per error tag: trade count and cumulative profit cost — grouped by owner."""
        scoped = _scoped_trades(db, include_sim, include_master)
        annotations = _annotations_by_trade(db, [int(t.id) for t, _ in scoped])
        groups: dict[str, dict[str, dict[str, float]]] = {"self": {}, "sim": {}, "master": {}}
        for trade, owner in scoped:
            row = annotations.get(int(trade.id))
            if row is None:
                continue
            profit = float(trade.profit or 0.0)
            for tag in _parse_tags(str(row.error_tags)):
                bucket = groups[owner].setdefault(tag, {"count": 0, "profit": 0.0})
                bucket["count"] += 1
                bucket["profit"] += profit
        return {
            group: [
                {
                    "tag": tag,
                    "trade_count": int(b["count"]),
                    "total_profit": round(b["profit"], 2),
                }
                for tag, b in sorted(buckets.items(), key=lambda kv: kv[1]["profit"])
            ]
            for group, buckets in groups.items()
        }

    @staticmethod
    def r_distribution(db: Session, include_sim: bool, include_master: bool = False) -> dict:
        """R-multiple histogram. R = profit / risk, risk = margin × |entry-stop| / entry.

        Trades without a planned stop (or margin) cannot be risk-normalized and are
        reported under 'without_stop' instead of being silently dropped.
        """
        scoped = _scoped_trades(db, include_sim, include_master)
        annotations = _annotations_by_trade(db, [int(t.id) for t, _ in scoped])
        groups: dict[str, dict] = {"self": {}, "sim": {}, "master": {}}
        for owner in groups:
            groups[owner] = {
                "buckets": [{"bucket": name, "count": 0} for name, _, _ in R_BUCKETS],
                "without_stop": 0,
                "r_total": 0.0,
                "r_count": 0,
            }
        for trade, owner in scoped:
            row = annotations.get(int(trade.id))
            if row is None or row.planned_stop is None:
                continue
            margin = trade.margin
            if not margin or margin <= 0 or not trade.entry_price:
                continue
            risk = margin * abs(trade.entry_price - row.planned_stop) / trade.entry_price
            if risk <= 0:
                continue
            r_value = float(trade.profit or 0.0) / risk
            group = groups[owner]
            group["r_total"] += r_value
            group["r_count"] += 1
            for idx, (_, low, high) in enumerate(R_BUCKETS):
                if low <= r_value < high:
                    group["buckets"][idx]["count"] += 1
                    break
        for owner, group in groups.items():
            r_count = group.pop("r_count")
            r_total = group.pop("r_total")
            group["avg_r"] = round(r_total / r_count, 3) if r_count else None
        return groups

    @staticmethod
    def discipline(db: Session, include_sim: bool, include_master: bool = False) -> dict:
        """纪律遵守率：已标注交易中无错误分类的占比；未标注单独计数。"""
        scoped = _scoped_trades(db, include_sim, include_master)
        annotations = _annotations_by_trade(db, [int(t.id) for t, _ in scoped])
        groups: dict[str, dict[str, int]] = {"self": {}, "sim": {}, "master": {}}
        for owner in groups:
            groups[owner] = {"annotated": 0, "clean": 0, "with_error": 0, "unannotated": 0}
        for trade, owner in scoped:
            row = annotations.get(int(trade.id))
            if row is None:
                groups[owner]["unannotated"] += 1
                continue
            groups[owner]["annotated"] += 1
            if _parse_tags(str(row.error_tags)):
                groups[owner]["with_error"] += 1
            else:
                groups[owner]["clean"] += 1
        return groups


analysis_service = AnalysisService()

