# Design — K-line training mode

## Summary

Frontend-first feature: new `/train` workbench owns scenario setup, playback cursor, future-masked charts, and simulated position state. Backend stays on existing kline cache/fetch. Training pool + form defaults in `localStorage`.

## Boundaries

| Layer | Owns | Does not own |
|--|--|--|
| Frontend `/train` | Scenario, cursor, mask, sim ledger, pool UI, run stats | Real Trade/Fill |
| `ChartManager` / training chart | Rendering masked series + compare sync | Order ticket business rules |
| Backend `/api/klines` | OHLCV range (unchanged contract) | Training sessions |
| Dataset context | Unused for training entry | Gatekeeping `/train` |

## Architecture

```
[TrainPage]
  ├─ ScenarioSetup (manual | random, pool editor, equity/fee)
  ├─ PlaybackBar (step, autoplay, speed, reveal, reset)
  ├─ OrderTicket (dir, qty, lev, SL/TP, add/partial/close)
  ├─ RunStatsBar
  └─ TrainingChart (main + optional compare)
        └─ uses fetchKlines; slices series to cursor
[trainingStore]  // React state or small context — in-memory run
[trainingPool]   // localStorage helpers
```

Prefer one `TrainPage` + colocated hooks (`useTrainingRun`, `usePlayback`) over a global store unless reuse forces it.

## Contracts

### Klines (existing)

`GET /api/klines/{symbol}/{timeframe}?start=&end=` → `{ symbol, timeframe, data: Kline[] }`  
No API change required for MVP.

### Training pool (client)

```ts
// localStorage key e.g. retraq.trainingPool
type TrainingPool = string[]; // normalized symbols BTC-USDT
```

Default seed: `BTC-USDT`, `ETH-USDT`, `SOL-USDT`, `BNB-USDT`, `XRP-USDT`, `DOGE-USDT`, `ADA-USDT`, `AVAX-USDT` (adjust if normalize rules need `-USDT` only).

### Training run (in-memory)

```ts
type TrainingScenario = {
  symbol: string;
  timeframe: Timeframe;
  startMs: number;
  endMs: number;
  contextBars: number; // default 50
  compareSymbol?: string | null;
};

type VirtualAccount = {
  startEquity: number; // default 10000
  feeRate: number;     // default 0.0005 per side
  equity: number;      // startEquity + realized - fees accounting
};

type SimPosition = {
  direction: 'long' | 'short';
  qty: number;         // base asset
  entryPrice: number;  // weighted avg
  leverage: number;    // 1..20
  stopLoss?: number | null;
  takeProfit?: number | null;
} | null;

type TrainingRun = {
  scenario: TrainingScenario;
  account: VirtualAccount;
  cursorIndex: number;     // index into loaded bars[]
  initialCursorIndex: number;
  bars: Kline[];           // full scenario main series
  compareBars?: Kline[];
  position: SimPosition;
  revealed: boolean;
  stats: { trades: number; wins: number; realizedPnl: number; fees: number };
  locked: boolean;         // after reveal/end settle
};
```

### Fill rules

- Market open / add / close (manual): price = `bars[cursorIndex].close`.
- Fee = `price * qty * feeRate` (per fill qty).
- Add same direction: `entry' = (entry*qty + price*dq)/(qty+dq)`; leverage: last chosen or keep existing (pick **keep existing leverage on add** for simplicity).
- Partial close: `dq <= qty`; realized on `dq`; reduce qty.
- SL: long if `low <= sl` → fill `sl`; short if `high >= sl` → fill `sl`.
- TP: long if `high >= tp` → fill `tp`; short if `low <= tp` → fill `tp`.
- On each cursor advance to a new bar (after that bar is included), evaluate SL then TP once (if both hit same bar: **SL first** — conservative).
- Margin check: `notional/leverage` required free equity; reject otherwise.
- No liquidation engine.

### Playback

- Cursor advances by index; visible main data = `bars.slice(0, cursorIndex+1)` unless `revealed`.
- Autoplay: `setInterval` by speed map `{1: 800ms, 2: 400ms, 4: 200ms}` (tunable); pause on end/reveal/unmount.
- End: `cursorIndex === bars.length-1` → same settle as reveal.

### Chart integration

**Option A (recommended, smaller risk):** Training-specific chart wrapper that reuses lightweight-charts patterns from `ChartManagerInner` but takes `visibleKlines` + markers for sim entries/exits — do **not** bolt cursor mask into Replay’s trade-centric `ChartManager` props.

**Option B:** Extend `ChartManager` with optional `playbackCursor` — higher coupling to replay.

Choose **A** unless reuse measurement shows >50% pure copy; extract shared chart factory only if duplication is blatant.

Compare: second pane, crosshair sync optional (nice-to-have); mask sync required.

## Data flow

1. User submits setup → fetch main (and compare) klines for range → build `bars` → `initialCursorIndex = contextBars-1` (clamp) → start run.
2. Random: pick symbol from pool; pick tf; pick random end within a safe lookback; start = end - N bars * tfMs; refetch; if thin data, retry few times then error toast.
3. Step/autoplay → increment cursor → apply SL/TP on new bar → update chart slice.
4. Orders mutate `position` / `account` / `stats` at current close.
5. Reveal/end → force close if needed → `locked=true`, `revealed=true`, full series shown.

## Trade-offs

| Choice | Why | Cost |
|--|--|--|
| Frontend-only run | No backend schema; matches ephemeral PRD | No cross-device history |
| Separate training chart | Avoid breaking replay | Some chart code duplication |
| SL before TP same bar | Conservative training | Slightly harsher than some exchanges |
| localStorage pool | Zero API | Cleared with site data |

## Compatibility

- Replay, analysis, import, learn unchanged.
- Navbar adds third tab; dataset picker can remain visible but not required on `/train`.

## Rollout / rollback

- Feature is additive route. Rollback = remove route/nav and training modules; no migration.
- No feature flag required for local-first app.

## ADR candidates (optional later)

- Client-only training ledger vs server sessions — only if we later persist history.
