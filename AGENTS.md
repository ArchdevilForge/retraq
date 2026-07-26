# AGENTS

Retraq：本地交易复盘（FastAPI + React）。用户可见文案默认中文；代码与路径保持原文。

## 约定

- 先读再改，最小 diff；搜索：`fast_context_search` → `rg`。
- Python 依赖与运行：**uv**（`backend/`）。
- 前端：`frontend/`，**pnpm**。
- 实现规范：`.trellis/spec/backend/`、`.trellis/spec/frontend/`。
- 产品/视觉：`docs/PRODUCT.md`、`docs/DESIGN.md`。

## 启动

```bash
# 后端
cd backend && uv sync && uv run python import_data.py && uv run uvicorn main:app --reload --port 9527

# 前端（另开终端）
cd frontend && pnpm install && pnpm dev
```

开发前端默认 Vite 端口（见终端输出）；预览构建可用 `pnpm build && pnpm preview --port 9528`。

## 检查

```bash
cd frontend && pnpm typecheck && pnpm run lint && pnpm test
cd backend && uv run pytest -q && uv run ruff check . && uv run mypy .
```

单测：前端 `vitest`（`src/**/*.test.ts`，TZ 固定 `Asia/Shanghai`）；后端 `pytest`（`backend/tests/`，自动指向临时库，不动 `trading.db`）。CI 见 `.github/workflows/checks.yml`。