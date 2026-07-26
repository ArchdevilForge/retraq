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
Paper net exposure during K-line Training: one direction at a time. Sized by committed margin × leverage — the trader chooses how much Virtual Equity to commit, and leverage turns that into notional. Fees, optional stop/take-profit, add-on entries (weighted average price), and partial closes by fraction. Not a real Trade/Fill; flipping direction requires flat first.
_Avoid_: Trade, 成交, 仓位 without qualifier, hedge dual-side book, sizing by notional (that is derived, not entered)

**虚拟权益 (Virtual Equity)**:
Per Training Run paper balance, chosen at run start (default 1000 USDT, configurable fee rate) then locked. Backs the Simulated Position **cross-margin**: the whole balance is at risk, so survival depends on how much of it a position's notional represents, not on leverage alone. No funding rate.
_Avoid_: exchange wallet, dataset balance, isolated margin

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
Market open/add/close fills use the close of the cursor's completed bar. Stop-loss, take-profit and Liquidation Price trigger on a later bar's high/low and execute at their own level, clamped inside that bar — a bar that gapped past a level fills at its open. When a bar touches several levels, the one price reaches first wins, so a stop tighter than the Liquidation Price prevents a 爆仓.
_Avoid_: mid price, last trade, user-picked wick price, a fixed stop-before-take priority

**强平价 (Liquidation Price)**:
The price at which a Simulated Position's mark-to-market Virtual Equity falls to its maintenance margin. Derived from equity, notional and direction — never entered. Shown live while sizing an order and on the chart while the position is open, so the cost of a size is visible before the order.
_Avoid_: margin call, stop-out level, confusing it with a stop-loss

**爆仓 (Liquidation)**:
The Liquidation Price being reached: the Simulated Position is force-closed, Virtual Equity goes to zero, and the Training Run ends there — the only outcome that terminates a run early. Recorded as a losing trade plus a distinct run-level flag.
_Avoid_: 强平 as a synonym for 止损, partial liquidation, treating it as an ordinary exit

**最大安全仓位 (Max Survivable Size)**:
Shown after a 爆仓: the largest committed margin that would have survived the rest of the scenario, derived from the worst adverse excursion after entry. Assumes every other action is unchanged and only the size is scaled down — it never claims a better exit was available.
_Avoid_: optimal size, best trade, presenting it as the profit that was missed

**揭晓 (Reveal)**:
Explicit action that lifts the Future Mask to the scenario end so the trader can review outcomes; not the same as stepping the cursor bar-by-bar.
_Avoid_: auto-unmask on hover, peek

**训练局 (Training Run)**:
One in-memory play of a Training Scenario: cursor, Simulated Positions, and run stats. Discarded on refresh; never written into a real dataset. Reveal or reaching the scenario end force-closes any open Simulated Position at the end bar's close and freezes run stats. A 爆仓 ends the run on the spot, lifts the Future Mask automatically, and reports the Max Survivable Size.
_Avoid_: dataset session, persistent journal entry, Trade
