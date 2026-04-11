from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, cast

import pandas as pd
from sqlalchemy.orm import Session

from models import ImportReportRow, ImportSession, Trade
from services import import_types
from services.symbol_utils import is_valid_symbol, normalize_symbol


COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "symbol": (
        "symbol",
        "交易对",
        "交易对（币对）",
        "交易对(币对)",
    ),
    "direction": (
        "direction",
        "方向",
        "买卖方向",
    ),
    "leverage": (
        "leverage",
        "杠杆倍数",
        "杠杆",
    ),
    "entry_price": (
        "entry_price",
        "开仓均价",
        "买入均价",
        "开仓价格",
        "开仓价",
    ),
    "exit_price": (
        "exit_price",
        "平仓均价",
        "卖出均价",
        "平仓价格",
        "平仓价",
    ),
    "profit_rate": (
        "profit_rate",
        "收益率",
        "盈亏率",
    ),
    "profit": (
        "profit",
        "收益 (USDT)",
        "收益",
        "净收益",
    ),
    "margin": (
        "margin",
        "保证金（最大时）",
        "保证金",
        "最大保证金",
    ),
    "entry_time": (
        "entry_time",
        "买入时间",
        "开仓时间",
    ),
    "exit_time": (
        "exit_time",
        "卖出时间",
        "平仓时间",
    ),
}

ROW_OUTCOME_BUCKETS = import_types.IMPORT_OUTCOME_BUCKETS
REQUIRED_COLUMNS = import_types.REQUIRED_IMPORT_COLUMNS


@dataclass(frozen=True, slots=True)
class TradeSnapshot:
    symbol: str
    direction: str
    leverage: float
    entry_price: float
    exit_price: float | None
    profit: float | None
    profit_rate: float | None
    margin: float | None
    entry_time: int
    exit_time: int | None

    @property
    def business_key(self) -> str:
        parts = (
            self.symbol,
            self.direction,
            str(self.entry_time),
            _format_number(self.entry_price),
            _format_optional_number(self.exit_time),
            _format_optional_number(self.exit_price),
        )
        return "|".join(parts)

    @property
    def comparison_signature(self) -> tuple[Any, ...]:
        return (
            _format_number(self.leverage),
            _format_optional_number(self.profit),
            _format_optional_number(self.profit_rate),
            _format_optional_number(self.margin),
        )


@dataclass(frozen=True, slots=True)
class ParsedRow:
    snapshot: TradeSnapshot | None
    trade: Trade | None
    failure_field: str | None
    failure_raw_value: object | None
    failure_reason: str | None
    normalization_events: tuple[import_types.ImportNormalizationEvent, ...] = ()


def _normalize_header_name(name: object) -> str:
    return re.sub(r"\s+", "", str(name).strip())


ALIASES_TO_CANONICAL: dict[str, str] = {
    _normalize_header_name(alias): canonical
    for canonical, aliases in COLUMN_ALIASES.items()
    for alias in aliases
}


