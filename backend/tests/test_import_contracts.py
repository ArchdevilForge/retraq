from dataclasses import is_dataclass, fields

from services import import_types


def test_import_contract_exposes_explicit_outcome_buckets():
    assert import_types.IMPORT_OUTCOME_BUCKETS == (
        "success",
        "failed",
        "duplicate",
        "conflict",
        "timestamp_normalization",
    )


def test_import_row_outcome_carries_row_field_raw_reason_and_normalized_value():
    assert is_dataclass(import_types.ImportRowOutcome)
    field_names = {field.name for field in fields(import_types.ImportRowOutcome)}
    assert {"row_number", "field", "raw_value", "reason", "normalized_value"}.issubset(
        field_names
    )
    assert "outcome" in field_names


def test_missing_required_columns_rejection_is_explicit():
    assert is_dataclass(import_types.ImportFileRejection)
    field_names = {field.name for field in fields(import_types.ImportFileRejection)}
    assert {"reason", "missing_columns", "required_columns"}.issubset(field_names)
    assert import_types.REQUIRED_IMPORT_COLUMNS == (
        "symbol",
        "entry_price",
        "entry_time",
    )


def test_import_report_includes_download_reference_metadata():
    assert is_dataclass(import_types.ImportReport)
    field_names = {field.name for field in fields(import_types.ImportReport)}
    assert {
        "summary",
        "row_outcomes",
        "normalization_events",
        "download_reference",
    }.issubset(field_names)

    assert is_dataclass(import_types.ImportReportDownloadReference)
    download_fields = {
        field.name for field in fields(import_types.ImportReportDownloadReference)
    }
    assert {"download_url", "filename", "mime_type", "format"}.issubset(download_fields)
