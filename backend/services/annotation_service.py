"""Position annotations and chart drawings (docs/DESIGN.md §6)."""

import json
from typing import Optional

from sqlalchemy.orm import Session

from models import (
    SUBJECT_MASTER_POSITION,
    SUBJECT_TRADE,
    ChartDrawing,
    TradeAnnotation,
)

VALID_SUBJECTS = (SUBJECT_TRADE, SUBJECT_MASTER_POSITION)

# 复盘三层记录模型中的上下文/心理层预设（docs/PRODUCT.md §三）。前端可自由扩展，这里只作提示。
SETUP_TAG_PRESETS = ("突破", "回踩", "假突破", "关键位狙击", "顺势加仓", "逆势抄底", "追高", "区间震荡")
ERROR_TAG_PRESETS = ("追高", "没止损", "重仓", "提前出场", "扛单", "报复性交易", "逆势加仓", "计划外交易")
EMOTION_PRESETS = ("冷静", "自信", "焦虑", "急躁", "兴奋", "无聊", "报复性")
GRADE_PRESETS = ("A+", "A", "B", "C")

MAX_DRAWING_POINTS = {"hline": 1, "trend": 2, "region": 2, "fib": 2}


class ValidationError(ValueError):
    pass


def _parse_tags(raw: Optional[str]) -> list[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _tags_json(tags: Optional[list[str]]) -> Optional[str]:
    if tags is None:
        return None
    cleaned = [str(t).strip() for t in tags if str(t).strip()]
    return json.dumps(cleaned, ensure_ascii=False) if cleaned else json.dumps([], ensure_ascii=False)


def _validate_payload(kind: str, payload: list[dict]) -> list[dict]:
    if kind not in MAX_DRAWING_POINTS:
        raise ValidationError(f"Unknown drawing kind: {kind}")
    expected = MAX_DRAWING_POINTS[kind]
    if not isinstance(payload, list) or len(payload) != expected:
        raise ValidationError(f"{kind} drawing needs exactly {expected} point(s)")
    points = []
    for p in payload:
        try:
            time_ms = int(p["time_ms"])
            price = float(p["price"])
        except (KeyError, TypeError, ValueError):
            raise ValidationError("Each point needs numeric time_ms and price")
        if time_ms <= 0 or price <= 0:
            raise ValidationError("Point time_ms and price must be positive")
        points.append({"time_ms": time_ms, "price": price})
    return points


class AnnotationService:
    @staticmethod
    def get_annotation(db: Session, subject_type: str, subject_id: int) -> dict:
        if subject_type not in VALID_SUBJECTS:
            raise ValidationError(f"Unknown subject type: {subject_type}")
        row = (
            db.query(TradeAnnotation)
            .filter(
                TradeAnnotation.subject_type == subject_type,
                TradeAnnotation.subject_id == subject_id,
            )
            .first()
        )
        return AnnotationService._to_dict(row, subject_type, subject_id)

    @staticmethod
    def upsert_annotation(db: Session, subject_type: str, subject_id: int, fields: dict) -> dict:
        if subject_type not in VALID_SUBJECTS:
            raise ValidationError(f"Unknown subject type: {subject_type}")
        if subject_id <= 0:
            raise ValidationError("subject_id must be positive")

        row = (
            db.query(TradeAnnotation)
            .filter(
                TradeAnnotation.subject_type == subject_type,
                TradeAnnotation.subject_id == subject_id,
            )
            .first()
        )
        if row is None:
            row = TradeAnnotation(subject_type=subject_type, subject_id=subject_id)
            db.add(row)

        # setattr keeps mypy calm about SQLAlchemy's Column[T] descriptors.
        if "note" in fields:
            setattr(row, "note", fields["note"])
        if "setup_tags" in fields:
            setattr(row, "setup_tags", _tags_json(fields["setup_tags"]))
        if "error_tags" in fields:
            setattr(row, "error_tags", _tags_json(fields["error_tags"]))
        if "grade" in fields:
            grade = fields["grade"]
            setattr(row, "grade", str(grade).strip() if grade else None)
        if "emotion" in fields:
            emotion = fields["emotion"]
            setattr(row, "emotion", str(emotion).strip() if emotion else None)
        if "planned_stop" in fields:
            setattr(
                row,
                "planned_stop",
                float(fields["planned_stop"]) if fields["planned_stop"] is not None else None,
            )
        if "planned_target" in fields:
            setattr(
                row,
                "planned_target",
                float(fields["planned_target"]) if fields["planned_target"] is not None else None,
            )

        db.commit()
        db.refresh(row)
        return AnnotationService._to_dict(row, subject_type, subject_id)

    @staticmethod
    def list_drawings(db: Session, symbol: str) -> list[dict]:
        rows = (
            db.query(ChartDrawing)
            .filter(ChartDrawing.symbol == symbol)
            .order_by(ChartDrawing.id.asc())
            .all()
        )
        return [AnnotationService._drawing_to_dict(r) for r in rows]

    @staticmethod
    def create_drawing(db: Session, symbol: str, kind: str, payload: list[dict]) -> dict:
        if not symbol or not symbol.strip():
            raise ValidationError("symbol is required")
        points = _validate_payload(kind, payload)
        row = ChartDrawing(symbol=symbol.strip(), kind=kind, payload=json.dumps(points))
        db.add(row)
        db.commit()
        db.refresh(row)
        return AnnotationService._drawing_to_dict(row)

    @staticmethod
    def delete_drawing(db: Session, drawing_id: int) -> bool:
        row = db.query(ChartDrawing).filter(ChartDrawing.id == drawing_id).first()
        if row is None:
            return False
        db.delete(row)
        db.commit()
        return True

    @staticmethod
    def _to_dict(row: Optional[TradeAnnotation], subject_type: str, subject_id: int) -> dict:
        if row is None:
            return {
                "subject_type": subject_type,
                "subject_id": subject_id,
                "note": None,
                "setup_tags": [],
                "error_tags": [],
                "grade": None,
                "emotion": None,
                "planned_stop": None,
                "planned_target": None,
                "updated_at": None,
            }
        return {
            "subject_type": row.subject_type,
            "subject_id": row.subject_id,
            "note": row.note,
            "setup_tags": _parse_tags(str(row.setup_tags)) if row.setup_tags else [],
            "error_tags": _parse_tags(str(row.error_tags)) if row.error_tags else [],
            "grade": row.grade,
            "emotion": row.emotion,
            "planned_stop": row.planned_stop,
            "planned_target": row.planned_target,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }

    @staticmethod
    def _drawing_to_dict(row: ChartDrawing) -> dict:
        try:
            payload = json.loads(str(row.payload))
        except Exception:
            payload = []
        return {
            "id": row.id,
            "symbol": row.symbol,
            "kind": row.kind,
            "payload": payload,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }


annotation_service = AnnotationService()
