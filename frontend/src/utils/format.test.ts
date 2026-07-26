import { describe, it, expect } from 'vitest';
import { fmtDurationMs, fmtMoney, fmtPct } from './format';

// zh-CN formatting; vitest.config.ts pins TZ=Asia/Shanghai.
const DASH = '—';

describe('fmtMoney', () => {
  it('renders missing and non-finite values as an em dash', () => {
    expect(fmtMoney(null)).toBe(DASH);
    expect(fmtMoney(undefined)).toBe(DASH);
    expect(fmtMoney(NaN)).toBe(DASH);
    expect(fmtMoney(Infinity)).toBe(DASH);
    expect(fmtMoney(-Infinity)).toBe(DASH);
  });

  it('always shows exactly two decimals', () => {
    expect(fmtMoney(0)).toBe('0.00');
    expect(fmtMoney(1234.5)).toBe('1,234.50');
    expect(fmtMoney(-0.5)).toBe('-0.50');
    expect(fmtMoney(1.004)).toBe('1.00');
    expect(fmtMoney(1.006)).toBe('1.01');
  });
});

describe('fmtPct', () => {
  it('renders missing and non-finite values as an em dash', () => {
    expect(fmtPct(null)).toBe(DASH);
    expect(fmtPct(undefined)).toBe(DASH);
    expect(fmtPct(NaN)).toBe(DASH);
    expect(fmtPct(Infinity)).toBe(DASH);
  });

  it('takes a 0-1 ratio, not a 0-100 percentage', () => {
    expect(fmtPct(0)).toBe('0%');
    expect(fmtPct(0.1)).toBe('10%');
    expect(fmtPct(0.1234)).toBe('12.3%');
    expect(fmtPct(1)).toBe('100%');
    expect(fmtPct(-0.05)).toBe('-5%');
  });

  it('blows up on 0-100 input, which is why StatsOverview.win_rate must not be passed to it', () => {
    // StatsOverview.win_rate is already a percent (0-100); fmtPct would multiply again.
    expect(fmtPct(75)).toBe('7,500%');
  });
});

describe('fmtDurationMs', () => {
  it('rejects negative and non-finite input', () => {
    expect(fmtDurationMs(-1)).toBe(DASH);
    expect(fmtDurationMs(NaN)).toBe(DASH);
    expect(fmtDurationMs(Infinity)).toBe(DASH);
  });

  it('renders sub-hour durations in rounded minutes', () => {
    expect(fmtDurationMs(0)).toBe('0 分');
    expect(fmtDurationMs(29_000)).toBe('0 分');
    expect(fmtDurationMs(31_000)).toBe('1 分');
    expect(fmtDurationMs(59 * 60_000)).toBe('59 分');
  });

  it('switches to hours at 60 minutes and drops a zero minute part', () => {
    expect(fmtDurationMs(60 * 60_000)).toBe('1 时');
    expect(fmtDurationMs(90 * 60_000)).toBe('1 时 30 分');
    expect(fmtDurationMs(23 * 3_600_000 + 59 * 60_000)).toBe('23 时 59 分');
  });

  it('switches to days at 24 hours and drops a zero hour part', () => {
    expect(fmtDurationMs(24 * 3_600_000)).toBe('1 天');
    expect(fmtDurationMs(25 * 3_600_000)).toBe('1 天 1 时');
    // Minutes are intentionally dropped once the duration reaches a day.
    expect(fmtDurationMs(25 * 3_600_000 + 30 * 60_000)).toBe('1 天 1 时');
    expect(fmtDurationMs(48 * 3_600_000)).toBe('2 天');
  });
});
