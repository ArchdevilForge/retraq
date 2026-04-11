from __future__ import annotations

from dataclasses import dataclass, field


IMPORT_OUTCOME_BUCKETS = (
    "success",
    "failed",
    "duplicate",
    "conflict",
    "timestamp_normalization",
)

REQUIRED_IMPORT_COLUMNS = ("symbol", "entry_price", "entry_time")


@dataclass(frozen=True, slots=True)
class ImportFileRejection:
    reason: str
    missing_columns: tuple[str, ...]
    required_columns: tuple[str, ...] = REQUIRED_IMPORT_COLUMNS
    present_columns: tuple[str, ...] = ()
    message: str = ""
    filename: str | None = None


@dataclass(frozen=True, slots=True)
class ImportRowOutcome:
    row_number: int
    field: str
    raw_value: object | None
    reason: str
    normalized_value: object | None = None
    outcome: str = "failed"


@dataclass(frozen=True, slots=True)
class ImportNormalizationEvent:
    row_number: int
    field: str
    raw_value: object | None
    normalized_value: object
    reason: str
    kind: str = "timestamp_normalization"


@dataclass(frozen=True, slots=True)
class ImportSummary:
    total_rows: int = 0
    success_count: int = 0
    failed_count: int = 0
    duplicate_count: int = 0
    conflict_count: int = 0
    timestamp_normalization_count: int = 0


@dataclass(frozen=True, slots=True)
class ImportReportDownloadReference:
    download_url: str
    filename: str
    mime_type: str
    format: str = "csv"
    label: str = "Import detail export"


@dataclass(frozen=True, slots=True)
class ImportReport:
    summary: ImportSummary
    row_outcomes: tuple[ImportRowOutcome, ...] = field(default_factory=tuple)
    normalization_events: tuple[ImportNormalizationEvent, ...] = field(
        default_factory=tuple
    )
    file_rejection: ImportFileRejection | None = None
    download_reference: ImportReportDownloadReference | None = None
    source_filename: str | None = None
