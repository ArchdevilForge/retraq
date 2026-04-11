import { describe, expect, it } from 'vitest';
import { adaptImportReportPayload } from '../services/importReportAdapter';
import type { ImportReport, ImportRowOutcome } from '../services/importTypes';

const emptySummary = {
  total_rows: '0',
  success: '0',
  failed: '0',
  duplicate: '0',
  conflict: '0',
  timestamp_normalization: '0',
} as const;

describe('phase 1 import contract', () => {
  it('D-12 decodes the summary buckets and normalization counts', () => {
    const report: ImportReport = adaptImportReportPayload({
      status: 'partial',
      summary: {
        total_rows: '9',
        success: '4',
        failed: '1',
        duplicate: '2',
        conflict: '1',
        timestamp_normalization: '3',
      },
      row_outcomes: [],
      normalization_events: [],
      file_validation_errors: [],
      download_ref: null,
    });

    expect(report.summary).toEqual({
      total_rows: 9,
      success: 4,
      failed: 1,
      duplicate: 2,
      conflict: 1,
      timestamp_normalization: 3,
    });
  });

  it('D-10 preserves row number, field, raw value, reason, and normalized value', () => {
    const rowOutcome: ImportRowOutcome = adaptImportReportPayload({
      status: 'partial',
      summary: emptySummary,
      row_outcomes: [
        {
          status: 'failed',
          row_number: '12',
          field: 'entry_price',
          raw_value: 'abc',
          reason: 'entry_price must be a number',
          normalized_value: '12.5',
        },
      ],
      normalization_events: [],
      file_validation_errors: [],
      download_ref: null,
    }).row_outcomes[0];

    expect(rowOutcome).toEqual({
      status: 'failed',
      row_number: 12,
      field: 'entry_price',
      raw_value: 'abc',
      reason: 'entry_price must be a number',
      normalized_value: '12.5',
    });
  });

  it('preserves success outcomes from the backend dataclass shape', () => {
    const rowOutcome = adaptImportReportPayload({
      summary: emptySummary,
      row_outcomes: [
        {
          outcome: 'success',
          row_number: 1,
          field: 'business_key',
          raw_value: 'ETH-USDT|short|1704244500000|2200|1704248100000|2000',
          reason: 'trade_accepted',
          normalized_value: 'ETH-USDT|short|1704244500000|2200|1704248100000|2000',
        },
      ],
      normalization_events: [],
      file_rejection: null,
      download_reference: null,
    }).row_outcomes[0];

    expect(rowOutcome.status).toBe('success');
  });

  it('D-02 keeps file-level rejection separate from row-level outcomes', () => {
    const report: ImportReport = adaptImportReportPayload({
      status: 'file_rejected',
      summary: emptySummary,
      row_outcomes: [],
      normalization_events: [],
      file_validation_errors: [
        {
          code: 'missing_required_columns',
          message: 'Missing required columns: symbol, entry_time',
          missing_columns: ['symbol', 'entry_time'],
        },
      ],
      download_ref: null,
    });

    expect(report.status).toBe('file_rejected');
    expect(report.file_validation_errors).toEqual([
      {
        code: 'missing_required_columns',
        message: 'Missing required columns: symbol, entry_time',
        missing_columns: ['symbol', 'entry_time'],
      },
    ]);
    expect(report.row_outcomes).toEqual([]);
  });

  it('includes the backend report download reference metadata', () => {
    const report: ImportReport = adaptImportReportPayload({
      status: 'partial',
      summary: emptySummary,
      row_outcomes: [],
      normalization_events: [],
      file_validation_errors: [],
      download_ref: {
        url: '/api/imports/imp_123/report.csv',
        filename: 'import-report-imp_123.csv',
      },
    });

    expect(report.download_ref).toEqual({
      url: '/api/imports/imp_123/report.csv',
      filename: 'import-report-imp_123.csv',
    });
  });

  it('accepts the backend Phase 1 dataclass JSON shape', () => {
    const report: ImportReport = adaptImportReportPayload({
      summary: {
        total_rows: 3,
        success_count: 1,
        failed_count: 1,
        duplicate_count: 1,
        conflict_count: 0,
        timestamp_normalization_count: 2,
      },
      row_outcomes: [
        {
          outcome: 'duplicate',
          row_number: 9,
          field: 'business_key',
          raw_value: 'BTC-USDT|long|1|2',
          reason: 'duplicate_trade_exists',
          normalized_value: 'BTC-USDT|long|1|2',
        },
      ],
      normalization_events: [],
      file_rejection: null,
      download_reference: {
        download_url: '/api/trades/import/reports/9/download',
        filename: 'import-report-9.csv',
        mime_type: 'text/csv',
      },
    });

    expect(report.status).toBe('partial');
    expect(report.summary).toEqual({
      total_rows: 3,
      success: 1,
      failed: 1,
      duplicate: 1,
      conflict: 0,
      timestamp_normalization: 2,
    });
    expect(report.row_outcomes[0]).toEqual({
      status: 'duplicate',
      row_number: 9,
      field: 'business_key',
      raw_value: 'BTC-USDT|long|1|2',
      reason: 'duplicate_trade_exists',
      normalized_value: 'BTC-USDT|long|1|2',
    });
    expect(report.download_ref).toEqual({
      url: '/api/trades/import/reports/9/download',
      filename: 'import-report-9.csv',
    });
  });

  it('maps backend file_rejection objects into frontend validation state', () => {
    const report: ImportReport = adaptImportReportPayload({
      summary: {
        total_rows: 0,
        success_count: 0,
        failed_count: 0,
        duplicate_count: 0,
        conflict_count: 0,
        timestamp_normalization_count: 0,
      },
      row_outcomes: [],
      normalization_events: [],
      file_rejection: {
        reason: 'missing_required_columns',
        message: 'Missing required columns: symbol, entry_time',
        missing_columns: ['symbol', 'entry_time'],
      },
      download_reference: null,
    });

    expect(report.status).toBe('file_rejected');
    expect(report.file_validation_errors).toEqual([
      {
        code: 'missing_required_columns',
        message: 'Missing required columns: symbol, entry_time',
        missing_columns: ['symbol', 'entry_time'],
      },
    ]);
  });
});
