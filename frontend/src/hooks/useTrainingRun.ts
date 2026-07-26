import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchKlines, type Kline, type Timeframe } from '../services/api';
import {
  AUTOPLAY_MS,
  applyBarExits,
  buildPostmortem,
  canStep,
  emptyLedger,
  initialCursorIndex,
  liquidationPrice,
  replayExits,
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
  type SimPosition,
  type TrainingRun,
  type TrainingScenario,
  DEFAULT_CONTEXT_BARS,
  DEFAULT_FEE_RATE,
  DEFAULT_START_EQUITY,
  MIN_DECISION_BARS,
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
  /** Fixed scenario length; omit to randomize within MIN..MAX. */
  barCount?: number;
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
  // leave MIN_DECISION_BARS ahead of the cursor, but never collapse context below half the response
  const minContext = Math.min(scenario.contextBars, Math.max(1, Math.floor(bars.length / 2)));
  const contextBars = Math.max(
    minContext,
    Math.min(scenario.contextBars, bars.length - MIN_DECISION_BARS),
  );
  const initial = initialCursorIndex(bars.length, contextBars);
  return {
    scenario: { ...scenario, contextBars },
    account: ledger.account,
    cursorIndex: initial,
    initialCursorIndex: initial,
    bars,
    compareBars,
    position: null,
    revealed: false,
    locked: false,
    liquidated: false,
    postmortem: null,
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
  const compareReqRef = useRef(0);
  const runRef = useRef(run);
  runRef.current = run;
  playRef.current = playing;

  const stopAutoplay = useCallback(() => setPlaying(false), []);

  /** 爆仓 ends the run on the spot: unmask the rest and explain what size would have lived. */
  const settleLiquidation = useCallback(
    (current: TrainingRun, liquidatedPos: SimPosition, equityAtEntry: number): TrainingRun => {
      // Entry fills at the opening bar's close, so that bar's own low is not yet
      // adverse excursion; the exposure starts on the next bar.
      const after = current.bars.filter((b) => b.time > liquidatedPos.openedAt);
      return {
        ...current,
        revealed: true,
        locked: true,
        liquidated: true,
        postmortem: buildPostmortem(liquidatedPos, equityAtEntry, after),
        cursorIndex: Math.max(0, current.bars.length - 1),
      };
    },
    [],
  );

  const settleEnd = useCallback(
    (current: TrainingRun): TrainingRun => {
      let next: TrainingRun = { ...current, revealed: true, locked: true };
      // Replay the masked bars instead of jumping to the end: 揭晓 must not let an
      // open position skip a stop it would have hit — or a 爆仓 it would have taken.
      const replay = replayExits(ledgerFromRun(next), current.bars.slice(current.cursorIndex + 1));
      next = applyLedger(next, replay.ledger);
      if (replay.liquidation) {
        return settleLiquidation(next, replay.liquidation.position, replay.liquidation.backingBalance);
      }
      if (next.position && next.bars.length > 0) {
        const endBar = next.bars[next.bars.length - 1]!;
        const r = marketClose(ledgerFromRun(next), endBar);
        if (r.ok) next = applyLedger(next, r.value);
      }
      next.cursorIndex = Math.max(0, next.bars.length - 1);
      return next;
    },
    [settleLiquidation],
  );

  const step = useCallback(() => {
    setRun((prev) => {
      if (!prev || !canStep(prev.cursorIndex, prev.bars.length, prev.locked)) return prev;
      const nextIndex = prev.cursorIndex + 1;
      const bar = prev.bars[nextIndex]!;
      const openPos = prev.position;
      // Cross margin: equity is the untouched balance backing the position, which is
      // exactly the B in the liquidation identity.
      const backingBalance = prev.account.equity;
      let next: TrainingRun = { ...prev, cursorIndex: nextIndex };
      const exits = applyBarExits(ledgerFromRun(next), bar);
      next = applyLedger(next, exits.ledger);
      if (exits.liquidated && openPos) {
        return settleLiquidation(next, openPos, backingBalance);
      }
      if (nextIndex >= next.bars.length - 1) return settleEnd(next);
      return next;
    });
  }, [settleEnd, settleLiquidation]);

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

  /** Invalidate any compare fetch still in flight for the previous run. */
  const resetCompareState = useCallback(() => {
    compareReqRef.current += 1;
    setCompareLoading(false);
    setCompareError(null);
  }, []);

  const startManual = useCallback(async (input: StartManualInput) => {
    setLoading(true);
    setError(null);
    setPlaying(false);
    resetCompareState();
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
  }, [resetCompareState]);

  const startRandom = useCallback(async (input: StartRandomInput) => {
    setLoading(true);
    setError(null);
    setPlaying(false);
    resetCompareState();
    try {
      const contextBars = input.contextBars ?? DEFAULT_CONTEXT_BARS;
      let lastErr: unknown;
      for (let i = 0; i < 5; i += 1) {
        const pick = pickRandomScenario(input.pool, {
          timeframe: input.timeframe,
          barCount: input.barCount,
        });
        if (!pick) throw new Error('训练池为空');
        try {
          const { bars, compareBars } = await loadPair(
            pick.symbol,
            pick.timeframe,
            pick.startMs,
            pick.endMs,
            input.compareSymbol,
          );
          // need context plus a usable decision window, but never more than the draw asked for
          if (bars.length < Math.min(pick.barCount, contextBars + MIN_DECISION_BARS)) {
            lastErr = new Error('数据不足');
            continue;
          }
          const scenario: TrainingScenario = {
            symbol: pick.symbol,
            timeframe: pick.timeframe,
            startMs: pick.startMs,
            endMs: pick.endMs,
            contextBars,
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
          // 400 = the symbol itself is unknown, so redrawing it is pointless; 404 only
          // means this window held no candles, which another draw may well fix.
          const status = (e as { status?: number })?.status;
          if (input.pool.length === 1 && status === 400) break;
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error('随机场景加载失败');
    } catch (e) {
      setRun(null);
      setError(e instanceof Error ? e.message : '随机场景失败');
    } finally {
      setLoading(false);
    }
  }, [resetCompareState]);

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
        liquidated: false,
        postmortem: null,
        position: null,
        stats: ledger.stats,
        markers: [],
      };
    });
  }, []);

  // Resolve against runRef synchronously: the caller toasts the rejection, so it cannot wait for a render.
  const applyOrder = useCallback((fn: (run: TrainingRun, bar: Kline, ledger: Ledger) => ReturnType<typeof marketOpen>) => {
    const prev = runRef.current;
    if (!prev || prev.locked) return '训练已结算';
    const bar = prev.bars[prev.cursorIndex];
    if (!bar) return '无当前 K 线';
    const res = fn(prev, bar, ledgerFromRun(prev));
    if (!res.ok) return res.message;
    setRun((cur) => {
      if (!cur) return cur;
      if (cur === prev) return applyLedger(cur, res.value);
      // Autoplay can advance the run between the check above and this commit; recompute
      // against the fresh state rather than dropping the order silently.
      if (cur.locked) return cur;
      const freshBar = cur.bars[cur.cursorIndex];
      if (!freshBar) return cur;
      const retry = fn(cur, freshBar, ledgerFromRun(cur));
      return retry.ok ? applyLedger(cur, retry.value) : cur;
    });
    return null;
  }, []);

  /** marginUsdt: committed margin; leverage turns it into notional inside sim. */
  const open = useCallback(
    (direction: Direction, marginUsdt: number, leverage: number, sl?: number | null, tp?: number | null) =>
      applyOrder((_r, bar, ledger) => marketOpen(ledger, bar, direction, marginUsdt, leverage, sl, tp)),
    [applyOrder],
  );

  const add = useCallback(
    (marginUsdt: number) => applyOrder((_r, bar, ledger) => marketAdd(ledger, bar, marginUsdt)),
    [applyOrder],
  );

  /** fraction: share of the position to close (0–1]; omit for a full close. */
  const close = useCallback(
    (fraction?: number) => applyOrder((_r, bar, ledger) => marketClose(ledger, bar, fraction)),
    [applyOrder],
  );

  const setStops = useCallback(
    (sl?: number | null, tp?: number | null) =>
      applyOrder((_r, bar, ledger) => updateStops(ledger, bar, sl, tp)),
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
  /** Live 强平价 for the open position; null when flat or unliquidatable. */
  const liqPrice = useMemo(
    () => (run ? liquidationPrice(run.account, run.position) : null),
    [run],
  );

  const setCompareSymbol = useCallback(async (raw: string | null) => {
    const current = runRef.current;
    if (!current) return;
    // only the newest compare request may land
    const reqId = compareReqRef.current + 1;
    compareReqRef.current = reqId;
    if (!raw) {
      setCompareError(null);
      setCompareLoading(false);
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
      setCompareLoading(false);
      return;
    }
    setCompareLoading(true);
    setCompareError(null);
    try {
      const compareBars = await fetchKlines(sym, current.scenario.timeframe, {
        start: current.scenario.startMs,
        end: current.scenario.endMs,
      });
      if (compareReqRef.current !== reqId) return;
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
      if (compareReqRef.current !== reqId) return;
      setCompareError(e instanceof Error ? e.message : '对比 K 线加载失败');
    } finally {
      if (compareReqRef.current === reqId) setCompareLoading(false);
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
    liqPrice,
  };
}
