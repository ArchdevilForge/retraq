# Retraq Design System Master

The definitive engineering UI/UX design standard for Retraq (aligned with opencode.ai).

- **Pattern**: Three-column workstation layout (`oc-workbench`: list | hero chart | detail)
- **Viewport**: Single-viewport only, 0 page scrolling (`overflow: hidden` on shell; panels scroll internally)
- **Theme**: Warm cream `#fdfcfc` canvas / dark `#141212`, 2px grid borders, monochrome chrome
- **System**: `frontend/src/styles/opencode.css` (`oc-*` tokens and components)
- **PnL Semantics**: Apple HIG `#30D158` (Profit / Up) and `#FF3B30` (Loss / Down)
- **Typography**: 100% IBM Plex Mono (monospace everywhere, `tabular-nums` for all metrics)
- **Icons**: Lucide icons only (no emojis as UI glyphs)
- **Feedback**: `oc-spinner` on loading, `useToast()` for all actions, friendly Chinese error handling

For the full specification, see [`docs/DESIGN.md`](file:///home/xeron/Coding/retraq/docs/DESIGN.md).
