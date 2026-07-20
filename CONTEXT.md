# Retraq

Local-first crypto futures trade journal: import fills, replay real trades on K-lines, and (planned) train decision-making on simulated scenarios.

## Language

**复盘 (Replay)**:
Review of the trader's own imported closed trades on K-line charts with real fill markers.
_Avoid_: 训练, training, paper trading

**K线训练 (K-line Training)**:
A separate mode for decision practice on chosen or random market scenarios using simulated positions and controlled K-line playback — not bound to imported trades.
_Avoid_: 学习 (/learn is static education), 复盘, paper trading as product name

**交易对 (Symbol)**:
A futures market identifier such as `BTC-USDT`.
_Avoid_: 币种 alone when a full pair is meant, ticker without quote

**成交 (Fill)**:
A real imported execution from exchange history, belonging to a Trade.
_Avoid_: 模拟成交 for real fills

**仓位 (Position)** — historical sense:
A closed (or open) real trade aggregated from fills in a dataset.
_Avoid_: using this alone for training paper exposure (use 模拟仓位)

**模拟仓位 (Simulated Position)**:
Paper net exposure during K-line Training: one direction at a time, sized in base-asset quantity, with leverage, fees, optional stop/take-profit, add-on entries (weighted average price), and partial closes. Not a real Trade/Fill; flipping direction requires flat first.
_Avoid_: Trade, 成交, 仓位 without qualifier, hedge dual-side book

**虚拟权益 (Virtual Equity)**:
Per Training Run paper balance used for margin and fee accounting. Chosen at run start (default 10_000 USDT, configurable fee rate), then locked for the run. No funding rate and no liquidation engine in MVP.
_Avoid_: exchange wallet, dataset balance

**回放光标 (Playback Cursor)**:
The current time boundary in a training scenario: only bars at or before this cursor are visible. Advances one completed bar at a time (manual step or autoplay); no step-back — reset restarts the scenario.
_Avoid_: scrubber alone, playhead without the mask meaning, rewind

**未来遮罩 (Future Mask)**:
Default training rule that hides all K-line data after the Playback Cursor on main and compare charts until explicit reveal.
_Avoid_: fog of war as product term, open-book chart browsing

**训练场景 (Training Scenario)**:
A fixed market slice for one training run: primary symbol, timeframe, start/end time, and initial Playback Cursor. Built by manual pick or random draw; not tied to an imported dataset. Optional one read-only compare symbol shares the same cursor and Future Mask; only the primary symbol accepts Simulated Positions. Default Playback Cursor sits after 50 context bars (configurable on manual setup).
_Avoid_: dataset, replay session, chart range without training intent

**训练池 (Training Pool)**:
Editable list of symbols eligible for random scenario draws; ships with a built-in mainstream default set.
_Avoid_: dataset symbols, exchange full universe

**模拟成交价 (Simulated Fill Price)**:
Market open/close fills use the close of the cursor's completed bar; stop-loss / take-profit fills trigger on a later bar's high/low and execute at the stop/take price.
_Avoid_: mid price, last trade, user-picked wick price

**揭晓 (Reveal)**:
Explicit action that lifts the Future Mask to the scenario end so the trader can review outcomes; not the same as stepping the cursor bar-by-bar.
_Avoid_: auto-unmask on hover, peek

**训练局 (Training Run)**:
One in-memory play of a Training Scenario: cursor, Simulated Positions, and run stats. Discarded on refresh; never written into a real dataset. Reveal or reaching the scenario end force-closes any open Simulated Position at the end bar's close and freezes run stats.
_Avoid_: dataset session, persistent journal entry, Trade
