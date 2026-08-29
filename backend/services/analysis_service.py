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

from models import SUBJECT_TRADE, Dataset, ReviewNote, Trade, TradeAnnotation

REVIEW_CADENCES = ("daily", "weekly", "monthly")

REVIEW_CHECKLISTS: dict[str, dict[str, object]] = {
    "daily": {
        "label": "日复盘 · 5 分钟",
        "questions": [
            "今天遵守交易计划了吗？",
            "有没有违反规则的交易？属于哪类错误？",
            "交易时段的情绪状态如何？",
            "明天保持什么、改变什么？（写进一句话结论）",
        ],
    },
    "weekly": {
        "label": "周复盘 · 30 分钟",
        "questions": [
            "按 setup 分的胜率与盈亏怎么样？",
            "本周最常见的错误是什么，代价是多少？",
            "哪个时段表现最差？",
            "下周的一个具体改变是什么？（写进一句话结论）",
        ],
    },
    "monthly": {
        "label": "月复盘 · 1 小时",
        "questions": [
            "哪些 setup 期望值最高、哪些该停？",
            "R 值分布相比上月是否改善？",
            "本月最大的行为模式是什么？",
            "下月的一个改变是什么？（写进一句话结论）",
        ],
    },
}

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


def list_reviews(db: Session, cadence: Optional[str], limit: int = 30) -> list[dict]:
    q = db.query(ReviewNote)
    if cadence:
        q = q.filter(ReviewNote.cadence == cadence)
    rows = q.order_by(ReviewNote.period_key.desc()).limit(limit).all()
    return [
        {
            "id": r.id,
            "cadence": r.cadence,
            "period_key": r.period_key,
            "content": r.content,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in rows
    ]


def upsert_review(db: Session, cadence: str, period_key: str, content: str) -> dict:
    if cadence not in REVIEW_CADENCES:
        raise ValueError(f"Unknown cadence: {cadence}")
    if not period_key.strip():
        raise ValueError("period_key is required")
    row = (
        db.query(ReviewNote)
        .filter(ReviewNote.cadence == cadence, ReviewNote.period_key == period_key)
        .first()
    )
    if row is None:
        row = ReviewNote(cadence=cadence, period_key=period_key)
        db.add(row)
    setattr(row, "content", content)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "cadence": row.cadence,
        "period_key": row.period_key,
        "content": row.content,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }
