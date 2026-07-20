# Implement — K-line training mode

## Order

### 1. Domain pure logic (frontend)
- [ ] `frontend/src/utils/training/` (or `services/training/`): pool defaults + localStorage load/save
- [ ] Fill/PnL helpers: open, add, partial close, full close, fee, margin check, SL/TP on bar, force settle
- [ ] Playback helpers: initial cursor from contextBars, clamp, advance, reveal
- [ ] Tiny self-check or `*.test.ts` if project already has vitest; else assert-style unit in pure functions’ neighbor test file only if harness exists — otherwise keep pure and cover via manual QA checklist below

### 2. Run state hook
- [ ] `useTrainingRun`: scenario start (manual/random), cursor, autoplay timer cleanup, order actions, reveal/reset
- [ ] Random window sampler with retry on empty klines

### 3. Train page UI
- [ ] Route `/train` in `App.tsx`; nav **训练** in `Navbar`
- [ ] `TrainPage`: setup panel, playback bar, order ticket, stats, chart host
- [ ] Chinese copy; disabled states when locked / no run

### 4. Training chart
- [ ] Masked candlestick (+ volume optional) for main; optional compare pane
- [ ] Markers for sim entry/exit; reuse theme tokens from existing charts
- [ ] Do not regress `ReplayPage` / `ChartManager`

### 5. Wire klines
- [ ] Use `fetchKlines` with start/end; loading/error empty states

### 6. Polish & QA
- [ ] Keyboard: optional Space = step (only if cheap)
- [ ] Edge cases: empty pool, margin reject, SL/TP same bar, reveal with partial position, reset mid-autoplay

## Validation

```bash
cd frontend && pnpm typecheck && pnpm run lint
cd backend && uv run pytest -q
```

Manual:
1. No dataset → open 训练 → manual BTC 15m range → see context bars only → step → future appears one bar at a time.
2. Open long → step → unrealized moves → partial close → add → full close; fees reduce equity.
3. Set SL → advance until hit → auto flat at SL price.
4. Compare on → both mask together.
5. Random from pool works; edit pool, refresh, pool persists.
6. Reveal with open pos → forced close at end; stats frozen; reset clears.
7. 复盘 still works with trade markers.

## Review gates

- Before start: prd/design/implement reviewed (this pass).
- After implement: trellis-check; no Trade rows created during training.
- Diff should not rewrite ChartManager behavior for replay unless extracting shared util carefully.

## Rollback points

- After step 1–2 only: no user-facing change.
- After route: hide nav link + route if broken.
- Full rollback: delete train modules + nav/route.

## Out of scope reminders

Server history, liquidation, multi-compare, rewind, dataset binding.
