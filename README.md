# Retraq

本地交易历史复盘工具：多档案隔离、文件导入交割单，在 K 线上回顾与分析任意交易者的记录。

## 截图

![复盘页面](docs/images/replay.png)

![分析页面](docs/images/analysis.png)

## 功能

- 📈 K线图表 - 从 OKX 获取实时行情数据，支持多周期（5m/15m/1h/4h/1d）
- 🔀 多周期多交易对对比 - 同时查看不同时间周期和交易对的走势
- 📍 买卖点标注 - 明确标注买入卖出点和均价，直观复盘每笔交易
- 📊 交易分析 - 统计胜率、盈亏比、收益曲线等关键指标
- 📥 多模板导入 - 浪哥交割单表格、币安合约仓位历史导出等（按当前档案导入）

## 导入交易记录

在 **设置** 页选择导入模板并上传 `.xlsx` / `.csv`（浪哥模板也支持 csv）。数据写入**当前选中的档案**。

| 模板 | 说明 |
|------|------|
| **浪哥交割单** | 列名与仓库示例 `1.xlsx` 一致 |
| **币安 U 本位合约仓位历史** | 从币安下载中心导出 |

### 币安 U 本位合约仓位历史

1. 登录 [币安](https://www.binance.com)，打开 [下载中心 → 合约仓位历史（U 本位）](https://www.binance.com/zh-CN/my/download-center?type=trade-futures-position-history&child-type=trade-futures-position-history-u)。
2. 选择时间范围并下载 Excel（表头行为「代币名称/币种名称/币对」等，文件内前几行为账户信息）。
3. 在 Retraq **设置** 中选择模板 **币安 U 本位合约仓位历史**，上传该文件。

导入会映射：交易对、多/空、入场价、平仓均价、结算盈亏、开仓/平仓时间（按 UTC+8 解析）。仅导入状态为 **Closed** 的仓位；杠杆、保证金、收益率等字段导出中无则留空。

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

首次空库会创建示例档案「浪哥（示例）」并导入仓库内 `1.xlsx`；已有旧数据会归入档案「默认」。可在导航栏切换档案，在设置页新建/导入/删除。

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
