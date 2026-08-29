# Component Guidelines

> How components are built in this project.

---

## Overview

- **Stack**: React 19, Tailwind 4, OpenCode `oc-*` design system (`frontend/src/styles/opencode.css`). Lucide icons.
- **Design tokens**: `docs/DESIGN.md`, `frontend/src/styles/opencode.css`, interactive `#7698FD`, brand `#FAB283`.
- **Layout**: Chart-first canvas — chart is the full-bleed background layer (`oc-canvas`); panels float (`oc-float-panel`) and collapse into `oc-panel-rail` rails; zero page scroll.

---

## Chart module (unified engine, docs/DESIGN.md §2/§10)

- **Engine**: `components/chart/ChartCanvas.tsx` is the single chart implementation (candles + volume, compare pane, ruler/hline draw tools, fullscreen, theme reactivity, playback follow, engine-managed price lines). A second chart/replay implementation is forbidden.
- **Adapters**: `ChartManager.tsx` (replay: self-fetches klines by symbol+timeframe+trade range, builds fill markers + entry/exit lines; `noFills` for master delivery slips) and `TrainingChart.tsx` (train: controlled klines from `useTrainingRun`, sim markers, liq line, `playback` follow).
- **Drawing**: User horizontal lines via `createPriceLine` (solid, **lineWidth 3**); ruler via `chartRulerOverlay.ts` canvas overlay (two-click + move preview).
- **Trade overlays**: Entry/exit price lines + markers; fill qty shown as **USDT notional** (`price × qty`).
- **Motion**: page/navbar enter uses CSS `.oc-enter` / `.oc-enter-stagger`; respects `prefers-reduced-motion`.

---

## Top bar

- **Navbar**: 3-column grid — logo | centered tabs (复盘/训练/分析) | theme toggle + `DatasetPicker` (import + switch, grouped by dataset owner 我的/高手/训练).
- **复盘** (`/replay`): unified workbench — left floating panel with 我的/高手 source switch (`TradeList` vs `MasterList`), hero chart, right floating panel (`PositionDetails` vs `MasterDetailPanel`). `/masters` and `/learn` redirect here.
- **训练** (`/train`): independent of dataset; `TrainPage` + `TrainingChart` + `useTrainingRun`; sim state is in-memory only (see root `CONTEXT.md`).
- Import: `template=auto`, toast on success/error.

---

## Analysis page

- KPI **stats only on 总览 tab**; use `oc-stat-grid` / `oc-card`.
- No embedded strategy copy — statistics from current dataset only.

---

## Accessibility & Interaction

- `cursor-pointer` on all clickables (global in `index.css`); `focus-visible` ring; `prefers-reduced-motion` respected.
- `useToast` for all mutation/import feedback; no `alert()` or `confirm()`.
- Zero page scroll (`overflow-hidden` shell); panels scroll internally.

---

## Forbidden

- Emoji as UI icons; gradient text; `alert()` for user messages; nested card-in-card on replay panels; non-monospace font overrides.
- A second chart/replay implementation; mixing master or sim data into self datasets.
