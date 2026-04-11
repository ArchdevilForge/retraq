import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import App from '../App';
import { importTrades } from '../services/api';

vi.mock('../services/api', () => ({
  importTrades: vi.fn(),
}));

const mockedImportTrades = vi.mocked(importTrades);

function renderImportRoute() {
  return render(
    <MemoryRouter initialEntries={['/import']}>
      <App />
    </MemoryRouter>,
  );
}

describe('ImportPage', () => {
  it('shows the dedicated import entry surface', () => {
    renderImportRoute();

    expect(screen.getByRole('heading', { name: '导入交易复盘' })).toBeInTheDocument();
    expect(screen.getByText(/支持 Excel 导入和手动复盘后的重复提交/)).toBeInTheDocument();
    expect(screen.getByText(/symbol、entry_price、entry_time/)).toBeInTheDocument();
    expect(screen.getByText(/重复.*冲突.*单独标出/)).toBeInTheDocument();
  });

  it('submits a selected file and renders the returned report', async () => {
    const user = userEvent.setup();
    mockedImportTrades.mockResolvedValue({
      status: 'partial',
      summary: {
        total_rows: 3,
        success: 1,
        failed: 1,
        duplicate: 1,
        conflict: 0,
        timestamp_normalization: 1,
      },
      file_validation_errors: [],
      row_outcomes: [
        {
          status: 'failed',
          row_number: 8,
          field: 'entry_price',
          raw_value: 'abc',
          reason: 'entry_price must be numeric',
        },
        {
          status: 'duplicate',
          row_number: 9,
          field: 'symbol',
          raw_value: 'btc/usdt',
          reason: 'duplicate trade already exists',
          normalized_value: 'BTC/USDT',
        },
      ],
      normalization_events: [
        {
          kind: 'timestamp',
          row_number: 7,
          field: 'entry_time',
          raw_value: '2026-04-11 12:30:00',
          normalized_value: '2026-04-11T04:30:00.000Z',
          reason: 'interpreted as Asia/Shanghai time',
        },
      ],
      download_ref: {
        url: '/api/trades/import/reports/imp_123/download',
        filename: 'import-report-imp_123.csv',
      },
    });

    renderImportRoute();

    const file = new File(['symbol,entry_price,entry_time\nBTC/USDT,65000,2026-04-11 12:30:00'], 'trades.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await user.upload(screen.getByLabelText('选择 Excel 文件'), file);
    await user.click(screen.getByRole('button', { name: '开始导入' }));

    expect(mockedImportTrades).toHaveBeenCalledWith(file);
    expect(await screen.findByText('处理结果')).toBeInTheDocument();
    expect(screen.getByText('成功 1')).toBeInTheDocument();
    expect(screen.getByText('失败 1')).toBeInTheDocument();
    expect(screen.getByText('重复 1')).toBeInTheDocument();
    expect(screen.getByText('时间归一 1')).toBeInTheDocument();
    expect(screen.getByText('entry_price')).toBeInTheDocument();
    expect(screen.getByText('duplicate trade already exists')).toBeInTheDocument();
    expect(screen.getByText('interpreted as Asia/Shanghai time')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '下载明细 CSV' })).toHaveAttribute(
      'href',
      '/api/trades/import/reports/imp_123/download',
    );
  });

  it('surfaces file-level rejection without row noise', async () => {
    const user = userEvent.setup();
    mockedImportTrades.mockResolvedValue({
      status: 'file_rejected',
      summary: {
        total_rows: 0,
        success: 0,
        failed: 0,
        duplicate: 0,
        conflict: 0,
        timestamp_normalization: 0,
      },
      file_validation_errors: [
        {
          code: 'missing_required_columns',
          message: 'Missing required columns: symbol, entry_time',
          missing_columns: ['symbol', 'entry_time'],
        },
      ],
      row_outcomes: [],
      normalization_events: [],
      download_ref: null,
    });

    renderImportRoute();

    const file = new File(['symbol,entry_price\nBTC/USDT,65000'], 'broken.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await user.upload(screen.getByLabelText('选择 Excel 文件'), file);
    await user.click(screen.getByRole('button', { name: '开始导入' }));

    expect(await screen.findByText('文件被拒绝')).toBeInTheDocument();
    expect(screen.getByText('Missing required columns: symbol, entry_time')).toBeInTheDocument();
    expect(screen.queryByText('处理结果')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '下载明细 CSV' })).not.toBeInTheDocument();
  });
});
