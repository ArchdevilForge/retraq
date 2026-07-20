import pandas as pd
from sqlalchemy.orm import Session
from models import Trade, TradeFill
from services.binance_trade_aggregate import Fill, aggregate_fills_to_trades
from services.symbol_utils import normalize_symbol, is_valid_symbol

# Langge delivery-sheet columns
COLUMN_MAP_LANGGE = {
    "交易对": "symbol",
    "方向": "direction",
    "杠杆倍数": "leverage",
    "开仓均价": "entry_price",
    "平仓均价": "exit_price",
    "收益率": "profit_rate",
    "收益 (USDT)": "profit",
    "保证金（最大时）": "margin",
    "买入时间": "entry_time",
    "卖出时间": "exit_time",
}

# Binance: U-margined futures trade history (fills → aggregate to positions)
COLUMN_MAP_BINANCE_TRADES = {
    "代币名称/币种名称/币对": "symbol",
    "时间": "time",
    "方向": "side",
    "价格": "price",
    "数量": "qty",
    "已实现利润": "realized_pnl",
}

# Binance download center: U-margined futures position history (UTC+8 sheet)
COLUMN_MAP_BINANCE_FUTURES = {
    "代币名称/币种名称/币对": "symbol",
    "持仓方向": "direction",
    "入场价格": "entry_price",
    "平均收盘价": "exit_price",
    "结算盈亏": "profit",
    "已打开": "entry_time",
    "已关闭": "exit_time",
    "状态": "status",
}

# ponytail: template_id -> {columns, header_row}
TEMPLATE_SPECS: dict[str, dict] = {
    "langge": {"columns": COLUMN_MAP_LANGGE, "header": 0},
    "binance_futures_trades": {
        "columns": COLUMN_MAP_BINANCE_TRADES,
        "header": 9,
        "mode": "binance_aggregate",
    },
    "binance_futures": {"columns": COLUMN_MAP_BINANCE_FUTURES, "header": 9},
}

TEMPLATE_LABELS = {
    "langge": "交割单表格（xlsx/csv）",
    "binance_futures_trades": "币安 U 本位合约交易历史（推荐）",
    "binance_futures": "币安 U 本位合约仓位历史",
}

TEMPLATES = {k: v["columns"] for k, v in TEMPLATE_SPECS.items()}


def detect_template(file_path: str) -> str:
    """Pick importer from file headers (langge vs binance sheets)."""
    lower = file_path.lower()
    if lower.endswith(".csv"):
        df = pd.read_csv(file_path, nrows=2)
        if "交易对" in df.columns:
            return "langge"
        raise ValueError(
            "无法识别 CSV 格式。请使用交割单表头（含「交易对」列）。"
        )
    hdr0 = pd.read_excel(file_path, engine="openpyxl", header=0, nrows=2)
    if "交易对" in hdr0.columns:
        return "langge"
    hdr9 = pd.read_excel(file_path, engine="openpyxl", header=9, nrows=2)
    cols = set(str(c) for c in hdr9.columns)
    trade_keys = {"代币名称/币种名称/币对", "时间", "方向", "价格", "数量"}
    if trade_keys.issubset(cols):
        return "binance_futures_trades"
    pos_keys = {"代币名称/币种名称/币对", "入场价格", "已打开"}
    if pos_keys.issubset(cols):
        return "binance_futures"
    raise ValueError(
        "无法识别表格格式。支持：交割单表格、币安 U 本位交易历史、币安仓位历史。"
    )


