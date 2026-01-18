# Retraq

bit浪浪的交割单复盘系统，帮助你回顾和分析历史交易记录。

## 截图

![复盘页面](docs/images/replay.png)

![分析页面](docs/images/analysis.png)

## 功能

- 📈 K线图表 - 从 OKX 获取实时行情数据，支持多周期（5m/15m/1h/4h/1d）
- 🔀 多周期多交易对对比 - 同时查看不同时间周期和交易对的走势
- 📍 买卖点标注 - 明确标注买入卖出点和均价，直观复盘每笔交易
- 📊 交易分析 - 统计胜率、盈亏比、收益曲线等关键指标
- 📚 学习模块 - 学习浪哥的交易系统（通过所有复盘提取视频提取）

## 技术栈

**前端**
- React 19 + TypeScript
- Vite
- TailwindCSS + DaisyUI
- Lightweight Charts

**后端**
- FastAPI
- SQLAlchemy + SQLite
- CCXT (OKX)

## 快速开始

### 环境要求

- Python 3.11+
- Node.js 18+
- pnpm
- uv (Python 包管理器)

### 安装

```bash
# 克隆项目
git clone https://github.com/Xeron2000/retraq.git
cd retraq
```

### 一键启动

**Linux / macOS**
```bash
chmod +x start.sh
./start.sh
```

**Windows**
```cmd
start.bat
```

启动时会自动导入 `1.xlsx` 中的示例交易数据（仅首次）。

启动后访问：
- 前端：http://localhost:9528
- 后端 API：http://localhost:9527

### 手动启动

```bash
# 后端
cd backend
uv sync
uv run python import_data.py  # 导入示例数据
uv run uvicorn main:app --reload --port 9527

# 前端（新终端）
cd frontend
pnpm install
pnpm build
pnpm preview --port 9528 &
```

## 注意事项

- 本项目为个人学习工具，数据存储在本地 SQLite
- K 线数据来自 OKX 公开 API，请遵守交易所服务条款
- 不建议直接暴露到公网，如需公开部署请自行添加认证

## License

MIT License
