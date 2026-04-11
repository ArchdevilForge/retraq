import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ImportPage from '../pages/ImportPage';
import type { ImportReport } from '../services/importTypes';

const { importTradesMock, importTradeRowsMock, restoreSQLiteBackupMock } = vi.hoisted(() => ({
  importTradesMock: vi.fn(),
  importTradeRowsMock: vi.fn(),
  restoreSQLiteBackupMock: vi.fn(async () => ({ status: 'restored' })),
}));

vi.mock('../services/api', () => ({
  importTrades: importTradesMock,
  importTradeRows: importTradeRowsMock,
  restoreSQLiteBackup: restoreSQLiteBackupMock,
}));

const manualImportReport: ImportReport = {
  status: 'success',
  summary: {
    total_rows: 1,
    success: 1,
    failed: 0,
    duplicate: 0,
    conflict: 0,
    timestamp_normalization: 1,
  },
  file_validation_errors: [],
  row_outcomes: [
    {
      status: 'success',
      row_number: 1,
      field: 'business_key',
      raw_value: 'BTC-USDT|long|1704186900000|1234.5||',
      reason: 'trade_accepted',
      normalized_value: 'BTC-USDT|long|1704186900000|1234.5||',
    },
  ],
  normalization_events: [
    {
      kind: 'timestamp',
      row_number: 1,
      field: 'entry_time',
      raw_value: '2024-01-02 09:15:00',
      normalized_value: 1704186900000,
      reason: 'defaulted_naive_timestamp_to_asia_shanghai',
    },
  ],
  download_ref: {
    url: '/api/trades/import/reports/9/download',
    filename: 'import-report-manual-entry-9.csv',
  },
};

describe('ImportPage manual entry', () => {
  it('submits manual rows through the row import API and shows the shared report UI', async () => {
    const user = userEvent.setup();
    importTradeRowsMock.mockResolvedValueOnce(manualImportReport);

    render(<ImportPage />);

    await user.type(screen.getByLabelText('交易对'), 'btc/usdt');
    await user.selectOptions(screen.getByLabelText('方向'), 'long');
    await user.type(screen.getByLabelText('开仓价格'), '1234.5');
    await user.type(screen.getByLabelText('开仓时间'), '2024-01-02 09:15:00');
    await user.click(screen.getByRole('button', { name: '提交手动记录' }));

    await waitFor(() => {
      expect(importTradeRowsMock).toHaveBeenCalledWith([
        {
          symbol: 'btc/usdt',
          direction: 'long',
          entry_price: '1234.5',
          entry_time: '2024-01-02 09:15:00',
        },
      ]);
    });

    expect(screen.getByText('处理结果')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '下载明细 CSV' })).toHaveAttribute(
      'href',
      '/api/trades/import/reports/9/download',
    );
    expect(screen.getAllByText('成功').length).toBeGreaterThan(0);
    expect(screen.getByText('trade_accepted')).toBeInTheDocument();
  });
});