class TradeImporter:
    def parse_excel(self, db: Session, file_path: str) -> import_types.ImportReport:
        workbook_path = Path(file_path)
        df = pd.read_excel(workbook_path, engine="openpyxl")
        return self._import_dataframe(db, df, workbook_path, row_number_start=2)

    def parse_rows(
        self,
        db: Session,
        rows: list[dict[str, object]],
        source_filename: str = "manual-entry",
    ) -> import_types.ImportReport:
        dataframe = pd.DataFrame(rows)
        source_path = Path(source_filename or "manual-entry")
        return self._import_dataframe(db, dataframe, source_path, row_number_start=1)

    def _import_dataframe(
        self,
        db: Session,
        df: pd.DataFrame,
        source_path: Path,
        row_number_start: int,
    ) -> import_types.ImportReport:
        df = self._rename_columns(df)

        missing_columns = tuple(
            column for column in REQUIRED_COLUMNS if column not in df.columns
        )
        if missing_columns:
            return self._reject_file(db, source_path, df.columns, missing_columns)

        session = ImportSession(
            source_filename=source_path.name,
            status="processing",
            total_rows=int(len(df)),
        )
        db.add(session)
        db.flush()

        existing_snapshots: dict[str, list[TradeSnapshot]] = (
            self._load_existing_snapshots(db)
        )
        seen_snapshots: dict[str, list[TradeSnapshot]] = {}

        row_outcomes: list[import_types.ImportRowOutcome] = []
        normalization_events: list[import_types.ImportNormalizationEvent] = []
        success_count = 0
        failed_count = 0
        duplicate_count = 0
        conflict_count = 0
        timestamp_normalization_count = 0

        try:
            for row_number, (_, raw_row) in enumerate(
                df.iterrows(), start=row_number_start
            ):
                parsed = self._parse_row(raw_row, row_number)
                normalization_events.extend(parsed.normalization_events)
                timestamp_normalization_count += len(parsed.normalization_events)

                if parsed.failure_field is not None:
                    failed_count += 1
                    row_outcomes.append(
                        import_types.ImportRowOutcome(
                            row_number=row_number,
                            field=parsed.failure_field,
                            raw_value=self._null_if_missing(parsed.failure_raw_value),
                            reason=parsed.failure_reason or "row_validation_failed",
                            normalized_value=None,
                            outcome="failed",
                        )
                    )
                    self._persist_seen_snapshot(seen_snapshots, parsed.snapshot)
                    continue

                assert parsed.snapshot is not None
                assert parsed.trade is not None

                same_key_snapshots = [
                    *existing_snapshots.get(parsed.snapshot.business_key, []),
                    *seen_snapshots.get(parsed.snapshot.business_key, []),
                ]
                outcome = self._classify_row(parsed.snapshot, same_key_snapshots)

                if outcome == "success":
                    db.add(parsed.trade)
                    db.flush()
                    existing_snapshots.setdefault(
                        parsed.snapshot.business_key, []
                    ).append(parsed.snapshot)
                    success_count += 1
                elif outcome == "duplicate":
                    duplicate_count += 1
                else:
                    conflict_count += 1

                row_outcomes.append(
                    import_types.ImportRowOutcome(
                        row_number=row_number,
                        field="business_key",
                        raw_value=parsed.snapshot.business_key,
                        reason=self._row_reason(outcome, same_key_snapshots),
                        normalized_value=parsed.snapshot.business_key,
                        outcome=outcome,
                    )
                )
                self._persist_seen_snapshot(seen_snapshots, parsed.snapshot)

            summary = import_types.ImportSummary(
                total_rows=int(len(df)),
                success_count=success_count,
                failed_count=failed_count,
                duplicate_count=duplicate_count,
                conflict_count=conflict_count,
                timestamp_normalization_count=timestamp_normalization_count,
            )
            status = self._session_status(summary)
            download_reference = self._build_download_reference(
                int(session.id), source_path.name
            )

            session.status = status
            session.success_count = summary.success_count
            session.failed_count = summary.failed_count
            session.duplicate_count = summary.duplicate_count
            session.conflict_count = summary.conflict_count
            session.timestamp_normalization_count = (
                summary.timestamp_normalization_count
            )
            session.download_filename = download_reference.filename
            session.download_mime_type = download_reference.mime_type

            for outcome in row_outcomes:
                db.add(
                    ImportReportRow(
                        session_id=session.id,
                        row_number=outcome.row_number,
                        outcome=outcome.outcome,
                        field=outcome.field,
                        raw_value=self._stringify(outcome.raw_value),
                        normalized_value=self._stringify(outcome.normalized_value),
                        reason=outcome.reason,
                        business_key=self._derive_business_key_for_row(outcome),
                    )
                )

            db.commit()
            return import_types.ImportReport(
                summary=summary,
                row_outcomes=tuple(row_outcomes),
                normalization_events=tuple(normalization_events),
                file_rejection=None,
                download_reference=download_reference,
                source_filename=source_path.name,
            )
        except Exception:
            db.rollback()
            raise

    def render_download_csv(self, db: Session, session_id: int) -> str:
        rows = (
            db.query(ImportReportRow)
            .filter(ImportReportRow.session_id == session_id)
            .order_by(ImportReportRow.row_number.asc(), ImportReportRow.id.asc())
            .all()
        )
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(
            [
                "row_number",
                "outcome",
                "field",
                "raw_value",
                "normalized_value",
                "reason",
                "business_key",
            ]
        )
        for row in rows:
            writer.writerow(
                [
                    row.row_number,
                    row.outcome,
                    row.field,
                    row.raw_value or "",
                    row.normalized_value or "",
                    row.reason,
                    row.business_key,
                ]
            )
        return buffer.getvalue()

    def _reject_file(
        self,
        db: Session,
        workbook_path: Path,
        present_columns: Any,
        missing_columns: tuple[str, ...],
    ) -> import_types.ImportReport:
        session = ImportSession(
            source_filename=workbook_path.name,
            status="file_rejected",
            total_rows=0,
            file_rejection_reason="missing_required_columns",
            file_rejection_message=f"Missing required columns: {', '.join(missing_columns)}",
        )
        db.add(session)
        db.commit()

        rejection = import_types.ImportFileRejection(
            reason="missing_required_columns",
            missing_columns=missing_columns,
            required_columns=REQUIRED_COLUMNS,
            present_columns=tuple(str(column) for column in present_columns),
            message=f"Missing required columns: {', '.join(missing_columns)}",
            filename=workbook_path.name,
        )
        return import_types.ImportReport(
            summary=import_types.ImportSummary(),
            row_outcomes=(),
            normalization_events=(),
            file_rejection=rejection,
            download_reference=None,
            source_filename=workbook_path.name,
        )

    def _rename_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        rename_map: dict[str, str] = {}
        for column in df.columns:
            canonical = ALIASES_TO_CANONICAL.get(_normalize_header_name(column))
            if canonical:
                rename_map[column] = canonical
        return df.rename(columns=rename_map)

    def _load_existing_snapshots(self, db: Session) -> dict[str, list[TradeSnapshot]]:
        snapshots: dict[str, list[TradeSnapshot]] = {}
        for trade in db.query(Trade).all():
            snapshot = self._snapshot_from_trade(trade)
            snapshots.setdefault(snapshot.business_key, []).append(snapshot)
        return snapshots

    def _parse_row(self, row: pd.Series, row_number: int) -> ParsedRow:
        normalization_events: list[import_types.ImportNormalizationEvent] = []

        raw_symbol = cast(object | None, row.get("symbol"))
        symbol = normalize_symbol(str(raw_symbol) if raw_symbol is not None else "")
        if not is_valid_symbol(symbol):
            return ParsedRow(
                snapshot=None,
                trade=None,
                failure_field="symbol",
                failure_raw_value=raw_symbol,
                failure_reason="invalid_symbol",
                normalization_events=tuple(normalization_events),
            )

        raw_direction = cast(object | None, row.get("direction"))
        direction = self._normalize_direction(raw_direction)
        if not direction:
            return ParsedRow(
                snapshot=None,
                trade=None,
                failure_field="direction",
                failure_raw_value=raw_direction,
                failure_reason="invalid_direction",
                normalization_events=tuple(normalization_events),
            )

        leverage = (
            self._parse_number(cast(object | None, row.get("leverage")), default=1.0)
            or 1.0
        )
        entry_price_raw = cast(object | None, row.get("entry_price"))
        entry_price = self._parse_number(entry_price_raw)
        if entry_price is None or entry_price <= 0:
            return ParsedRow(
                snapshot=None,
                trade=None,
                failure_field="entry_price",
                failure_raw_value=entry_price_raw,
                failure_reason="invalid_numeric_value",
                normalization_events=tuple(normalization_events),
            )

        exit_price = self._parse_number(cast(object | None, row.get("exit_price")))
        profit = self._parse_number(cast(object | None, row.get("profit")))
        profit_rate = self._parse_rate(cast(object | None, row.get("profit_rate")))
        margin = self._parse_number(cast(object | None, row.get("margin")))

        entry_time, entry_event = self._parse_timestamp(
            cast(object | None, row.get("entry_time")), row_number, "entry_time"
        )
        if entry_event is not None:
            normalization_events.append(entry_event)
        if entry_time is None:
            return ParsedRow(
                snapshot=None,
                trade=None,
                failure_field="entry_time",
                failure_raw_value=cast(object | None, row.get("entry_time")),
                failure_reason="invalid_timestamp",
                normalization_events=tuple(normalization_events),
            )

        exit_time, exit_event = self._parse_timestamp(
            cast(object | None, row.get("exit_time")), row_number, "exit_time"
        )
        if exit_event is not None:
            normalization_events.append(exit_event)

        snapshot = TradeSnapshot(
            symbol=symbol,
            direction=direction,
            leverage=leverage,
            entry_price=entry_price,
            exit_price=exit_price,
            profit=profit,
            profit_rate=profit_rate,
            margin=margin,
            entry_time=entry_time,
            exit_time=exit_time,
        )
        trade = Trade(
            symbol=symbol,
            direction=direction,
            leverage=leverage,
            entry_price=entry_price,
            exit_price=exit_price,
            profit=profit,
            profit_rate=profit_rate,
            margin=margin,
            entry_time=entry_time,
            exit_time=exit_time,
        )
        return ParsedRow(
            snapshot=snapshot,
            trade=trade,
            failure_field=None,
            failure_raw_value=None,
            failure_reason=None,
            normalization_events=tuple(normalization_events),
        )

    def _snapshot_from_trade(self, trade: Trade) -> TradeSnapshot:
        return TradeSnapshot(
            symbol=trade.symbol,
            direction=trade.direction,
            leverage=float(trade.leverage or 1.0),
            entry_price=float(trade.entry_price),
            exit_price=self._coerce_optional_float(trade.exit_price),
            profit=self._coerce_optional_float(trade.profit),
            profit_rate=self._coerce_optional_float(trade.profit_rate),
            margin=self._coerce_optional_float(trade.margin),
            entry_time=int(trade.entry_time),
            exit_time=self._coerce_optional_int(trade.exit_time),
        )

    def _classify_row(
        self, snapshot: TradeSnapshot, same_key_snapshots: list[TradeSnapshot]
    ) -> str:
        if not same_key_snapshots:
            return "success"
        if all(
            existing.comparison_signature == snapshot.comparison_signature
            for existing in same_key_snapshots
        ):
            return "duplicate"
        return "conflict"

    def _persist_seen_snapshot(
        self,
        seen_snapshots: dict[str, list[TradeSnapshot]],
        snapshot: TradeSnapshot | None,
    ) -> None:
        if snapshot is None:
            return
        seen_snapshots.setdefault(snapshot.business_key, []).append(snapshot)

    def _row_reason(self, outcome: str, same_key_snapshots: list[TradeSnapshot]) -> str:
        if outcome == "duplicate":
            return "duplicate_trade_exists"
        if outcome == "conflict":
            return "business_key_conflicts_with_existing_trade"
        if same_key_snapshots:
            return "trade_accepted_after_classification"
        return "trade_accepted"

    def _session_status(self, summary: import_types.ImportSummary) -> str:
        if summary.total_rows == 0:
            return "file_rejected"
        if summary.failed_count or summary.duplicate_count or summary.conflict_count:
            return "partial"
        return "success"

    def _build_download_reference(
        self,
        session_id: int,
        source_filename: str,
    ) -> import_types.ImportReportDownloadReference:
        filename = f"import-report-{Path(source_filename).stem}-{session_id}.csv"
        return import_types.ImportReportDownloadReference(
            download_url=f"/api/trades/import/reports/{session_id}/download",
            filename=filename,
            mime_type="text/csv",
        )

    def _derive_business_key_for_row(
        self, outcome: import_types.ImportRowOutcome
    ) -> str:
        if outcome.field == "business_key" and outcome.normalized_value is not None:
            return str(outcome.normalized_value)
        return ""

    def _parse_rate(self, raw: object | None) -> float | None:
        if self._is_missing(raw):
            return None
        text = str(raw).strip().replace(",", "").replace("%", "")
        try:
            value = float(text)
        except (TypeError, ValueError):
            return None
        if isinstance(raw, str) and "%" in raw:
            return value / 100
        return value

    def _parse_number(
        self, raw: object | None, default: float | None = None
    ) -> float | None:
        if self._is_missing(raw):
            return default
        text = str(raw).strip().replace(",", "")
        if text.endswith("%"):
            text = text[:-1]
        try:
            return float(Decimal(text))
        except (InvalidOperation, ValueError):
            return default

    def _parse_timestamp(
        self,
        raw: object | None,
        row_number: int,
        field: str,
    ) -> tuple[int | None, import_types.ImportNormalizationEvent | None]:
        if self._is_missing(raw):
            return None, None

        timestamp = pd.to_datetime(cast(Any, raw), errors="coerce")
        if pd.isna(timestamp):
            return None, None

        normalized_value = timestamp
        normalized = False
        if getattr(timestamp, "tzinfo", None) is None:
            normalized_value = timestamp.tz_localize("Asia/Shanghai")
            normalized = True

        millis = int(normalized_value.timestamp() * 1000)
        if normalized:
            return (
                millis,
                import_types.ImportNormalizationEvent(
                    row_number=row_number,
                    field=field,
                    raw_value=raw,
                    normalized_value=millis,
                    reason="defaulted_naive_timestamp_to_asia_shanghai",
                ),
            )
        return millis, None

    def _normalize_direction(self, raw: object | None) -> str:
        if self._is_missing(raw):
            return ""
        value = str(raw).strip().lower()
        if any(token in value for token in ("多", "long", "buy")):
            return "long"
        if any(token in value for token in ("空", "short", "sell")):
            return "short"
        return ""

    def _is_missing(self, value: object | None) -> bool:
        if value is None:
            return True
        if isinstance(value, str):
            return False
        try:
            return bool(pd.isna(value))
        except TypeError:
            return False

    def _null_if_missing(self, value: object | None) -> object | None:
        return None if self._is_missing(value) else value

    def _coerce_optional_float(self, value: object | None) -> float | None:
        if self._is_missing(value):
            return None
        try:
            if isinstance(value, (int, float)):
                return float(value)
            return float(str(value))
        except (TypeError, ValueError):
            return None

    def _coerce_optional_int(self, value: object | None) -> int | None:
        if self._is_missing(value):
            return None
        try:
            if isinstance(value, (int, float)):
                return int(value)
            return int(float(str(value)))
        except (TypeError, ValueError):
            return None

    def _stringify(self, value: object | None) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            return value
        return str(value)


def _format_number(value: float | int | None) -> str:
    if value is None:
        return ""
    decimal = Decimal(str(value)).normalize()
    return format(decimal, "f").rstrip("0").rstrip(".") or "0"


def _format_optional_number(value: float | int | None) -> str:
    return _format_number(value)


trade_importer = TradeImporter()
