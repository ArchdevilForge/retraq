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

- **Navbar**: 3-column grid — logo | centered tabs (复盘/训练/分析/学习) | `DatasetPicker` (import + switch).
- **训练** (`/train`): independent of dataset; `TrainPage` + `TrainingChart` + `useTrainingRun`; sim state is in-memory only (see root `CONTEXT.md`).
- Import: `template=auto`, toast on success/error.

---

## Analysis page

- KPI **stats only on 总览 tab**; use `oc-stat-grid` / `oc-card`.
- No embedded strategy copy — statistics from current dataset only.

---

## Accessibility

- `cursor-pointer` on clickables (global in `index.css`); `focus-visible` ring; `prefers-reduced-motion` respected.

---

## Forbidden

- Emoji as UI icons; gradient text; `alert()` for user messages; nested card-in-card on replay panels.