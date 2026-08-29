# Retraq Design System Master

The definitive engineering UI/UX design standard for Retraq (aligned with opencode.ai, interaction benchmarked against TradingView).

- **Pattern**: Chart-first canvas (`oc-canvas`) — the K-line chart is the full-bleed background layer; all panels float above it (`oc-float-panel`) and collapse into rail buttons (`oc-panel-rail`)
- **Viewport**: Single-viewport only, 0 page scrolling (`overflow: hidden` on shell; panels scroll internally)
- **Theme**: Dark `#141212` canvas by default / light `#fdfcfc` secondary, 2px grid borders, monochrome chrome
- **System**: `frontend/src/styles/opencode.css` (`oc-*` tokens and components)
- **PnL Semantics**: Apple HIG `#30D158` (Profit / Up) and `#FF3B30` (Loss / Down)
- **Typography**: 100% IBM Plex Mono (monospace everywhere, `tabular-nums` for all metrics)
- **Icons**: Lucide icons only (no emojis as UI glyphs)
- **Feedback**: `oc-spinner` on loading, `useToast()` for all actions, friendly Chinese error handling

For the full specification, see [`docs/DESIGN.md`](file:///home/xeron/Coding/retraq/docs/DESIGN.md).
