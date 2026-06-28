import pandas as pd
from sqlalchemy.orm import Session
from models import Trade
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
    "binance_futures": {"columns": COLUMN_MAP_BINANCE_FUTURES, "header": 9},
}

TEMPLATE_LABELS = {
    "langge": "浪哥交割单（xlsx/csv）",
    "binance_futures": "币安 U 本位合约仓位历史",
}

TEMPLATES = {k: v["columns"] for k, v in TEMPLATE_SPECS.items()}


class TradeImporter:
    def parse_file(
        self, db: Session, file_path: str, profile_id: int, template_id: str = "langge"
    ) -> dict:
        if template_id not in TEMPLATE_SPECS:
            raise ValueError(f"Unknown template: {template_id}")
        spec = TEMPLATE_SPECS[template_id]
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
        if template_id == "binance_futures" and "status" in df.columns:
            df = df[df["status"].astype(str).str.strip().str.lower() == "closed"]

        # Filter out invalid rows (must have valid entry_price and entry_time)
        df = df[df["entry_price"].notna() & df["entry_time"].notna()]

        total = len(df)
        success = 0
        failed = 0

        for _, row in df.iterrows():
            try:
                # Skip if entry_price is not a valid number
                entry_price = float(row["entry_price"])
                if pd.isna(entry_price) or entry_price <= 0:
                    failed += 1
                    continue
                normalized_symbol = normalize_symbol(row["symbol"])
                if not is_valid_symbol(normalized_symbol):
                    failed += 1
                    continue

                trade = Trade(
                    profile_id=profile_id,
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
                success += 1
            except Exception as e:
                failed += 1

        db.commit()
        return {"total": total, "success": success, "failed": failed}

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
            return float(rate.replace("%", "")) / 100
        return float(rate)

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
                import pytz
                tz = pytz.timezone('Asia/Shanghai')
                ts = tz.localize(ts)
            return int(ts.timestamp() * 1000)
        if isinstance(ts, str):
            dt = pd.to_datetime(ts).tz_localize('Asia/Shanghai')
            return int(dt.timestamp() * 1000)
        return int(ts)


trade_importer = TradeImporter()
