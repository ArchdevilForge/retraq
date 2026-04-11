import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import LocalSafekeepingPanel from '../components/import/LocalSafekeepingPanel';
import type { ImportReport } from '../services/importTypes';
import { restoreSQLiteBackup } from '../services/api';

vi.mock('../services/api', () => ({
  restoreSQLiteBackup: vi.fn(),
}));

const mockedRestoreSQLiteBackup = vi.mocked(restoreSQLiteBackup);

const importReport: ImportReport = {
  status: 'partial',
  summary: {
    total_rows: 1,
    success: 1,
    failed: 0,
    duplicate: 0,
    conflict: 0,
    timestamp_normalization: 0,
  },
  file_validation_errors: [],
  row_outcomes: [],
  normalization_events: [],
  download_ref: {
    url: '/api/trades/import/reports/imp_123/download',
    filename: 'import-report-imp_123.csv',
  },
};

describe('LocalSafekeepingPanel', () => {
  it('reuses the import report CSV link and restores SQLite backups', async () => {
    const user = userEvent.setup();
    mockedRestoreSQLiteBackup.mockResolvedValue({ status: 'restored' });

    render(<LocalSafekeepingPanel importReport={importReport} />);

    expect(screen.getByRole('heading', { name: '本地保全' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '下载明细 CSV' })).toHaveAttribute(
      'href',
      importReport.download_ref?.url,
    );
    expect(screen.getByRole('link', { name: '下载 SQLite 备份' })).toHaveAttribute(
      'href',
      '/api/backups/download',
    );

    const backupFile = new File([new Uint8Array([83, 81, 76, 105, 116, 101])], 'trading.sqlite3', {
      type: 'application/octet-stream',
    });

    await user.upload(screen.getByLabelText('选择 SQLite 备份文件'), backupFile);
    await user.click(screen.getByRole('button', { name: '恢复 SQLite 备份' }));

    expect(mockedRestoreSQLiteBackup).toHaveBeenCalledWith(backupFile);
    expect(await screen.findByText('SQLite 备份已恢复。')).toBeInTheDocument();
  });
});
