# Impeccable-style UI audit — Retraq

Run after major UI changes. Load context first:

```bash
node ~/.agents/skills/impeccable/scripts/load-context.mjs
# or: IMPECCABLE_CONTEXT_DIR=docs node ...
```

## Applied (2026-03)

| Rule | Status |
|------|--------|
| PRODUCT.md + DESIGN.md | ✅ `docs/` |
| Restrained color (terracotta accent) | ✅ primary `#D97757` |
| No pure #000/#fff canvas | ✅ `#141413` / `#ECEAE6` |
| Register = product | ✅ |
| Lucide icons only | ✅ |
| cursor-pointer on clickables | ✅ base layer |
| focus-visible ring | ✅ terracotta mix |
| prefers-reduced-motion | ✅ |
| No gradient text utility in use | ✅ removed from index.css |
| Semantic PnL separate from brand | ✅ chart + daisy success/error |

## Follow-ups

- [ ] Run `npx impeccable teach` / `document` in repo root to sync Impeccable CLI context paths
- [ ] Learn page: align panels to `.panel` / remove nested gray cards
- [ ] Light mode (optional): add `data-theme` toggle using DESIGN.md light column
- [ ] ChartManager: second duplicate candlestick color block — keep in sync with tokens
- [ ] Settings import section: `select` / `file-input` height 44px for touch

## Commands (Impeccable skill)

```text
/impeccable audit frontend/src
/impeccable polish frontend/src/pages/ReplayPage.tsx
/impeccable document   # refresh DESIGN.md from implementation
```

(Exact CLI varies by install; use skill `reference/` for subcommands.)