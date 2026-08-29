import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import TrainingChart from '../components/TrainingChart';
import { useToast } from '../components/ToastHost';
import { useTrainingRun } from '../hooks/useTrainingRun';
import { saveTrainingSession, TIMEFRAMES, type Timeframe } from '../services/api';
import { useDataset } from '../context/DatasetContext';
import {
  DEFAULT_CONTEXT_BARS,
  DEFAULT_FEE_RATE,
  DEFAULT_LEVERAGE,
  DEFAULT_MARGIN_FRACTION,
  DEFAULT_START_EQUITY,
  loadTrainingPool,
  normalizeSymbol,
  saveTrainingPool,
  availableEquity,
  clampLeverage,
  liquidationDistance,
  liquidationPrice,
  marginToNotional,
  maxOpenableMargin,
  notionalOf,
  unrealizedPnl,
  usedMargin,
  type SimPosition,
  MAX_LEVERAGE,
  MIN_SCENARIO_BARS,
  MAX_SCENARIO_BARS,
} from '../utils/training';

/** Below this the 强平价 is close enough that the size, not the thesis, decides the outcome. */
const LIQ_WARN_DISTANCE = 0.1;
const MARGIN_PRESETS = [0.25, 0.5, 0.75, 1];
const CLOSE_FRACTIONS = [0.25, 0.5, 1];

function pct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}

/**
 * Committed margin a fraction of the base equity resolves to. The taker fee on the
 * notional is charged on top of the margin, so 100% has to leave room for it or the
 * order would always be rejected.
 */
function resolveMargin(base: number, fraction: number, leverage: number, feeRate: number): number {
  if (!(base > 0)) return 0;
  // 100% means "as much as still opens": the open fee is charged on top of the margin.
  return Math.max(0, Math.min(base * fraction, maxOpenableMargin(base, leverage, feeRate)));
}

function MarginSizer({
  label,
  fraction,
  onFraction,
  margin,
  notional,
}: {
  label: string;
  fraction: number;
  onFraction: (f: number) => void;
  margin: number;
  notional: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="oc-text-faint">{label}</span>
      <div className="oc-tabs oc-tabs--fill">
        {MARGIN_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={`oc-tab${Math.abs(fraction - p) < 1e-9 ? ' oc-tab--active' : ''}`}
            onClick={() => onFraction(p)}
          >
            {Math.round(p * 100)}%
          </button>
        ))}
      </div>
      <input
        type="range"
        className="w-full accent-current"
        min={5}
        max={100}
        step={5}
        value={Math.round(fraction * 100)}
        onChange={(e) => onFraction(Number(e.target.value) / 100)}
      />
      <div className="oc-text-faint">
        {Math.round(fraction * 100)}% · 保证金 {margin.toFixed(2)} U · 名义 {notional.toFixed(2)} U
      </div>
    </div>
  );
}

function LiqReadout({ liq, distance }: { liq: number | null; distance: number | null }) {
  if (liq == null || distance == null) {
    return <div className="oc-text-faint">该仓位不会被强平</div>;
  }
  return (
    <div className={distance < LIQ_WARN_DISTANCE ? 'oc-text-loss' : undefined}>
      强平价 {liq.toFixed(4)} · 距现价 {pct(distance, 2)}
    </div>
  );
}

function defaultRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const toLocal = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return { start: toLocal(start), end: toLocal(end) };
}

