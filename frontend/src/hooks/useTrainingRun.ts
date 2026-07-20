import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchKlines, type Kline, type Timeframe } from '../services/api';
import {
  AUTOPLAY_MS,
  applyStopsOnBar,
  canStep,
  emptyLedger,
  initialCursorIndex,
  marketAdd,
  marketClose,
  marketOpen,
  normalizeSymbol,
  pickRandomScenario,
  updateStops,
  visibleBars,
  visibleBarsUntilTime,
  type Direction,
  type Ledger,
  type TrainingRun,
  type TrainingScenario,
  DEFAULT_CONTEXT_BARS,
  DEFAULT_FEE_RATE,
  DEFAULT_START_EQUITY,
} from '../utils/training';

export type StartManualInput = {
  symbol: string;
  timeframe: Timeframe;
  startMs: number;
  endMs: number;
  contextBars?: number;
  compareSymbol?: string | null;
  startEquity?: number;
  feeRate?: number;
};

export type StartRandomInput = {
  pool: string[];
  timeframe?: Timeframe;
  contextBars?: number;
  compareSymbol?: string | null;
  startEquity?: number;
  feeRate?: number;
};

function buildRun(
  scenario: TrainingScenario,
  bars: Kline[],
  compareBars: Kline[] | null,
  startEquity: number,
  feeRate: number,
): TrainingRun {
  const ledger = emptyLedger(startEquity, feeRate);
  const initial = initialCursorIndex(bars.length, scenario.contextBars);
  return {
    scenario,
    account: ledger.account,
    cursorIndex: initial,
    initialCursorIndex: initial,
    bars,
    compareBars,
    position: null,
    revealed: false,
    locked: false,
    stats: ledger.stats,
    markers: [],
  };
}

function ledgerFromRun(run: TrainingRun): Ledger {
  return {
    account: run.account,
    position: run.position,
    stats: run.stats,
    markers: run.markers,
  };
}

function applyLedger(run: TrainingRun, ledger: Ledger): TrainingRun {
  return {
    ...run,
    account: ledger.account,
    position: ledger.position,
    stats: ledger.stats,
    markers: ledger.markers,
  };
}

async function loadPair(
  symbol: string,
  timeframe: Timeframe,
  startMs: number,
  endMs: number,
  compareSymbol?: string | null,
): Promise<{ bars: Kline[]; compareBars: Kline[] | null }> {
  const bars = await fetchKlines(symbol, timeframe, { start: startMs, end: endMs });
  let compareBars: Kline[] | null = null;
  if (compareSymbol && compareSymbol !== symbol) {
    try {
      compareBars = await fetchKlines(compareSymbol, timeframe, { start: startMs, end: endMs });
    } catch {
      compareBars = null;
    }
  }
  return { bars, compareBars };
}

