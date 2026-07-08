# Retraq

本地交易复盘：导入交割单 → K 线回放 → 统计分析。**一个导入文件 = 一个数据集**，顶栏切换。

## 界面预览

**复盘** — 交易列表 · K 线标注 · 仓位与成交明细

![复盘](docs/images/replay.png)

**分析** — 绩效概览 · 行为/时间/风险 · 交易对分布

![分析](docs/images/analysis.png)

## 安全说明

**请只在本地或可信内网使用。** 无登录、无鉴权；暴露到公网则他人可读写你的数据。

## 快速开始（Docker Compose）

```bash
git clone https://github.com/Xeron2000/retraq.git && cd retraq
docker compose up -d
```

浏览器打开 **http://localhost:8080**。数据持久化在 Docker 卷 `retraq-data`（容器内 `/data`），删容器不删库。

## 导入数据

1. 顶栏 **上传** `.xlsx` / `.csv`
2. **`template=auto`** 自动识别格式，按文件名创建/覆盖数据集

| 来源 | 说明 |
|------|------|
| 交割单表格 | 表头含「交易对」；示例 `samples/bit-langge-delivery-example.xlsx` |
| 币安 U 本位合约交易历史 | [下载中心](https://www.binance.com/zh-CN/my/download-center?type=trade-futures-trade-history&child-type=trade-futures-trade-history-u) |

库为空时需先导入；K 线需联网（默认 OKX）。

## 其他方式

**从源码构建镜像**（改 `docker-compose.yml` 中 `build: .`，或 `docker compose up --build -d`）

**本地开发**（前后端分离）

```bash
cd backend && uv sync && uv run python import_data.py && uv run uvicorn main:app --reload --port 9527
cd frontend && pnpm install && pnpm dev   # 另开终端，http://localhost:5173
```

## License

MIT
