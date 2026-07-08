# Retraq — Design System (opencode.ai website)

Visual language from [opencode.ai](https://opencode.ai/) marketing site — **not** OpenCode Desktop `packages/ui` (OC-2).

## Implementation

- **Tokens + components**: `frontend/src/styles/opencode.css` (`oc-*` classes)
- **Tailwind bridge**: `frontend/src/index.css` `@theme`
- **Do not use DaisyUI component classes** in new UI

## Color strategy

Warm cream canvas `#fdfcfc`, ink `#201d1d`, hairline borders. **Light / dark** via `data-theme` + navbar toggle (`ThemeProvider`). Chart colors read `--oc-chart-*` CSS vars and re-apply on theme change.

## Color strategy

Monochrome chrome; semantic Apple HIG colors for PnL (`#30D158` / `#FF3B30`). Chart panel uses theme-aware `--oc-chart-bg` (light `#f1eeee`, dark `#201d1d`).

## Typography

100% IBM Plex Mono (Berkeley Mono substitute). Uppercase section labels. Body 14–16px, KPI 20px tabular.

## Layout

Shared **2px grid borders** between panels (`oc-workbench`), like opencode.ai section blocks. No shadows, no pill chrome.

## Components (oc-*)

| Class | Website equivalent |
|-------|-------------------|
| `oc-navbar`, `oc-tabs`, `oc-tab` | manpage header + bordered segment nav |
| `oc-btn--primary/secondary/ghost` | ink CTA + hairline secondary |
| `oc-input-wrap` | bordered command input |
| `panel`, `oc-workbench` | cream section grid |
| `oc-chart-shell` | dark TUI hero panel |
| `oc-chip` | uppercase filter tag |
| `oc-stat-grid` | bordered KPI grid |
| `oc-empty__desc::before` | `[+]` ASCII bullet prefix |

## Motion

120ms ease on color/background only. Respect `prefers-reduced-motion`.
