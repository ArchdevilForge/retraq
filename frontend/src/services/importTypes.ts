export type ImportScalar = string | number | boolean | null;

export type ImportReportStatus = 'success' | 'partial' | 'file_rejected';

export type ImportRowStatus = 'success' | 'failed' | 'duplicate' | 'conflict';

export interface FileValidationError {
  code: string;
  message: string;
  missing_columns?: string[];
}

export interface ImportRowOutcome {
  status: ImportRowStatus;
  row_number: number;
  field: string;
  raw_value: ImportScalar;
  reason: string;
  normalized_value?: ImportScalar;
}

export interface NormalizationEvent {
  kind: 'timestamp';
  row_number: number;
  field: string;
  raw_value: ImportScalar;
  normalized_value: ImportScalar;
  reason: string;
}

export interface ImportSummary {
  total_rows: number;
  success: number;
  failed: number;
  duplicate: number;
  conflict: number;
  timestamp_normalization: number;
}

export interface ReportDownloadRef {
  url: string;
  filename: string;
}

export interface ImportReport {
  status: ImportReportStatus;
  summary: ImportSummary;
  file_validation_errors: FileValidationError[];
  row_outcomes: ImportRowOutcome[];
  normalization_events: NormalizationEvent[];
  download_ref: ReportDownloadRef | null;
}