export default function TrainPage() {
  const { toast } = useToast();
  const { refreshDatasets } = useDataset();
  const {
    run,
    loading,
    error,
    setError,
    playing,
    setPlaying,
    speed,
    setSpeed,
    startManual,
    startRandom,
    step,
    reveal,
    reset,
    open,
    add,
    close,
    setStops,
    placeOrder,
    cancelOrder,
    reverse,
    setCompareSymbol,
    compareLoading,
    compareError,
    visibleMain,
    visibleCompare,
    markPrice,
    liqPrice,
  } = useTrainingRun();

  const range0 = useMemo(() => defaultRange(), []);
  const [mode, setMode] = useState<'manual' | 'random'>('manual');
  const [symbol, setSymbol] = useState('BTC-USDT');
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');
  const [startLocal, setStartLocal] = useState(range0.start);
  const [endLocal, setEndLocal] = useState(range0.end);
  const [barCount, setBarCount] = useState(200);
  const [randomFromPool, setRandomFromPool] = useState(false);
  const [contextBars, setContextBars] = useState(DEFAULT_CONTEXT_BARS);
  const [startEquity, setStartEquity] = useState(DEFAULT_START_EQUITY);
  const [feeRatePct, setFeeRatePct] = useState(DEFAULT_FEE_RATE * 100);
  const [poolText, setPoolText] = useState(() => loadTrainingPool().join('\n'));
  const [showPool, setShowPool] = useState(false);
  // Scenario config is a once-per-run wizard; it gives the chart its width back
  // as soon as a run starts. 开新局 stays reachable from the chart header.
  const [setupOpen, setSetupOpen] = useState(true);
  const [detailOpen, setDetailOpen] = useState(true);

  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [marginFraction, setMarginFraction] = useState(DEFAULT_MARGIN_FRACTION);
  const [leverage, setLeverage] = useState(DEFAULT_LEVERAGE);
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  // 挂单类型：市价 / 限价 / 止损 / 止损限价（docs/PRODUCT.md §六）
  const [orderKind, setOrderKind] = useState<'market' | 'limit' | 'stop' | 'stop_limit'>('market');
  const [triggerPrice, setTriggerPrice] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [savingRun, setSavingRun] = useState(false);

  const pool = useMemo(
    () =>
      poolText
        .split(/[\n,]+/)
        .map(normalizeSymbol)
        .filter(Boolean),
    [poolText],
  );

  const mark = markPrice ?? 0;
  const uPnl = run?.position && mark ? unrealizedPnl(run.position, mark) : 0;
  // Floors at 0: unrealized loss on a full-size position can drive the raw figure
  // negative, and "可用 -19.82 U" is not a thing a trader can act on.
  const free = Math.max(
    0,
    run && mark ? availableEquity(run.account, run.position, mark) : run?.account.equity ?? 0,
  );

  const feeRate = run?.account.feeRate ?? DEFAULT_FEE_RATE;
  const orderLeverage = run?.position?.leverage ?? leverage;
  const orderMargin = resolveMargin(free, marginFraction, orderLeverage, feeRate);
  const orderNotional = marginToNotional(orderMargin, orderLeverage);

  // Price the order the sim would actually build, so the preview and the fill agree.
  const preview = useMemo(() => {
    if (!run || run.position || !(mark > 0) || !(orderMargin > 0)) return null;
    const lev = clampLeverage(leverage);
    const qty = marginToNotional(orderMargin, lev) / mark;
    if (!(qty > 0)) return null;
    const pos: SimPosition = {
      direction,
      qty,
      openedQty: qty,
      entryPrice: mark,
      leverage: lev,
      stopLoss: null,
      takeProfit: null,
      cyclePnl: 0,
      cycleFees: 0,
      openedAt: 0,
    };
    return {
      liq: liquidationPrice(run.account, pos),
      distance: liquidationDistance(run.account, pos, mark),
    };
  }, [run, mark, orderMargin, leverage, direction]);

  const holdDistance =
    run?.position && mark ? liquidationDistance(run.account, run.position, mark) : null;
  const postmortem = run?.postmortem ?? null;

  // Sync SL/TP fields from position levels only (not on qty/entry churn like add)
  const posSl = run?.position?.stopLoss;
  const posTp = run?.position?.takeProfit;
  const hasPos = Boolean(run?.position);
  useEffect(() => {
    // clear on close so the next open (possibly reversed) never inherits the old levels
    if (!hasPos) {
      setSl('');
      setTp('');
      return;
    }
    setSl(posSl != null ? String(posSl) : '');
    setTp(posTp != null ? String(posTp) : '');
  }, [hasPos, posSl, posTp]);

  const onStart = async () => {
    setError(null);
    const feeRate = feeRatePct / 100;
    if (mode === 'manual') {
      const startMs = new Date(startLocal).getTime();
      const endMs = new Date(endLocal).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        toast('时间范围无效', 'error');
        return;
      }
      await startManual({
        symbol: normalizeSymbol(symbol),
        timeframe,
        startMs,
        endMs,
        contextBars,
        startEquity,
        feeRate,
      });
    } else {
      const n = Math.max(
        MIN_SCENARIO_BARS,
        Math.min(MAX_SCENARIO_BARS, Math.floor(barCount) || 200),
      );
      if (randomFromPool) {
        if (pool.length === 0) {
          toast('训练池为空', 'error');
          return;
        }
        saveTrainingPool(pool);
        await startRandom({
          pool,
          timeframe,
          barCount: n,
          contextBars,
          startEquity,
          feeRate,
        });
      } else {
        const sym = normalizeSymbol(symbol);
        if (!sym) {
          toast('请填写交易对', 'error');
          return;
        }
        await startRandom({
          pool: [sym],
          timeframe,
          barCount: n,
          contextBars,
          startEquity,
          feeRate,
        });
      }
    }
  };

  const parseOpt = (s: string): number | null => {
    if (!s.trim()) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  // `bars` is only ever replaced when a run is (re)built, so it marks a real start
  // rather than a step within the current run.
  const startedBarsRef = useRef<unknown>(null);
  useEffect(() => {
    if (!run) {
      startedBarsRef.current = null;
      return;
    }
    if (run.bars !== startedBarsRef.current) {
      startedBarsRef.current = run.bars;
      setSetupOpen(false);
    }
  }, [run]);

  const handleOpen = () => {
    if (!(orderMargin > 0)) {
      toast('保证金无效', 'error');
      return;
    }
    let err: string | null;
    if (orderKind === 'market') {
      err = open(direction, orderMargin, clampLeverage(leverage), parseOpt(sl), parseOpt(tp));
    } else {
      const trigger = parseOpt(triggerPrice);
      if (trigger == null || trigger <= 0) {
        toast('挂单价格无效', 'error');
        return;
      }
      const limit = orderKind === 'stop_limit' ? parseOpt(limitPrice) : null;
      err = placeOrder(orderKind, direction, orderMargin, clampLeverage(leverage), trigger, limit, parseOpt(sl), parseOpt(tp));
    }
    if (err) toast(err, 'error');
    else setOrderKind('market');
  };

  const handleReverse = () => {
    if (!(orderMargin > 0)) {
      toast('保证金无效', 'error');
      return;
    }
    const err = reverse(orderMargin);
    if (err) toast(err, 'error');
  };

  const handleSaveRun = async () => {
    if (!run || run.closedCycles.length === 0) return;
    setSavingRun(true);
    try {
      const res = await saveTrainingSession({
        symbol: run.scenario.symbol,
        timeframe: run.scenario.timeframe,
        start_equity: run.account.startEquity,
        realized_pnl: run.stats.realizedPnl,
        fees: run.stats.fees,
        trades: run.closedCycles.map((c) => ({
          symbol: run.scenario.symbol,
          direction: c.direction,
          leverage: c.leverage,
          entry_price: c.entryPrice,
          exit_price: c.exitPrice,
          profit: c.profit - c.fees,
          margin: c.margin,
          entry_time: c.entryTime,
          exit_time: c.exitTime,
        })),
      });
      toast(`本局已落库：${res.dataset_name}（${res.trade_count} 笔）`, 'success');
      await refreshDatasets();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : '训练结果保存失败', 'error');
    } finally {
      setSavingRun(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden p-2">
      <div className="oc-canvas min-h-0 flex-1 overflow-hidden">
        <aside
          className={`oc-float-panel oc-float-panel--left${setupOpen ? '' : ' oc-float-panel--hidden'}`}
          aria-hidden={!setupOpen}
        >
          <header className="panel-header flex shrink-0 items-center justify-between gap-2">
            <h2 className="oc-panel__title">场景</h2>
            <button
              type="button"
              className="oc-icon-btn oc-icon-btn--sm oc-panel-hide"
              aria-label="隐藏场景配置"
              onClick={() => setSetupOpen(false)}
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            </button>
          </header>
          <div className="panel-body flex min-h-0 flex-col gap-3">
          <div className="oc-tabs oc-tabs--fill">
            <button
              type="button"
              className={`oc-tab${mode === 'manual' ? ' oc-tab--active' : ''}`}
              onClick={() => setMode('manual')}
            >
              自选
            </button>
            <button
              type="button"
              className={`oc-tab${mode === 'random' ? ' oc-tab--active' : ''}`}
              onClick={() => setMode('random')}
            >
              随机
            </button>
          </div>

          {mode === 'manual' ? (
            <>
              <label className="flex flex-col gap-1 text-[13px]">
                交易对
                <input
                  className="oc-input-wrap"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-[13px]">
                开始
                <input
                  type="datetime-local"
                  className="oc-input-wrap"
                  value={startLocal}
                  onChange={(e) => setStartLocal(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-[13px]">
                结束
                <input
                  type="datetime-local"
                  className="oc-input-wrap"
                  value={endLocal}
                  onChange={(e) => setEndLocal(e.target.value)}
                />
              </label>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={randomFromPool}
                  onChange={(e) => setRandomFromPool(e.target.checked)}
                />
                从训练池随机交易对
              </label>
              {randomFromPool ? (
                <>
                  <button
                    type="button"
                    className="oc-btn oc-btn--sm oc-btn--secondary"
                    onClick={() => setShowPool((v) => !v)}
                  >
                    {showPool ? '收起训练池' : '编辑训练池'}
                  </button>
                  {showPool ? (
                    <textarea
                      className="oc-input-wrap min-h-28 font-mono text-[13px]"
                      value={poolText}
                      onChange={(e) => setPoolText(e.target.value)}
                      onBlur={() => saveTrainingPool(pool)}
                    />
                  ) : (
                    <p className="text-[13px] oc-text-faint">池内 {pool.length} 个交易对</p>
                  )}
                </>
              ) : (
                <label className="flex flex-col gap-1 text-[13px]">
                  交易对
                  <input
                    className="oc-input-wrap"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    placeholder="BTC-USDT"
                  />
                </label>
              )}
              <label className="flex flex-col gap-1 text-[13px]">
                场景根数（{MIN_SCENARIO_BARS}–{MAX_SCENARIO_BARS}）
                <input
                  type="number"
                  className="oc-input-wrap"
                  min={MIN_SCENARIO_BARS}
                  max={MAX_SCENARIO_BARS}
                  value={barCount}
                  onChange={(e) => setBarCount(Number(e.target.value) || 200)}
                />
              </label>
              <p className="text-[13px] oc-text-faint">时间窗口在历史内随机抽取</p>
            </div>
          )}

          <label className="flex flex-col gap-1 text-[13px]">
            周期
            <select
              className="oc-input-wrap"
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as Timeframe)}
            >
              {TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[13px]">
            上下文根数
            <input
              type="number"
              className="oc-input-wrap"
              min={5}
              max={200}
              value={contextBars}
              onChange={(e) => setContextBars(Number(e.target.value) || DEFAULT_CONTEXT_BARS)}
            />
          </label>

          <label className="flex flex-col gap-1 text-[13px]">
            虚拟本金 (USDT)
            <input
              type="number"
              className="oc-input-wrap"
              value={startEquity}
              onChange={(e) => setStartEquity(Number(e.target.value) || DEFAULT_START_EQUITY)}
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            手续费 % / 边
            <input
              type="number"
              step="0.01"
              className="oc-input-wrap"
              value={feeRatePct}
              onChange={(e) => setFeeRatePct(Number(e.target.value))}
            />
          </label>

          <button type="button" className="oc-btn oc-btn--primary" disabled={loading} onClick={() => void onStart()}>
            {loading ? '加载中…' : run ? '开新局' : '开始训练'}
          </button>
          {error ? <p className="text-[13px] oc-text-loss">{error}</p> : null}
          </div>
        </aside>

        <section className="oc-canvas__chart">
          {!setupOpen ? (
            <button
              type="button"
              className="oc-panel-rail oc-panel-rail--left"
              aria-label="显示场景配置"
              onClick={() => setSetupOpen(true)}
            >
              场景
            </button>
          ) : null}
          {!detailOpen ? (
            <button
              type="button"
              className="oc-panel-rail oc-panel-rail--right"
              aria-label="显示本局面板"
              onClick={() => setDetailOpen(true)}
            >
              本局
            </button>
          ) : null}
          {!run ? (
            <div className="oc-empty">
              <p className="oc-empty__title">配置场景后开始</p>
              <p className="oc-empty__desc">未来 K 线默认遮罩；逐步回放并用模拟仓位练习</p>
            </div>
          ) : (
            <>
              <header className="panel-header flex shrink-0 flex-wrap items-center gap-2">
                <span className="oc-chip">
                  {run.scenario.symbol} · {run.scenario.timeframe}
                </span>
                <span className="text-[13px] tabular-nums oc-text-faint">
                  {run.cursorIndex + 1}/{run.bars.length}
                  {run.locked ? ' · 已结算' : run.revealed ? ' · 已揭晓' : ''}
                </span>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="oc-btn oc-btn--sm oc-btn--secondary"
                    disabled={run.locked || run.cursorIndex >= run.bars.length - 1}
                    onClick={step}
                  >
                    前进一步
                  </button>
                  <button
                    type="button"
                    className="oc-btn oc-btn--sm oc-btn--secondary"
                    disabled={run.locked}
                    onClick={() => setPlaying((p) => !p)}
                  >
                    {playing ? '暂停' : '自动播放'}
                  </button>
                  <select
                    className="oc-input-wrap w-auto"
                    aria-label="播放速度"
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value) as 1 | 2 | 4)}
                  >
                    <option value={1}>1×</option>
                    <option value={2}>2×</option>
                    <option value={4}>4×</option>
                  </select>
                  <button
                    type="button"
                    className="oc-btn oc-btn--sm oc-btn--secondary"
                    disabled={run.locked}
                    onClick={reveal}
                  >
                    揭晓
                  </button>
                  <button
                    type="button"
                    className="oc-btn oc-btn--sm oc-btn--ghost"
                    disabled={loading}
                    onClick={() => void onStart()}
                  >
                    {loading ? '加载中…' : '开新局'}
                  </button>
                  <button type="button" className="oc-btn oc-btn--sm oc-btn--ghost" onClick={reset}>
                    重置
                  </button>
                  {run.locked && run.closedCycles.length > 0 ? (
                    <button
                      type="button"
                      className="oc-btn oc-btn--sm oc-btn--primary"
                      disabled={savingRun}
                      onClick={() => void handleSaveRun()}
                      title="闭环交易落库为 sim 数据集，可进复盘与分析"
                    >
                      {savingRun ? '保存中…' : '落库本局'}
                    </button>
                  ) : null}
                </div>
              </header>
              <TrainingChart
                symbol={run.scenario.symbol}
                timeframe={run.scenario.timeframe}
                klines={visibleMain}
                scenarioFromSec={run.bars[0]?.time ?? 0}
                scenarioToSec={run.bars[run.bars.length - 1]?.time ?? 0}
                compareSymbol={run.scenario.compareSymbol}
                compareKlines={visibleCompare}
                compareLoading={compareLoading}
                compareError={compareError}
                symbolOptions={pool}
                markers={run.markers}
                liqPrice={liqPrice}
                slPrice={run.position?.stopLoss ?? null}
                tpPrice={run.position?.takeProfit ?? null}
                onSelectCompare={(s) => void setCompareSymbol(s)}
                onClearCompare={() => void setCompareSymbol(null)}
              />
            </>
          )}
        </section>

        <aside
          className={`oc-float-panel oc-float-panel--right${detailOpen ? '' : ' oc-float-panel--hidden'}`}
          aria-hidden={!detailOpen}
        >
          <header className="panel-header flex shrink-0 items-center justify-between gap-2">
            <h2 className="oc-panel__title">本局</h2>
            <button
              type="button"
              className="oc-icon-btn oc-icon-btn--sm oc-panel-hide"
              aria-label="隐藏本局面板"
              onClick={() => setDetailOpen(false)}
            >
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </header>
          <div className="panel-body min-h-0 flex-1 space-y-3">
          {run?.liquidated ? (
            <div className="space-y-2 text-[13px]">
              <p className="text-[14px] font-medium oc-text-loss">本局以爆仓结束，权益归零。</p>
              {postmortem ? (
                <>
                  <p>
                    本局最大逆向 {pct(postmortem.adverseExcursion)}；
                    {postmortem.maxSurvivableMargin != null && postmortem.maxSurvivableFraction != null
                      ? `同样的入场，保证金最多投入 ${postmortem.maxSurvivableMargin.toFixed(0)} U（权益的 ${pct(postmortem.maxSurvivableFraction)}）才能活到最后，你投了 ${postmortem.usedMargin.toFixed(0)} U。`
                      : `按这段行情，任何仓位规模都不会被强平，你投了 ${postmortem.usedMargin.toFixed(0)} U。`}
                  </p>
                  <p className="oc-text-faint">假设其他操作不变，仅按比例缩小仓位。</p>
                </>
              ) : null}
              <div className="oc-stat-grid oc-stat-grid--cols-2">
                <div className="oc-stat">
                  <div className="oc-stat__label">已实现</div>
                  <div className="oc-stat__value">{run.stats.realizedPnl.toFixed(2)}</div>
                </div>
                <div className="oc-stat">
                  <div className="oc-stat__label">手续费</div>
                  <div className="oc-stat__value">{run.stats.fees.toFixed(2)}</div>
                </div>
              </div>
            </div>
          ) : run ? (
            <div className="oc-stat-grid oc-stat-grid--cols-2">
              <div className="oc-stat">
                <div className="oc-stat__label">权益</div>
                <div className="oc-stat__value">{run.account.equity.toFixed(2)}</div>
              </div>
              <div className="oc-stat">
                <div className="oc-stat__label">可用</div>
                <div className="oc-stat__value">{free.toFixed(2)}</div>
              </div>
              <div className="oc-stat">
                <div className="oc-stat__label">已实现</div>
                <div className={`oc-stat__value ${run.stats.realizedPnl >= 0 ? 'oc-text-profit' : 'oc-text-loss'}`}>
                  {run.stats.realizedPnl.toFixed(2)}
                </div>
              </div>
              <div className="oc-stat">
                <div className="oc-stat__label">手续费</div>
                <div className="oc-stat__value">{run.stats.fees.toFixed(2)}</div>
              </div>
              <div className="oc-stat">
                <div className="oc-stat__label">战绩</div>
                <div className="oc-stat__value">
                  {run.stats.wins}/{run.stats.trades}
                  {run.stats.trades
                    ? ` · ${((run.stats.wins / run.stats.trades) * 100).toFixed(0)}%`
                    : ''}
                </div>
              </div>
              <div className="oc-stat">
                <div className="oc-stat__label">标记价</div>
                <div className="oc-stat__value">{mark ? mark.toFixed(4) : '—'}</div>
              </div>
            </div>
          ) : (
            <p className="text-[13px] oc-text-faint">未开局</p>
          )}

          <h3 className="panel-card-title">模拟仓位</h3>
          {!run ? (
            <p className="text-[13px] oc-text-faint">开局后可下单</p>
          ) : run.position ? (
            <div className="space-y-2 text-[13px]">
              <div>
                {run.position.direction === 'long' ? '多' : '空'} @ {run.position.entryPrice.toFixed(4)}
              </div>
              <div>
                保证金 {usedMargin(run.position).toFixed(2)} U · 名义{' '}
                {notionalOf(run.position, mark || run.position.entryPrice).toFixed(2)} U ·{' '}
                {run.position.leverage}x · 强平价 {liqPrice != null ? liqPrice.toFixed(4) : '不会强平'}
              </div>
              <div className="oc-text-faint">约 {run.position.qty.toPrecision(6)} 币</div>
              <div
                className={
                  holdDistance != null && holdDistance < LIQ_WARN_DISTANCE
                    ? 'oc-text-loss'
                    : 'oc-text-faint'
                }
              >
                {holdDistance != null ? `强平价距现价 ${pct(holdDistance, 2)}` : '该仓位不会被强平'}
              </div>
              <div className={uPnl >= 0 ? 'oc-text-profit' : 'oc-text-loss'}>
                浮盈 {uPnl.toFixed(2)}
              </div>
              <div className="flex gap-2">
                <input
                  className="oc-input-wrap flex-1"
                  placeholder="止损"
                  value={sl}
                  onChange={(e) => setSl(e.target.value)}
                />
                <input
                  className="oc-input-wrap flex-1"
                  placeholder="止盈"
                  value={tp}
                  onChange={(e) => setTp(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="oc-btn oc-btn--sm oc-btn--secondary w-full"
                disabled={run.locked}
                onClick={() => {
                  const err = setStops(parseOpt(sl), parseOpt(tp));
                  if (err) toast(err, 'error');
                }}
              >
                更新止损止盈
              </button>
              {free > 0 ? (
                <>
                  <MarginSizer
                    label={`加仓保证金（可用 ${free.toFixed(2)} U）`}
                    fraction={marginFraction}
                    onFraction={setMarginFraction}
                    margin={orderMargin}
                    notional={orderNotional}
                  />
                  <button
                    type="button"
                    className="oc-btn oc-btn--sm oc-btn--secondary w-full"
                    disabled={run.locked}
                    onClick={() => {
                      const err = add(orderMargin);
                      if (err) toast(err, 'error');
                    }}
                  >
                    加仓
                  </button>
                  <button
                    type="button"
                    className="oc-btn oc-btn--sm oc-btn--secondary w-full"
                    disabled={run.locked}
                    onClick={handleReverse}
                    title="平掉全部持仓，同保证金反向开回"
                  >
                    反向开仓
                  </button>
                </>
              ) : (
                <p className="oc-text-faint">保证金已用尽，无法加仓</p>
              )}
              <div className="oc-text-faint">平仓比例</div>
              <div className="flex gap-2">
                {CLOSE_FRACTIONS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`oc-btn oc-btn--sm flex-1 ${f === 1 ? 'oc-btn--primary' : 'oc-btn--secondary'}`}
                    disabled={run.locked}
                    onClick={() => {
                      const err = close(f === 1 ? undefined : f);
                      if (err) toast(err, 'error');
                    }}
                  >
                    {f === 1 ? '全平' : `${Math.round(f * 100)}%`}
                  </button>
                ))}
              </div>
            </div>
          ) : run.pendingOrder ? (
            <div className="flex flex-col gap-2 text-[13px]">
              <div className="panel-card space-y-1">
                <div className="font-mono text-[12px]">
                  挂单 ·{' '}
                  {run.pendingOrder.kind === 'limit'
                    ? '限价'
                    : run.pendingOrder.kind === 'stop'
                      ? '止损单'
                      : '止损限价'}{' '}
                  {run.pendingOrder.direction === 'long' ? '做多' : '做空'} @{' '}
                  {run.pendingOrder.price}
                  {run.pendingOrder.limitPrice != null ? ` → ${run.pendingOrder.limitPrice}` : ''}
                </div>
                <div className="text-[12px] oc-text-faint">
                  保证金 {run.pendingOrder.marginUsdt.toFixed(2)} U · {run.pendingOrder.leverage}x
                </div>
              </div>
              <button
                type="button"
                className="oc-btn oc-btn--sm oc-btn--secondary w-full"
                disabled={run.locked}
                onClick={() => {
                  const err = cancelOrder();
                  if (err) toast(err, 'error');
                }}
              >
                撤销挂单
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 text-[13px]">
              <div className="oc-tabs oc-tabs--fill">
                <button
                  type="button"
                  className={`oc-tab${direction === 'long' ? ' oc-tab--active' : ''}`}
                  onClick={() => setDirection('long')}
                >
                  多
                </button>
                <button
                  type="button"
                  className={`oc-tab${direction === 'short' ? ' oc-tab--active' : ''}`}
                  onClick={() => setDirection('short')}
                >
                  空
                </button>
              </div>
              <MarginSizer
                label={`保证金（权益 ${free.toFixed(2)} U）`}
                fraction={marginFraction}
                onFraction={setMarginFraction}
                margin={orderMargin}
                notional={orderNotional}
              />
              <label className="flex flex-col gap-1">
                杠杆 1–{MAX_LEVERAGE}
                <input
                  type="number"
                  min={1}
                  max={MAX_LEVERAGE}
                  className="oc-input-wrap"
                  value={leverage}
                  onChange={(e) => setLeverage(clampLeverage(Number(e.target.value) || 1))}
                />
              </label>
              <div className="flex flex-col gap-0.5">
                {preview ? (
                  <LiqReadout liq={preview.liq} distance={preview.distance} />
                ) : (
                  <div className="oc-text-faint">强平价 —</div>
                )}
                <span className="oc-text-faint">仓位越重，容错越小</span>
              </div>
              <label className="flex flex-col gap-1">
                止损（可选）
                <input className="oc-input-wrap" value={sl} onChange={(e) => setSl(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                止盈（可选）
                <input className="oc-input-wrap" value={tp} onChange={(e) => setTp(e.target.value)} />
              </label>
              <div className="oc-tabs oc-tabs--fill">
                {([
                  ['market', '市价'],
                  ['limit', '限价'],
                  ['stop', '止损'],
                  ['stop_limit', '止损限价'],
                ] as const).map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    className={`oc-tab${orderKind === kind ? ' oc-tab--active' : ''}`}
                    onClick={() => setOrderKind(kind)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {orderKind !== 'market' ? (
                <label className="flex flex-col gap-1">
                  {orderKind === 'limit' ? '限价' : '触发价'}
                  <input
                    className="oc-input-wrap font-mono"
                    value={triggerPrice}
                    onChange={(e) => setTriggerPrice(e.target.value)}
                    placeholder={mark ? String(mark) : ''}
                  />
                </label>
              ) : null}
              {orderKind === 'stop_limit' ? (
                <label className="flex flex-col gap-1">
                  委托价（触发后的限价）
                  <input
                    className="oc-input-wrap font-mono"
                    value={limitPrice}
                    onChange={(e) => setLimitPrice(e.target.value)}
                  />
                </label>
              ) : null}
              <button
                type="button"
                className="oc-btn oc-btn--primary"
                disabled={!run || run.locked}
                onClick={handleOpen}
              >
                {orderKind === 'market' ? '开仓' : '下挂单'}
              </button>
            </div>
          )}
          </div>
        </aside>
      </div>
    </div>
  );
}
