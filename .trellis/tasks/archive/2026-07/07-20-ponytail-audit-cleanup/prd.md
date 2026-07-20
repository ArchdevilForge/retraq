# Ponytail audit cleanup: dead code and deps

## Goal

按 ponytail-audit 清单，删除死代码与未用依赖、用 stdlib/native 替换手写薄封装，并收缩图表脚手架重复，不改变产品功能与视觉主路径。

## Scope

In:

- 删除 gsap / @gsap/react，页面/列表入场改为 CSS
- 删除 daisyui 依赖
- 删除死组件 StatsBar、StatsPanel
- 删除未调用的 `generateInsights` + `SmartInsight`
- 删除 ChartManager 纯 re-export（改直接引用）
- 清理根目录调试 PNG、`.playwright-mcp` 产物（工作区垃圾，不进 git 也可）
- pytz → zoneinfo
- axios → fetch（保留 dataset header 与 kline 重试行为）
- ThemeContext 去掉未用 `setTheme` 对外 API（保留 toggle）
- `datasetStorage` 单常量内联
- `api_contract.py` 挪到 tests（或 tests 旁）
- App lazy 三个小页面改为静态 import（去掉不必要的 Suspense 切页）
- `fetchKlines` 去掉永远 nocache/_cb；失败再 force 或保留有限重试
- 抽取 candle+volume chart mount 共用函数，TrainingChart / ChartManagerInner 共用

Out:

- 不改交易/训练业务规则
- 不重写 ChartManagerInner 全部逻辑
- 不替换 lightweight-charts / pandas / ccxt / lucide
- 不改后端 API 契约字段语义（仅移动 contract 测试辅助）

## Requirements

1. 前端可 typecheck + lint；后端 pytest + ruff + mypy 通过。
2. 主题切换、数据集 header、导入、K 线拉取、训练模拟、复盘标尺仍可用。
3. 无 gsap/daisyui/axios/pytz 运行时依赖（开发依赖除外如有需要）。
4. 无死文件 StatsBar / StatsPanel；无 ChartManager 空壳 re-export。
5. 入场动效用 CSS，尊重 `prefers-reduced-motion`。

## Acceptance Criteria

- [x] `frontend/package.json` 无 gsap、@gsap/react、daisyui、axios
- [x] `backend/pyproject.toml` 无 pytz
- [x] `StatsBar.tsx` / `StatsPanel.tsx` 删除；`ChartManager` 为真实组件（无空 re-export）
- [x] `generateInsights` / `SmartInsight` 不存在
- [x] `frontend/src/motion.ts` 已删除
- [x] `api.ts` 使用 fetch，仍注入 `X-Dataset-Id`
- [x] `trade_importer` 用 `zoneinfo`，无 pytz import
- [x] `cd frontend && pnpm typecheck && pnpm run lint` 通过（仅既有 warnings）
- [x] `cd backend && uv run pytest -q && uv run ruff check . && uv run mypy .` 通过
- [x] 图表 mount 共用 helper 已接入复盘/训练

## Notes

- 来源：本会话 `/ponytail-audit` 报告「都做」。
