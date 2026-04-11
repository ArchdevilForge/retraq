# Retraq

## What This Is

Retraq 是一个面向我自己本地使用的加密货币交易复盘工具，用来把历史交易记录和对应行情对齐后做快速回看。当前仓库已经有前后端 MVP，但接下来的项目方向会收敛到一条更明确的主线：以 Excel / 手动导入为主，把单笔交易复盘体验做到顺手、可靠、可重复。

## Core Value

导入一笔历史交易后，能够快速把它和对应 K 线、买卖点、时间区间对齐，并顺畅完成一次高质量复盘。

## Requirements

### Validated

- ✓ 可以从 Excel 文件导入历史交易到本地 SQLite 数据库 — existing
- ✓ 可以从前端查看交易列表，并进入复盘视图查看图表与仓位信息 — existing
- ✓ 可以按时间周期请求并展示 K 线数据，当前支持 5m / 15m / 1h / 4h / 1d — existing
- ✓ 可以生成基础统计信息与分析页面，展示胜率、盈亏等复盘辅助信息 — existing

### Active

- [ ] 导入后的每笔交易都能更可靠地和对应 K 线、买卖点、时间范围对齐，减少“图表和交易对不上”的摩擦
- [ ] 单笔交易复盘流程优先，用户应能在导入后快速定位、打开并回看任意一笔交易
- [ ] 多周期对比保留在 v1 范围内，但服务于单笔交易复盘主线，而不是独立成为复杂分析工作台
- [ ] 统计分析继续保留为辅助能力，但优先级低于复盘体验本身

### Out of Scope

- 多用户、认证、权限系统 — 当前产品定位是个人本地工具，不为公开用户或团队协作设计
- 公开部署与互联网暴露 — 当前仓库和 README 都默认本地运行，且后端未按公网服务做安全收口
- 直接接入 OKX 账户历史作为 v1 主数据入口 — v1 明确以 Excel / 手动导入为主，自动同步放到后续阶段再评估
- 学习模块的大规模内容化建设 — 当前 README 提到学习模块，但现阶段不应压过核心复盘主线

## Context

- 当前仓库已经是 brownfield 项目：前端有 `Replay` / `Analysis` / `Learn` 三个页面，后端已有交易导入、K 线拉取和统计接口
- 真实痛点已经明确：当前复盘时“图表和交易对不上”，导致回看过程断裂，影响复盘效率
- v1 的完成标准也已明确：导入交易后，能够顺畅复盘每笔交易，而不是先追求自动同步、内容体系或团队能力
- 现有代码库已经暴露出几类 brownfield 风险：本地 SQLite + `create_all` 缺少迁移层、K 线依赖外部交易所、图表与分析页面较重、规划文档此前缺失

## Constraints

- **Tech stack**: 继续沿用当前 React + TypeScript + Vite 前端，以及 FastAPI + SQLAlchemy + SQLite 后端 — 这是现有代码和运行脚本已经建立的基础
- **Data entry**: v1 以 Excel / 手动导入为主 — 这是当前用户目标和现有仓库能力的交集
- **Runtime model**: 本地运行优先，不按公网服务设计 — README 已明确不建议直接暴露到公网
- **Market data dependency**: K 线数据依赖外部交易所接口（当前实现通过 CCXT / OKX 等） — 这决定了市场数据可用性与历史覆盖范围受外部服务约束
- **Product scope**: 复盘体验优先于自动同步、教育内容和多用户能力 — 这是当前项目的核心取舍

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 产品定位为个人本地工具 | 用户明确说明主要给自己本地用，且当前仓库也围绕本地运行组织 | — Pending |
| v1 以 Excel / 手动导入为主 | 当前已存在导入能力，且用户不希望先把复杂度投入到账户级同步 | — Pending |
| v1 优先把复盘体验做到最好 | 用户最痛的点是交易与图表对不上，完成标准是“导入后能顺畅复盘每笔交易” | — Pending |
| 统计分析保留为辅助，而非主线 | 当前仓库已有分析页，但用户优先级更明确地落在 replay 体验上 | — Pending |
| 学习模块不作为当前主路线图核心 | 当前 README 虽包含该能力，但它不直接服务当前最重要的复盘痛点 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-11 after initialization*
