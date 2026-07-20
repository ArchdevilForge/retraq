# Implement: ponytail-audit cleanup

## Checklist

1. [x] 删死代码：`StatsBar.tsx`、`StatsPanel.tsx`；`ChartManagerInner` 重命名为 `ChartManager`
2. [x] 删 `generateInsights` + `SmartInsight`（保留 helper 函数）
3. [x] `ACTIVE_DATASET_STORAGE_KEY` 并入 `api.ts`；去 ThemeContext `setTheme`
4. [x] CSS `.oc-enter`；删 gsap/`motion.ts`；vite chunk 清理
5. [x] 去 daisyui
6. [x] `api.ts` axios→fetch；`fetchKlines` 默认缓存，失败再 nocache
7. [x] `mountCandleVolumeChart`；TrainingChart + ChartManager 接入
8. [x] App 静态 import
9. [x] zoneinfo；`api_contract` → `tests/`；去 pytz
10. [x] 清理根目录调试 PNG 与 `.playwright-mcp`
11. [x] 验证通过

## Validation

```bash
cd frontend && pnpm typecheck && pnpm run lint
cd backend && uv run pytest -q && uv run ruff check . && uv run mypy .
```

## Review gates

- 无残留 `from 'axios'|'gsap'|'@gsap/react'|daisyui|pytz`
- `rg StatsBar|StatsPanel|generateInsights|motion` 无产品引用
- 图表 helper 两端都能编译

## Rollback

`git checkout --` 相关路径；`pnpm install` / `uv sync` 恢复锁文件。
