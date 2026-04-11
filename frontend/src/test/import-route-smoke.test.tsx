import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

vi.mock('../services/api', () => ({
  fetchTrades: vi.fn(async () => []),
  fetchStats: vi.fn(async () => ({
    total_pnl: 0,
    win_rate: 0,
    profit_factor: 0,
    max_drawdown: 0,
    avg_holding_time: 0,
    symbol_distribution: {},
    trade_count: 0,
  })),
  fetchKlines: vi.fn(async () => []),
  importTrades: vi.fn(async () => {
    throw new Error('importTrades is not used by the smoke test');
  }),
  restoreSQLiteBackup: vi.fn(async () => ({ status: 'restored' })),
}));

const localStorageStore = new Map<string, string>();

const localStorageMock = {
  getItem: (key: string) => localStorageStore.get(key) ?? null,
  setItem: (key: string, value: string) => {
    localStorageStore.set(key, String(value));
  },
  removeItem: (key: string) => {
    localStorageStore.delete(key);
  },
  clear: () => {
    localStorageStore.clear();
  },
  key: (index: number) => Array.from(localStorageStore.keys())[index] ?? null,
  get length() {
    return localStorageStore.size;
  },
};

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderAt(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  );
}

describe('import route smoke coverage', () => {
  beforeEach(() => {
    localStorageStore.clear();
    vi.stubGlobal('localStorage', localStorageMock as Storage);
    vi.stubGlobal('ResizeObserver', ResizeObserverMock as unknown as typeof ResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the import workspace directly at /import', () => {
    renderAt('/import');

    expect(screen.getByRole('heading', { name: '导入交易复盘' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '本地保全' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '下载 SQLite 备份' })).toHaveAttribute(
      'href',
      '/api/backups/download',
    );
    expect(screen.getByRole('link', { name: '导入' })).toHaveAttribute('aria-current', 'page');
  });

  it('opens the import workspace from the navbar', async () => {
    const user = userEvent.setup();

    renderAt('/replay');

    await user.click(screen.getByRole('link', { name: '导入' }));

    expect(screen.getByRole('heading', { name: '导入交易复盘' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '导入' })).toHaveAttribute('aria-current', 'page');
  });
});
