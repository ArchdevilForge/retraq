# Component Guidelines

> How components are built in this project.

---

## Overview

- **Stack**: React 19, Tailwind 4, OpenCode `oc-*` design system (`frontend/src/styles/opencode.css`). Lucide icons.
- **Design tokens**: `docs/DESIGN.md`, `frontend/src/styles/opencode.css`, interactive `#7698FD`, brand `#FAB283`.
- **Layout**: Single-window replay — `overflow-hidden` on shell; panels scroll internally.

---

## Chart module

- **Entry**: `ChartManager.tsx` (replay) and `TrainingChart.tsx` (train); shared mount via `utils/candleChart.ts` `mountCandleVolumeChart`.
- **Drawing**: User horizontal lines via `createPriceLine` (solid, **lineWidth 3**); ruler via `chartRulerOverlay.ts` canvas overlay (two-click + move preview).
- **Trade overlays**: Entry/exit price lines + markers; fill qty shown as **USDT notional** (`price × qty`, langge uses `trade.margin`).
- **Motion**: page/navbar enter uses CSS `.oc-enter` / `.oc-enter-stagger`; respects `prefers-reduced-motion`.

---

## Top bar

- **Navbar**: 3-column grid — logo | centered tabs (复盘/训练/分析/高手/学习) | theme toggle + `DatasetPicker` (import + switch).
- **高手** (`/masters`): Contract master traders leaderboard, K-line replay & master overlay, trader profile & delivery slips, clone to dataset.
- **训练** (`/train`): independent of dataset; `TrainPage` + `TrainingChart` + `useTrainingRun`; sim state is in-memory only (see root `CONTEXT.md`).
- Import: `template=auto`, toast on success/error.

---

## Analysis page

- KPI **stats only on 总览 tab**; use `oc-stat-grid` / `oc-card`.
- No embedded strategy copy — statistics from current dataset only.

---

## Accessibility & Interaction

- `cursor-pointer` on all clickables (global in `index.css`); `focus-visible` ring; `prefers-reduced-motion` respected.
- `useToast` for all mutation/clone/import feedback; no `alert()` or `confirm()`.
- Zero page scroll (`overflow-hidden` shell); panels scroll internally.

---

## Forbidden

- Emoji as UI icons; gradient text; `alert()` for user messages; nested card-in-card on replay panels; non-monospace font overrides.