# K-line training mode

## Goal

Add an independent **K线训练** mode where traders practice decisions on chosen or random market scenarios with simulated positions and bar-by-bar playback under a future mask — without depending on imported trades or polluting real datasets.

Domain language: root `CONTEXT.md`.

## Background

- Existing **复盘** binds imported Trades/Fills to full-range charts (open book).
- `/learn` is static education, not a simulator.
- K-lines already fetch by symbol/timeframe/range; charts already support one compare pane.

## Requirements

### R1 — Independent mode
- New product surface separate from `/replay` and `/learn`.
- Route: `/train`; nav label: **训练**.
- Does not require an active dataset (K-line fetch is global).

### R2 — Training scenario
- **Manual**: pick primary symbol, timeframe (`5m|15m|1h|4h|1d`), start/end, optional compare symbol, context bar count (default 50).
- **Random**: draw primary symbol from **训练池**, timeframe (user-fixed or random among supported), contiguous window with total bars in ~100–300, context bars default 50.
- Scenario is not tied to imported dataset symbols.

### R3 — Training pool
- Editable list of symbols for random draws.
- Ships with built-in mainstream defaults.
- Persist pool (and last form defaults) in browser storage only for MVP.

### R4 — Future mask & playback
- **回放光标**: only bars at/before cursor visible on main and compare charts.
- Controls: step +1 bar, autoplay/pause (speeds 1×/2×/4× per bar), **揭晓**, **重置**.
- No step-back.
- Reveal or reaching scenario end: lift mask to end; if a Simulated Position is open, force flat at end bar close and freeze run stats.
- Reset: cursor → initial, clear position & run stats, remask.

### R5 — Simulated position (medium fidelity)
- Single net direction; size in base asset qty; leverage (cap 20×); fee rate from run config (default 0.05% per side).
- Market open/close fill = close of cursor’s completed bar.
- Optional SL/TP: trigger on later bar high/low; fill at stop/take price.
- Allow add-on (weighted avg entry) and partial close; flip direction only when flat.
- Virtual equity set at run start (default 10_000 USDT), locked for the run.
- No funding rate; no liquidation engine (reject open/add if margin would exceed available equity).
- Never written as Trade/Fill/dataset rows.

### R6 — Compare
- Optional one read-only compare symbol; same cursor & future mask; cannot trade compare.

### R7 — Run stats (ephemeral)
- In-memory only: open count, win rate, realized PnL, fees, equity.
- Lost on refresh; not in analysis page.

### R8 — Non-goals (MVP)
- Persistent training history / server-side sessions.
- Multi compare panes, multi symbol trading.
- Step-back, open-book default, funding, liquidation engine.
- Mixing training fills into real datasets.

## Constraints

- Reuse existing `/api/klines` and chart stack where possible.
- UI copy Chinese; code/paths English.
- One-window workbench layout consistent with product shell.
- Spec layers: frontend + minimal backend only if needed (prefer frontend-only for pool/run state).

## Acceptance Criteria

- [ ] Nav has **训练** → `/train`; page works with no dataset selected.
- [ ] User can start a manual scenario and a random scenario from the training pool.
- [ ] Future bars are hidden until stepped/autoplay/reveal; compare pane follows the same cursor.
- [ ] Step, autoplay (1×/2×/4×), reveal, reset behave as specified; no rewind control.
- [ ] Open/add/partial-close/full-close with leverage & fees; SL/TP trigger on HL; reverse blocked until flat.
- [ ] Insufficient margin rejects the order with a clear message.
- [ ] Reveal/end force-closes open position at end close and freezes stats.
- [ ] Run stats visible for the session; refresh clears them; no new Trade rows in DB.
- [ ] Training pool editable and survives browser refresh (local).
- [ ] `pnpm typecheck` + `pnpm run lint` (frontend) and existing backend tests still pass.

## Decision log (grilling)

See session grilling + `CONTEXT.md`. Key picks: independent mode; future mask; medium sim + add/partial; close/HL pricing; built-in editable pool; no persist; force close on reveal; 50 context bars; main+1 compare.
