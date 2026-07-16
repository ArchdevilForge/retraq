import os
import tempfile
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Query, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from migrate import ensure_database
from models import Trade, Dataset, TradeFill
from dataset_scope import get_dataset_id
from services.kline_service import kline_service, TIMEFRAMES
from services.trade_importer import trade_importer, TEMPLATES, TEMPLATE_LABELS, detect_template
from services.trade_analyzer import trade_analyzer
from services.symbol_utils import normalize_symbol, is_valid_symbol

ensure_database()

app = FastAPI(title="Trading Replay API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class DatasetUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)


@app.get("/api/import/templates")
def list_import_templates():
    return {
        "templates": [
            {"id": k, "label": TEMPLATE_LABELS.get(k, k)} for k in TEMPLATES
        ]
    }


@app.get("/api/datasets")
def list_datasets(db: Session = Depends(get_db)):
    rows = db.query(Dataset).order_by(Dataset.id).all()
    return {
        "data": [
            {"id": d.id, "name": d.name, "created_at": d.created_at}
            for d in rows
        ]
    }


@app.patch("/api/datasets/{dataset_id}")
def update_dataset(dataset_id: int, body: DatasetUpdate, db: Session = Depends(get_db)):
    d = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not d:
        raise HTTPException(404, "Dataset not found")
    other = db.query(Dataset).filter(Dataset.name == body.name, Dataset.id != dataset_id).first()
    if other:
        raise HTTPException(400, "Dataset name already exists")
    d.name = body.name  # type: ignore[assignment]
    db.commit()
    db.refresh(d)
    return {"id": d.id, "name": d.name, "created_at": d.created_at}


@app.delete("/api/datasets/{dataset_id}")
def delete_dataset(dataset_id: int, db: Session = Depends(get_db)):
    d = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not d:
        raise HTTPException(404, "Dataset not found")
    db.delete(d)
    db.commit()
    return {"ok": True}


@app.get("/api/klines/{symbol}/{timeframe}")
def get_klines(
    symbol: str,
    timeframe: str,
    response: Response,
    nocache: bool = Query(False, description="Disable server-side cache"),
    limit: int = 500,
    start: Optional[int] = Query(None, description="Start timestamp (ms)"),
    end: Optional[int] = Query(None, description="End timestamp (ms)"),
    db: Session = Depends(get_db),
):
    if timeframe not in TIMEFRAMES:
        raise HTTPException(400, f"Invalid timeframe. Supported: {TIMEFRAMES}")
    try:
        response.headers["Cache-Control"] = "no-store, no-cache, max-age=0, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        data = kline_service.fetch_klines_range(
            db,
            symbol,
            timeframe,
            limit=limit,
            start_ts=start,
            end_ts=end,
            force_refresh=nocache,
        )
        if (start is not None or end is not None) and not data:
            raise HTTPException(404, "No klines found for requested range")
        return {"symbol": symbol, "timeframe": timeframe, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        print(f"get_klines failed symbol={symbol} tf={timeframe} start={start} end={end}: {e!r}")
        raise HTTPException(502, f"Failed to fetch klines: {type(e).__name__}")


def _dataset_label_from_filename(filename: str) -> str:
    base = os.path.basename(filename)
    for ext in (".xlsx", ".xls", ".csv"):
        if base.lower().endswith(ext):
            base = base[: -len(ext)]
            break
    return (base.strip() or "未命名表格")[:128]


def _find_or_create_dataset(db: Session, name: str) -> Dataset:
    name = name.strip()[:128]
    if not name:
        raise HTTPException(400, "Invalid dataset name")
    d = db.query(Dataset).filter(Dataset.name == name).first()
    if d:
        return d
    d = Dataset(name=name)
    db.add(d)
    db.commit()
    db.refresh(d)
    return d


@app.post("/api/trades/import")
async def import_trades(
    file: UploadFile = File(...),
    template: str = Query("auto"),
    replace: bool = Query(True),
    label: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    if template == "auto":
        pass
    elif template not in TEMPLATES:
        raise HTTPException(400, f"Unknown template. Supported: auto, {list(TEMPLATES)}")
    if not file.filename:
        raise HTTPException(400, "Missing filename")
    fn = file.filename.lower()
    if not fn.endswith((".xlsx", ".xls", ".csv")):
        raise HTTPException(400, "Only .xlsx, .xls, .csv are supported")

    ds_name = (label.strip() if label and label.strip() else _dataset_label_from_filename(file.filename))
    dataset = _find_or_create_dataset(db, ds_name)
    dataset_id = dataset.id

    if replace:
        db.query(TradeFill).filter(TradeFill.dataset_id == dataset_id).delete()
        db.query(Trade).filter(Trade.dataset_id == dataset_id).delete()
        db.commit()

    suffix = ".csv" if fn.endswith(".csv") else ".xlsx"
    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name
        resolved = detect_template(tmp_path) if template == "auto" else template
        result = trade_importer.parse_file(db, tmp_path, int(dataset_id), resolved)
        result["template"] = resolved
        result["dataset_id"] = dataset_id
        result["dataset_name"] = dataset.name
        result["replaced"] = replace
        return result
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


def _trade_query(db: Session, dataset_id: int, symbol: Optional[str], start_date: Optional[int], end_date: Optional[int]):
    q = db.query(Trade).filter(Trade.dataset_id == dataset_id)
    if symbol:
        normalized = normalize_symbol(symbol)
        if not is_valid_symbol(normalized):
            return None
        q = q.filter(Trade.symbol == normalized)
    if start_date:
        q = q.filter(Trade.entry_time >= start_date)
    if end_date:
        q = q.filter(Trade.entry_time <= end_date)
    return q


def _filter_valid_trades(trades: list[Trade]) -> list[Trade]:
    return [t for t in trades if is_valid_symbol(str(t.symbol))]


def _trade_to_dict(t: Trade) -> dict:
    return {
        "id": t.id,
        "symbol": t.symbol,
        "direction": t.direction,
        "leverage": t.leverage,
        "entry_price": t.entry_price,
        "exit_price": t.exit_price,
        "profit": t.profit,
        "profit_rate": t.profit_rate,
        "margin": t.margin,
        "entry_time": t.entry_time,
        "exit_time": t.exit_time,
    }


@app.get("/api/trades")
def get_trades(
    request: Request,
    symbol: Optional[str] = None,
    start_date: Optional[int] = Query(None, description="Start timestamp (ms)"),
    end_date: Optional[int] = Query(None, description="End timestamp (ms)"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    dataset_id = get_dataset_id(request, db)
    query = _trade_query(db, dataset_id, symbol, start_date, end_date)
    if query is None:
        return {"total": 0, "page": page, "limit": limit, "data": []}

    # Filter invalid symbols in Python so total matches data (blocklist is tiny).
    # ponytail: full scan per page request; index/SQL filter if datasets get huge
    ordered = query.order_by(Trade.entry_time.desc()).all()
    valid = _filter_valid_trades(ordered)
    total = len(valid)
    page_rows = valid[(page - 1) * limit : page * limit]

    return {
        "total": total,
        "page": page,
        "limit": limit,
        "data": [_trade_to_dict(t) for t in page_rows],
    }


@app.get("/api/trades/{trade_id}/fills")
def get_trade_fills(trade_id: int, request: Request, db: Session = Depends(get_db)):
    dataset_id = get_dataset_id(request, db)
    trade = db.query(Trade).filter(Trade.id == trade_id, Trade.dataset_id == dataset_id).first()
    if not trade:
        raise HTTPException(404, "Trade not found")
    rows = (
        db.query(TradeFill)
        .filter(TradeFill.trade_id == trade_id)
        .order_by(TradeFill.time_ms.asc())
        .all()
    )
    return {
        "data": [
            {
                "id": r.id,
                "side": r.side,
                "price": r.price,
                "qty": r.qty,
                "time_ms": r.time_ms,
                "realized_pnl": r.realized_pnl,
            }
            for r in rows
        ]
    }


@app.get("/api/stats/symbols")
def get_stats_symbols(request: Request, db: Session = Depends(get_db)):
    dataset_id = get_dataset_id(request, db)
    dist = trade_analyzer.symbol_distribution(db, dataset_id)
    return {"trade_count": sum(dist.values()), "symbol_distribution": dist}


@app.get("/api/stats/overview")
def get_stats_overview(request: Request, db: Session = Depends(get_db)):
    dataset_id = get_dataset_id(request, db)
    return trade_analyzer.calculate_stats(db, dataset_id)


_static_dir = os.getenv("RETRAQ_STATIC_DIR")
if _static_dir and os.path.isdir(_static_dir):
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="static")