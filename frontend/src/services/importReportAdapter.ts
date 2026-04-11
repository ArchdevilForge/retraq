import type {
  FileValidationError,
  ImportReport,
  ImportReportStatus,
  ImportRowOutcome,
  ImportScalar,
  NormalizationEvent,
  ReportDownloadRef,
} from './importTypes';

type ImportPayloadRecord = Record<string, unknown>;

const importReportStatuses = new Set<ImportReportStatus>(['success', 'partial', 'file_rejected']);
const importRowStatuses = new Set<ImportRowOutcome['status']>(['success', 'failed', 'duplicate', 'conflict']);

function isRecord(value: unknown): value is ImportPayloadRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function normalizeScalar(value: unknown): ImportScalar {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return value;
  }

  return null;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  return values.length > 0 ? values : undefined;
}

function normalizeReportStatus(value: unknown, fileValidationErrorsCount: number): ImportReportStatus {
  if (typeof value === 'string' && importReportStatuses.has(value as ImportReportStatus)) {
    return value as ImportReportStatus;
  }

  return fileValidationErrorsCount > 0 ? 'file_rejected' : 'partial';
}

function normalizeSummaryCount(record: ImportPayloadRecord, primaryKey: string, legacyKey: string): number {
  if (Object.prototype.hasOwnProperty.call(record, primaryKey)) {
    return normalizeNumber(record[primaryKey]);
  }

  return normalizeNumber(record[legacyKey]);
}

function normalizeRowStatus(value: unknown): ImportRowOutcome['status'] {
  if (typeof value === 'string' && importRowStatuses.has(value as ImportRowOutcome['status'])) {
    return value as ImportRowOutcome['status'];
  }

  return 'failed';
}

function normalizeFileValidationError(value: ImportPayloadRecord): FileValidationError {
  const missingColumns = normalizeStringArray(value.missing_columns);

  return {
    code: typeof value.code === 'string' && value.code.length > 0 ? value.code : 'unknown',
    message: typeof value.message === 'string' ? value.message : '',
    ...(missingColumns ? { missing_columns: missingColumns } : {}),
  };
}

function normalizeFileValidationErrors(record: ImportPayloadRecord): FileValidationError[] {
  const explicitErrors = normalizeRecordArray(record.file_validation_errors, normalizeFileValidationError);
  if (explicitErrors.length > 0) {
    return explicitErrors;
  }

  if (isRecord(record.file_rejection)) {
    return [normalizeFileValidationError({
      code: record.file_rejection.reason,
      message: record.file_rejection.message,
      missing_columns: record.file_rejection.missing_columns,
    })];
  }

  return [];
}

function normalizeRowOutcome(value: ImportPayloadRecord): ImportRowOutcome {
  const normalizedValue =
    Object.prototype.hasOwnProperty.call(value, 'normalized_value') && value.normalized_value !== undefined
      ? normalizeScalar(value.normalized_value)
      : undefined;

  return {
    status: normalizeRowStatus(value.status ?? value.outcome),
    row_number: normalizeNumber(value.row_number),
    field: typeof value.field === 'string' ? value.field : '',
    raw_value: normalizeScalar(value.raw_value),
    reason: typeof value.reason === 'string' ? value.reason : '',
    ...(normalizedValue !== undefined ? { normalized_value: normalizedValue } : {}),
  };
}

function normalizeNormalizationEvent(value: ImportPayloadRecord): NormalizationEvent {
  return {
    kind: 'timestamp',
    row_number: normalizeNumber(value.row_number),
    field: typeof value.field === 'string' ? value.field : '',
    raw_value: normalizeScalar(value.raw_value),
    normalized_value: normalizeScalar(value.normalized_value),
    reason: typeof value.reason === 'string' ? value.reason : '',
  };
}

function normalizeDownloadRef(value: unknown): ReportDownloadRef | null {
  if (!isRecord(value)) {
    return null;
  }

  const url = typeof value.url === 'string' ? value.url : typeof value.download_url === 'string' ? value.download_url : '';
  const filename = typeof value.filename === 'string' ? value.filename : '';

  return url && filename ? { url, filename } : null;
}

function normalizeRecordArray<T>(value: unknown, mapper: (entry: ImportPayloadRecord) => T): T[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord).map(mapper);
}

export function adaptImportReportPayload(payload: unknown): ImportReport {
  const record = isRecord(payload) ? payload : {};
  const summaryRecord = isRecord(record.summary) ? record.summary : {};
  const fileValidationErrors = normalizeFileValidationErrors(record);
  const rowOutcomes = normalizeRecordArray(record.row_outcomes, normalizeRowOutcome);

  return {
    status: normalizeReportStatus(record.status, fileValidationErrors.length),
    summary: {
      total_rows: normalizeNumber(summaryRecord.total_rows),
      success: normalizeSummaryCount(summaryRecord, 'success', 'success_count'),
      failed: normalizeSummaryCount(summaryRecord, 'failed', 'failed_count'),
      duplicate: normalizeSummaryCount(summaryRecord, 'duplicate', 'duplicate_count'),
      conflict: normalizeSummaryCount(summaryRecord, 'conflict', 'conflict_count'),
      timestamp_normalization: normalizeSummaryCount(summaryRecord, 'timestamp_normalization', 'timestamp_normalization_count'),
    },
    file_validation_errors: fileValidationErrors,
    row_outcomes: rowOutcomes,
    normalization_events: normalizeRecordArray(record.normalization_events, normalizeNormalizationEvent),
    download_ref: normalizeDownloadRef(record.download_ref ?? record.download_reference),
  };
}