class TradeImporter:
    def parse_file(
        self, db: Session, file_path: str, dataset_id: int, template_id: str = "langge"
    ) -> dict:
        if template_id not in TEMPLATE_SPECS:
            raise ValueError(f"Unknown template: {template_id}")
        spec = TEMPLATE_SPECS[template_id]
        if spec.get("mode") == "binance_aggregate":
            return self._import_binance_trades(db, file_path, dataset_id, spec)
        return self._import_row_mapped(db, file_path, dataset_id, template_id, spec)

    def _import_binance_trades(self, db: Session, file_path: str, dataset_id: int, spec: dict) -> dict:
        df = pd.read_excel(file_path, engine="openpyxl", header=spec["header"])
        df = df.rename(columns=spec["columns"])
        for col in ("symbol", "time", "side", "price", "qty"):
            if col not in df.columns:
                raise ValueError(
                    f"列映射失败，缺少 {col}。请使用模板「币安 U 本位合约交易历史」与下载中心的交易历史表。"
                )
        fills: list[Fill] = []
        skipped = 0
        for _, row in df.iterrows():
            try:
                sym = normalize_symbol(row["symbol"])
                if not is_valid_symbol(sym):
                    skipped += 1
                    continue
                price = float(row["price"])
                qty = float(row["qty"])
                if price <= 0 or qty <= 0:
                    skipped += 1
                    continue
                pnl = float(row.get("realized_pnl", 0) or 0)
                if pd.isna(row.get("realized_pnl")):
                    pnl = 0.0
                ts = self._parse_timestamp(row["time"])
                if ts is None:
                    skipped += 1
                    continue
                fills.append(
                    Fill(
                        time_ms=ts,
                        symbol=sym,
                        side=str(row["side"]),
                        price=price,
                        qty=qty,
                        realized_pnl=pnl,
                    )
                )
            except Exception:
                skipped += 1
        fill_rows: list[TradeFill] = []
        for f in fills:
            fill_rows.append(
                TradeFill(
                    dataset_id=dataset_id,
                    trade_id=None,
                    symbol=f.symbol,
                    side=str(f.side).upper(),
                    price=f.price,
                    qty=f.qty,
                    time_ms=f.time_ms,
                    realized_pnl=f.realized_pnl,
                )
            )
        db.add_all(fill_rows)
        db.flush()

        closed = aggregate_fills_to_trades(fills)
        success = 0
        for ct in closed:
            trade = Trade(
                dataset_id=dataset_id,
                symbol=ct.symbol,
                direction=ct.direction,
                leverage=1.0,
                entry_price=ct.entry_price,
                exit_price=ct.exit_price,
                profit=ct.profit,
                profit_rate=ct.profit_rate,
                margin=ct.margin,
                entry_time=ct.entry_time,
                exit_time=ct.exit_time,
            )
            db.add(trade)
            db.flush()
            for fr in fill_rows:
                if fr.symbol != ct.symbol:
                    continue
                if ct.entry_time <= fr.time_ms <= (ct.exit_time or ct.entry_time):
                    fr.trade_id = trade.id
            success += 1
        db.commit()
        return {
            "total": len(fills),
            "success": success,
            "failed": skipped,
            "fills": len(fills),
            "closed_positions": success,
        }

    def _import_row_mapped(
        self, db: Session, file_path: str, dataset_id: int, template_id: str, spec: dict
    ) -> dict:
        column_map = spec["columns"]
        header = spec.get("header", 0)
        lower = file_path.lower()
        if lower.endswith(".csv"):
            if header != 0:
                raise ValueError("CSV import only supports langge-style header row")
            df = pd.read_csv(file_path)
        else:
            df = pd.read_excel(file_path, engine="openpyxl", header=header)
        df = df.rename(columns=column_map)
        missing = [k for k in ("symbol", "entry_price", "entry_time") if k not in df.columns]
        if missing:
            raise ValueError(
                f"列映射失败，缺少 {missing}。交割单→langge；币安交易历史→binance_futures_trades；币安仓位历史→binance_futures。"
            )
        if template_id == "binance_futures" and "status" in df.columns:
            df = df[df["status"].astype(str).str.strip().str.lower() == "closed"]
        df = df[df["entry_price"].notna() & df["entry_time"].notna()]
        total = len(df)
        success = 0
        failed = 0
        for _, row in df.iterrows():
            try:
                entry_price = float(row["entry_price"])
                if pd.isna(entry_price) or entry_price <= 0:
                    failed += 1
                    continue
                normalized_symbol = normalize_symbol(row["symbol"])
                if not is_valid_symbol(normalized_symbol):
                    failed += 1
                    continue
                trade = Trade(
                    dataset_id=dataset_id,
                    symbol=normalized_symbol,
                    direction=self._normalize_direction(row["direction"]),
                    leverage=float(row.get("leverage", 1)) if pd.notna(row.get("leverage")) else 1,
                    entry_price=entry_price,
                    exit_price=float(row["exit_price"]) if pd.notna(row.get("exit_price")) else None,
                    profit=float(row["profit"]) if pd.notna(row.get("profit")) else None,
                    profit_rate=self._parse_rate(row.get("profit_rate")),
                    margin=float(row["margin"]) if pd.notna(row.get("margin")) else None,
                    entry_time=self._parse_timestamp(row["entry_time"]),
                    exit_time=self._parse_timestamp(row.get("exit_time")),
                )
                db.add(trade)
                db.flush()
                self._attach_synthetic_fills(db, dataset_id, trade)
                success += 1
            except Exception:
                failed += 1
        db.commit()
        return {"total": total, "success": success, "failed": failed}

    def _attach_synthetic_fills(self, db: Session, dataset_id: int, trade: Trade) -> None:
        """Langge / position rows: one open + one close fill for chart markers."""
        db.query(TradeFill).filter(TradeFill.trade_id == trade.id).delete()
        open_side = "BUY" if trade.direction == "long" else "SELL"
        close_side = "SELL" if trade.direction == "long" else "BUY"
        db.add(
            TradeFill(
                dataset_id=dataset_id,
                trade_id=trade.id,
                symbol=trade.symbol,
                side=open_side,
                price=trade.entry_price,
                qty=1.0,
                time_ms=trade.entry_time,
                realized_pnl=0.0,
            )
        )
        if trade.exit_time and trade.exit_price is not None:
            db.add(
                TradeFill(
                    dataset_id=dataset_id,
                    trade_id=trade.id,
                    symbol=trade.symbol,
                    side=close_side,
                    price=trade.exit_price,
                    qty=1.0,
                    time_ms=trade.exit_time,
                    realized_pnl=trade.profit or 0.0,
                )
            )

    def _normalize_direction(self, direction: str) -> str:
        d = str(direction).strip().lower()
        if d in ("long", "short"):
            return d
        if "多" in d or "long" in d or "买" in d:
            return "long"
        if "空" in d or "short" in d or "卖" in d:
            return "short"
        return d

    def _parse_rate(self, rate) -> float | None:
        if pd.isna(rate):
            return None
        if isinstance(rate, str):
            return float(rate.replace("%", "").strip()) / 100
        v = float(rate)
        # Langge sheets may store whole percents (10) or decimals (0.1); API uses 0–1 for fmtPct.
        if abs(v) > 1:
            return v / 100
        return v

    def _parse_timestamp(self, ts) -> int | None:
        if pd.isna(ts):
            return None
        # Excel中的时间是UTC+8，需要明确指定时区
        if isinstance(ts, pd.Timestamp):
            if ts.tz is None:
                ts = ts.tz_localize('Asia/Shanghai')
            return int(ts.timestamp() * 1000)
        if hasattr(ts, 'timestamp'):  # datetime.datetime
            if ts.tzinfo is None:
                from datetime import timezone
                from zoneinfo import ZoneInfo

                ts = ts.replace(tzinfo=ZoneInfo('Asia/Shanghai')).astimezone(timezone.utc)
            return int(ts.timestamp() * 1000)
        if isinstance(ts, str):
            dt = pd.to_datetime(ts).tz_localize('Asia/Shanghai')
            return int(dt.timestamp() * 1000)
        return int(ts)


trade_importer = TradeImporter()
