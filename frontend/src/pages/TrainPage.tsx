import { useEffect, useMemo, useState } from 'react';
import TrainingChart from '../components/TrainingChart';
import { useToast } from '../components/ToastHost';
import { useTrainingRun } from '../hooks/useTrainingRun';
import { TIMEFRAMES, type Timeframe } from '../services/api';
import {
  DEFAULT_CONTEXT_BARS,
  DEFAULT_FEE_RATE,
  DEFAULT_ORDER_USDT,
  DEFAULT_START_EQUITY,
  loadTrainingPool,
  normalizeSymbol,
  saveTrainingPool,
  availableEquity,
  baseToUsdt,
  unrealizedPnl,
  usedMargin,
  MAX_LEVERAGE,
} from '../utils/training';

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
    setCompareSymbol,
    compareLoading,
    compareError,
    visibleMain,
    visibleCompare,
    markPrice,
  } = useTrainingRun();

  const range0 = useMemo(() => defaultRange(), []);
  const [mode, setMode] = useState<'manual' | 'random'>('manual');
  const [symbol, setSymbol] = useState('BTC-USDT');
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');
  const [startLocal, setStartLocal] = useState(range0.start);
  const [endLocal, setEndLocal] = useState(range0.end);
  const [contextBars, setContextBars] = useState(DEFAULT_CONTEXT_BARS);
  const [startEquity, setStartEquity] = useState(DEFAULT_START_EQUITY);
  const [feeRatePct, setFeeRatePct] = useState(DEFAULT_FEE_RATE * 100);
  const [poolText, setPoolText] = useState(() => loadTrainingPool().join('\n'));
  const [showPool, setShowPool] = useState(false);

  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [usdtSize, setUsdtSize] = useState(String(DEFAULT_ORDER_USDT));
  const [leverage, setLeverage] = useState(5);
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [closeQty, setCloseQty] = useState('');

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
  const free =
    run && mark ? availableEquity(run.account, run.position, mark) : run?.account.equity ?? 0;

  // Sync SL/TP fields from position levels only (not on qty/entry churn like add)
  const posSl = run?.position?.stopLoss;
  const posTp = run?.position?.takeProfit;
  const hasPos = Boolean(run?.position);
  useEffect(() => {
    if (!hasPos) return;
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
      if (pool.length === 0) {
        toast('训练池为空', 'error');
        return;
      }
      saveTrainingPool(pool);
      await startRandom({
        pool,
        timeframe,
        contextBars,
        startEquity,
        feeRate,
      });
    }
  };

  const parseOpt = (s: string): number | null => {
    if (!s.trim()) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const handleOpen = () => {
    const u = Number(usdtSize);
    if (!Number.isFinite(u) || u <= 0) {
      toast('金额无效（USDT）', 'error');
      return;
    }
    const err = open(direction, u, leverage, parseOpt(sl), parseOpt(tp));
    if (err) toast(err, 'error');
  };

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden p-2">
      <div className="oc-workbench min-h-0 flex-1 overflow-hidden" data-list-open="true" data-detail-open="true">
        <aside className="panel flex min-h-0 min-w-0 flex-col gap-3 overflow-auto p-3">
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
              <label className="flex flex-col gap-1 text-xs">
                交易对
                <input
                  className="oc-input-wrap"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                开始
                <input
                  type="datetime-local"
                  className="oc-input-wrap"
                  value={startLocal}
                  onChange={(e) => setStartLocal(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
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
              <button type="button" className="oc-btn oc-btn--sm oc-btn--secondary" onClick={() => setShowPool((v) => !v)}>
                {showPool ? '收起训练池' : '编辑训练池'}
              </button>
              {showPool ? (
                <textarea
                  className="oc-input-wrap min-h-28 font-mono text-xs"
                  value={poolText}
                  onChange={(e) => setPoolText(e.target.value)}
                  onBlur={() => saveTrainingPool(pool)}
                />
              ) : (
                <p className="text-xs opacity-70">池内 {pool.length} 个交易对</p>
              )}
            </div>
          )}

          <label className="flex flex-col gap-1 text-xs">
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

          <label className="flex flex-col gap-1 text-xs">
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

          <label className="flex flex-col gap-1 text-xs">
            虚拟本金 (USDT)
            <input
              type="number"
              className="oc-input-wrap"
              value={startEquity}
              onChange={(e) => setStartEquity(Number(e.target.value) || DEFAULT_START_EQUITY)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
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
          {error ? <p className="text-xs text-[var(--oc-danger,#FF3B30)]">{error}</p> : null}
        </aside>

        <section className="panel relative flex min-h-0 min-w-0 flex-col overflow-hidden p-2">
          {!run ? (
            <div className="oc-empty">
              <p className="oc-empty__title">配置左侧场景后开始</p>
              <p className="oc-empty__desc">未来 K 线默认遮罩；逐步回放并用模拟仓位练习</p>
            </div>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="oc-chip">
                  {run.scenario.symbol} · {run.scenario.timeframe}
                </span>
                <span className="opacity-70">
                  光标 {run.cursorIndex + 1}/{run.bars.length}
                  {run.locked ? ' · 已结算' : run.revealed ? ' · 已揭晓' : ''}
                </span>
                <button type="button" className="oc-btn oc-btn--sm oc-btn--secondary" disabled={run.locked || run.cursorIndex >= run.bars.length - 1} onClick={step}>
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
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value) as 1 | 2 | 4)}
                >
                  <option value={1}>1×</option>
                  <option value={2}>2×</option>
                  <option value={4}>4×</option>
                </select>
                <button type="button" className="oc-btn oc-btn--sm oc-btn--secondary" disabled={run.locked} onClick={reveal}>
                  揭晓
                </button>
                <button type="button" className="oc-btn oc-btn--sm oc-btn--ghost" onClick={reset}>
                  重置
                </button>
              </div>
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
                onSelectCompare={(s) => void setCompareSymbol(s)}
                onClearCompare={() => void setCompareSymbol(null)}
              />
            </>
          )}
        </section>

        <aside className="panel flex min-h-0 min-w-0 flex-col gap-3 overflow-auto p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide opacity-70">本局</h2>
          {run ? (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>权益 {run.account.equity.toFixed(2)}</div>
              <div>可用 {free.toFixed(2)}</div>
              <div>已实现 {run.stats.realizedPnl.toFixed(2)}</div>
              <div>手续费 {run.stats.fees.toFixed(2)}</div>
              <div>
                战绩 {run.stats.wins}/{run.stats.trades}
                {run.stats.trades ? ` (${((run.stats.wins / run.stats.trades) * 100).toFixed(0)}%)` : ''}
              </div>
              <div>标记价 {mark ? mark.toFixed(4) : '—'}</div>
            </div>
          ) : (
            <p className="text-xs opacity-60">未开局</p>
          )}

          <h2 className="text-xs font-semibold uppercase tracking-wide opacity-70">模拟仓位</h2>
          {run?.position ? (
            <div className="space-y-1 text-xs">
              <div>
                {run.position.direction === 'long' ? '多' : '空'}{' '}
                {baseToUsdt(run.position.qty, run.position.entryPrice).toFixed(2)} U @{' '}
                {run.position.entryPrice.toFixed(4)} · {run.position.leverage}x
              </div>
              <div className="opacity-70">
                约 {(run.position.qty).toPrecision(6)} 币 · 现价名义{' '}
                {mark ? baseToUsdt(run.position.qty, mark).toFixed(2) : '—'} U
              </div>
              <div>占用保证金 {usedMargin(run.position).toFixed(2)} U</div>
              <div className={uPnl >= 0 ? 'text-[var(--oc-up,#30D158)]' : 'text-[var(--oc-down,#FF3B30)]'}>
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
                onClick={() => setStops(parseOpt(sl), parseOpt(tp))}
              >
                更新止损止盈
              </button>
              <label className="flex flex-col gap-1">
                加仓金额 (USDT)
                <input className="oc-input-wrap" value={usdtSize} onChange={(e) => setUsdtSize(e.target.value)} />
              </label>
              <button
                type="button"
                className="oc-btn oc-btn--sm oc-btn--secondary w-full"
                disabled={run.locked}
                onClick={() => {
                  const err = add(Number(usdtSize));
                  if (err) toast(err, 'error');
                }}
              >
                加仓
              </button>
              <label className="flex flex-col gap-1">
                平仓金额 USDT（空=全平）
                <input className="oc-input-wrap" value={closeQty} onChange={(e) => setCloseQty(e.target.value)} />
              </label>
              <button
                type="button"
                className="oc-btn oc-btn--sm oc-btn--primary w-full"
                disabled={run.locked}
                onClick={() => {
                  const err = close(closeQty.trim() ? Number(closeQty) : undefined);
                  if (err) toast(err, 'error');
                }}
              >
                平仓
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 text-xs">
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
              <label className="flex flex-col gap-1">
                名义金额 (USDT)
                <input className="oc-input-wrap" value={usdtSize} onChange={(e) => setUsdtSize(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                杠杆 1–{MAX_LEVERAGE}
                <input
                  type="number"
                  min={1}
                  max={MAX_LEVERAGE}
                  className="oc-input-wrap"
                  value={leverage}
                  onChange={(e) => setLeverage(Number(e.target.value) || 1)}
                />
              </label>
              <label className="flex flex-col gap-1">
                止损（可选）
                <input className="oc-input-wrap" value={sl} onChange={(e) => setSl(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                止盈（可选）
                <input className="oc-input-wrap" value={tp} onChange={(e) => setTp(e.target.value)} />
              </label>
              <button
                type="button"
                className="oc-btn oc-btn--primary"
                disabled={!run || run.locked}
                onClick={handleOpen}
              >
                开仓
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
