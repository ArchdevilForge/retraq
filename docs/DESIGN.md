# Retraq — Design System (Anthropic-inspired)

## Color strategy

**Restrained**: warm tinted neutrals + terracotta accent ≤12% of chrome. PnL uses semantic success/error only.

| Role | Light (optional) | Dark (default) |
|------|------------------|----------------|
| Canvas | `#FAF9F5` | `#141413` |
| Surface | `#F5F4F0` | `#1F1E1D` |
| Elevated | `#FFFFFF` | `#2A2928` |
| Border | `rgba(31,31,31,0.08)` | `rgba(255,255,255,0.08)` |
| Text primary | `#1F1E1D` | `#ECEAE6` |
| Text muted | `#6B6862` | `#9A9690` |
| Accent (brand) | `#C15F3C` | `#D97757` |
| Accent hover | `#A84E2F` | `#E8956F` |
| Focus ring | `#D97757` @ 40% | same |

Semantic (do not use as brand):

- Profit: `#3D8A5A` (muted green)
- Loss: `#C45C5C` (muted red)

## Typography

- **Display / titles**: Source Serif 4 — editorial, Anthropic-adjacent warmth.
- **UI / body**: Inter — neutral, highly legible at 16px base.
- **Data / prices**: IBM Plex Mono — tabular numbers.

Scale: 16px base, titles 1.125–1.5rem, KPI numbers 1.375–1.75rem.

## Elevation & panels

- Panels: 1px border `white/8%`, radius 12px, background surface @ 85% opacity.
- No nested card-in-card; one surface level per region.
- Navbar: 52px, blur, bottom border only.

## Motion

- 150–200ms ease-out on color/opacity only.
- Respect `prefers-reduced-motion`.

## Components

- Primary button: terracotta fill, no gradient.
- Tabs: boxed, active = accent tint bg, not full primary block unless nav.
- Tables: `table-sm`, monospace for numbers.

## Icons

Lucide only, 20–22px in nav, stroke 2.