export function useTrainingRun() {
  const [run, setRun] = useState<TrainingRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const playRef = useRef(false);
  const runRef = useRef(run);
  runRef.current = run;
  playRef.current = playing;

  const stopAutoplay = useCallback(() => setPlaying(false), []);

  const settleEnd = useCallback((current: TrainingRun): TrainingRun => {
    let next = { ...current, revealed: true, locked: true };
    if (next.position && next.bars.length > 0) {
      const endBar = next.bars[next.bars.length - 1]!;
      const r = marketClose(ledgerFromRun(next), endBar);
      if (r.ok) next = applyLedger(next, r.value);
    }
    next.cursorIndex = Math.max(0, next.bars.length - 1);
    return next;
  }, []);

  const step = useCallback(() => {
    setRun((prev) => {
      if (!prev || !canStep(prev.cursorIndex, prev.bars.length, prev.locked)) return prev;
      const nextIndex = prev.cursorIndex + 1;
      const bar = prev.bars[nextIndex]!;
      let next: TrainingRun = { ...prev, cursorIndex: nextIndex };
      next = applyLedger(next, applyStopsOnBar(ledgerFromRun(next), bar));
      if (nextIndex >= next.bars.length - 1) return settleEnd(next);
      return next;
    });
  }, [settleEnd]);

  // Stop autoplay when run ends / locks without setState-in-setState
  useEffect(() => {
    if (!playing || !run) return;
    if (run.locked || !canStep(run.cursorIndex, run.bars.length, run.locked)) {
      setPlaying(false);
    }
  }, [playing, run]);

  useEffect(() => {
    if (!playing) return;
    const ms = AUTOPLAY_MS[speed];
    const id = window.setInterval(() => {
      const r = runRef.current;
      if (!r || !canStep(r.cursorIndex, r.bars.length, r.locked)) {
        setPlaying(false);
        return;
      }
      step();
    }, ms);
    return () => window.clearInterval(id);
  }, [playing, speed, step]);

  const startManual = useCallback(async (input: StartManualInput) => {
    setLoading(true);
    setError(null);
    setPlaying(false);
    try {
      const { bars, compareBars } = await loadPair(
        input.symbol,
        input.timeframe,
        input.startMs,
        input.endMs,
        input.compareSymbol,
      );
      if (bars.length < 10) throw new Error('K 线过少，请扩大时间范围');
      const scenario: TrainingScenario = {
        symbol: input.symbol,
        timeframe: input.timeframe,
        startMs: input.startMs,
        endMs: input.endMs,
        contextBars: input.contextBars ?? DEFAULT_CONTEXT_BARS,
        compareSymbol: input.compareSymbol ?? null,
      };
      setRun(
        buildRun(
          scenario,
          bars,
          compareBars,
          input.startEquity ?? DEFAULT_START_EQUITY,
          input.feeRate ?? DEFAULT_FEE_RATE,
        ),
      );
    } catch (e) {
      setRun(null);
      setError(e instanceof Error ? e.message : '加载 K 线失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const startRandom = useCallback(async (input: StartRandomInput) => {
    setLoading(true);
    setError(null);
    setPlaying(false);
    try {
      let lastErr: unknown;
      for (let i = 0; i < 5; i += 1) {
        const pick = pickRandomScenario(input.pool, { timeframe: input.timeframe });
        if (!pick) throw new Error('训练池为空');
        try {
          const { bars, compareBars } = await loadPair(
            pick.symbol,
            pick.timeframe,
            pick.startMs,
            pick.endMs,
            input.compareSymbol,
          );
          if (bars.length < 20) {
            lastErr = new Error('数据不足');
            continue;
          }
          const scenario: TrainingScenario = {
            symbol: pick.symbol,
            timeframe: pick.timeframe,
            startMs: pick.startMs,
            endMs: pick.endMs,
            contextBars: input.contextBars ?? DEFAULT_CONTEXT_BARS,
            compareSymbol: input.compareSymbol ?? null,
          };
          setRun(
            buildRun(
              scenario,
              bars,
              compareBars,
              input.startEquity ?? DEFAULT_START_EQUITY,
              input.feeRate ?? DEFAULT_FEE_RATE,
            ),
          );
          setLoading(false);
          return;
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error('随机场景加载失败');
    } catch (e) {
      setRun(null);
      setError(e instanceof Error ? e.message : '随机场景失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const reveal = useCallback(() => {
    setPlaying(false);
    setRun((prev) => (prev && !prev.locked ? settleEnd(prev) : prev));
  }, [settleEnd]);

  const reset = useCallback(() => {
    setPlaying(false);
    setRun((prev) => {
      if (!prev) return prev;
      const ledger = emptyLedger(prev.account.startEquity, prev.account.feeRate);
      return {
        ...prev,
        ...ledger,
        account: ledger.account,
        cursorIndex: prev.initialCursorIndex,
        revealed: false,
        locked: false,
        position: null,
        stats: ledger.stats,
        markers: [],
      };
    });
  }, []);

  const applyOrder = useCallback((fn: (run: TrainingRun, bar: Kline, ledger: Ledger) => ReturnType<typeof marketOpen>) => {
    let message: string | null = null;
    setRun((prev) => {
      if (!prev || prev.locked) {
        message = '训练已结算';
        return prev;
      }
      const bar = prev.bars[prev.cursorIndex];
      if (!bar) {
        message = '无当前 K 线';
        return prev;
      }
      const res = fn(prev, bar, ledgerFromRun(prev));
      if (!res.ok) {
        message = res.message;
        return prev;
      }
      return applyLedger(prev, res.value);
    });
    if (message) setError(message);
    else setError(null);
    return message;
  }, []);

  const open = useCallback(
    (direction: Direction, qty: number, leverage: number, sl?: number | null, tp?: number | null) =>
      applyOrder((_r, bar, ledger) => marketOpen(ledger, bar, direction, qty, leverage, sl, tp)),
    [applyOrder],
  );

  const add = useCallback(
    (qty: number) => applyOrder((_r, bar, ledger) => marketAdd(ledger, bar, qty)),
    [applyOrder],
  );

  const close = useCallback(
    (qty?: number) => applyOrder((_r, bar, ledger) => marketClose(ledger, bar, qty)),
    [applyOrder],
  );

  const setStops = useCallback(
    (sl?: number | null, tp?: number | null) =>
      applyOrder((_r, _bar, ledger) => updateStops(ledger, sl, tp)),
    [applyOrder],
  );

  const visibleMain = useMemo(
    () => (run ? visibleBars(run.bars, run.cursorIndex, run.revealed) : []),
    [run],
  );
  const visibleCompare = useMemo(() => {
    if (!run?.compareBars) return null;
    const t = run.bars[run.cursorIndex]?.time ?? null;
    return visibleBarsUntilTime(run.compareBars, t, run.revealed);
  }, [run]);

  const markPrice = run?.bars[run.cursorIndex]?.close ?? null;

  const setCompareSymbol = useCallback(async (raw: string | null) => {
    const current = runRef.current;
    if (!current) return;
    if (!raw) {
      setCompareError(null);
      setRun((prev) =>
        prev
          ? {
              ...prev,
              compareBars: null,
              scenario: { ...prev.scenario, compareSymbol: null },
            }
          : prev,
      );
      return;
    }
    const sym = normalizeSymbol(raw);
    if (!sym || sym === current.scenario.symbol) {
      setCompareError('对比交易对须与主图不同');
      return;
    }
    setCompareLoading(true);
    setCompareError(null);
    try {
      const compareBars = await fetchKlines(sym, current.scenario.timeframe, {
        start: current.scenario.startMs,
        end: current.scenario.endMs,
      });
      if (!compareBars.length) throw new Error('对比 K 线为空');
      setRun((prev) =>
        prev
          ? {
              ...prev,
              compareBars,
              scenario: { ...prev.scenario, compareSymbol: sym },
            }
          : prev,
      );
    } catch (e) {
      setCompareError(e instanceof Error ? e.message : '对比 K 线加载失败');
    } finally {
      setCompareLoading(false);
    }
  }, []);

  return {
    run,
    loading,
    error,
    setError,
    playing,
    setPlaying,
    speed,
    setSpeed,
    stopAutoplay,
    startManual,
    startRandom,
    step,
    reveal,
    reset,
    open,
    add,
    close,
    setStops,
    setCompareSymbol,
    compareLoading,
    compareError,
    visibleMain,
    visibleCompare,
    markPrice,
  };
}
