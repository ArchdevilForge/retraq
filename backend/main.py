import os
import tempfile
import zipfile
from typing import Optional

import ccxt
import pandas as pd
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
from services.master_service import master_service
from services.binance_sync_service import SYNC_DATASET_NAME, binance_sync_service, get_credentials
from services.annotation_service import (
    ERROR_TAG_PRESETS,
    EMOTION_PRESETS,
    GRADE_PRESETS,
    SETUP_TAG_PRESETS,
    ValidationError,
    annotation_service,
)
from services.analysis_service import (
    REVIEW_CHECKLISTS,
    analysis_service,
    list_reviews,
    upsert_review,
)

ensure_database()


def _auto_sync_on_startup() -> None:
    """Fire-and-forget incremental sync at boot; never blocks or crashes startup."""
    import threading

    def run():
        try:
            if get_credentials() is None:
                return
            from database import SessionLocal

            db = SessionLocal()
            try:
                result = binance_sync_service.sync(db)
                print(f"✅ Binance auto-sync: +{result['new_fills']} fills → {result['trade_count']} trades")
            finally:
                db.close()
        except Exception as e:  # noqa: BLE001 — startup must survive any sync failure
            print(f"⚠️ Binance auto-sync skipped: {e}")

    threading.Thread(target=run, daemon=True).start()


_auto_sync_on_startup()

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


class AnnotationUpdate(BaseModel):
    note: Optional[str] = None
    setup_tags: Optional[list[str]] = None
    error_tags: Optional[list[str]] = None
    grade: Optional[str] = None
    emotion: Optional[str] = None
    planned_stop: Optional[float] = None
    planned_target: Optional[float] = None


class DrawingCreate(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=32)
    kind: str = Field(..., min_length=1, max_length=8)
    payload: list[dict]


@app.get("/api/annotations/presets")
def annotation_presets():
    return {
        "setup_tags": list(SETUP_TAG_PRESETS),
        "error_tags": list(ERROR_TAG_PRESETS),
        "emotions": list(EMOTION_PRESETS),
        "grades": list(GRADE_PRESETS),
    }


@app.get("/api/annotations/{subject_type}/{subject_id}")
def get_annotation(subject_type: str, subject_id: int, db: Session = Depends(get_db)):
    try:
        return annotation_service.get_annotation(db, subject_type, subject_id)
    except ValidationError as e:
        raise HTTPException(400, str(e))


@app.put("/api/annotations/{subject_type}/{subject_id}")
def upsert_annotation(
    subject_type: str,
    subject_id: int,
    body: AnnotationUpdate,
    db: Session = Depends(get_db),
):
    try:
        # PUT semantics: full resource replace so clearing a field (null) sticks.
        return annotation_service.upsert_annotation(db, subject_type, subject_id, body.model_dump())
    except ValidationError as e:
        raise HTTPException(400, str(e))


@app.get("/api/drawings")
def list_drawings(symbol: str = Query(...), db: Session = Depends(get_db)):
    return {"symbol": symbol, "data": annotation_service.list_drawings(db, symbol)}


@app.post("/api/drawings")
def create_drawing(body: DrawingCreate, db: Session = Depends(get_db)):
    try:
        return annotation_service.create_drawing(db, body.symbol, body.kind, body.payload)
    except ValidationError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/drawings/{drawing_id}")
def delete_drawing(drawing_id: int, db: Session = Depends(get_db)):
    if not annotation_service.delete_drawing(db, drawing_id):
        raise HTTPException(404, "Drawing not found")
    return {"ok": True}


@app.get("/api/binance/sync/status")
def binance_sync_status(db: Session = Depends(get_db)):
    ds = db.query(Dataset).filter(Dataset.name == SYNC_DATASET_NAME).first()
    return {
        "configured": get_credentials() is not None,
        "dataset_id": ds.id if ds else None,
        "trade_count": db.query(Trade).filter(Trade.dataset_id == ds.id).count() if ds else 0,
    }


@app.post("/api/binance/sync")
def binance_sync(db: Session = Depends(get_db)):
    try:
        return binance_sync_service.sync(db)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except ccxt.AuthenticationError as e:
        raise HTTPException(401, f"币安 API 认证失败，请检查 Key 与 Secret：{e}")
    except ccxt.BaseError as e:
        raise HTTPException(502, f"币安接口请求失败：{e}")


class ReviewUpsert(BaseModel):
    cadence: str = Field(..., min_length=1, max_length=8)
    period_key: str = Field(..., min_length=1, max_length=16)
    content: str = Field(..., min_length=1)


class TrainingSave(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=32)
    timeframe: str = Field(..., min_length=1, max_length=8)
    start_equity: float = Field(..., gt=0)
    realized_pnl: float
    fees: float
    trades: list[dict]


@app.post("/api/train/save")
def save_training_session(body: TrainingSave, db: Session = Depends(get_db)):
    """落库一次训练会话：闭环交易进 owner=sim 数据集，可再进复盘与分析（docs/PRODUCT.md §六）。"""
    if not body.trades:
        raise HTTPException(400, "本局没有任何闭环交易，无需保存")

    now = pd.Timestamp.now(tz="Asia/Shanghai")
    ds_name = f"[训练] {now.strftime('%Y-%m-%d %H:%M')} {body.symbol} {body.timeframe}"[:128]
    existing = db.query(Dataset).filter(Dataset.name == ds_name).first()
    if existing:
        raise HTTPException(400, "该会话已保存过，请勿重复保存")
    ds = Dataset(name=ds_name, owner="sim")
    db.add(ds)
    db.flush()

    rows = []
    for t in body.trades:
        try:
            rows.append(
                Trade(
                    dataset_id=ds.id,
                    symbol=str(t["symbol"]),
                    direction=str(t["direction"]),
                    leverage=float(t.get("leverage") or 1.0),
                    entry_price=float(t["entry_price"]),
                    exit_price=float(t["exit_price"]),
                    profit=float(t["profit"]),
                    profit_rate=float(t["profit"]) / float(t["margin"]) if float(t.get("margin") or 0) > 0 else None,
                    margin=float(t["margin"]) if t.get("margin") else None,
                    entry_time=int(t["entry_time"]),
                    exit_time=int(t["exit_time"]),
                )
            )
        except (KeyError, TypeError, ValueError):
            raise HTTPException(400, "训练交易记录字段无效")
    db.add_all(rows)
    db.commit()
    return {
        "success": True,
        "dataset_id": ds.id,
        "dataset_name": ds_name,
        "trade_count": len(rows),
        "realized_pnl": body.realized_pnl,
        "fees": body.fees,
    }


@app.get("/api/analysis/checklists")
def review_checklists():
    return {"data": [{"cadence": k, "label": v["label"], "questions": v["questions"]} for k, v in REVIEW_CHECKLISTS.items()]}


@app.get("/api/analysis/by-setup")
def analysis_by_setup(include_sim: bool = False, include_master: bool = False, db: Session = Depends(get_db)):
    return analysis_service.by_setup(db, include_sim, include_master)


@app.get("/api/analysis/by-error")
def analysis_by_error(include_sim: bool = False, include_master: bool = False, db: Session = Depends(get_db)):
    return analysis_service.by_error(db, include_sim, include_master)


@app.get("/api/analysis/r-distribution")
def analysis_r_distribution(include_sim: bool = False, include_master: bool = False, db: Session = Depends(get_db)):
    return analysis_service.r_distribution(db, include_sim, include_master)


@app.get("/api/analysis/discipline")
def analysis_discipline(include_sim: bool = False, include_master: bool = False, db: Session = Depends(get_db)):
    return analysis_service.discipline(db, include_sim, include_master)


@app.get("/api/reviews")
def reviews_list(cadence: Optional[str] = None, limit: int = 30, db: Session = Depends(get_db)):
    return {"data": list_reviews(db, cadence, min(max(limit, 1), 200))}


@app.put("/api/reviews")
def reviews_upsert(body: ReviewUpsert, db: Session = Depends(get_db)):
    try:
        return upsert_review(db, body.cadence, body.period_key, body.content)
    except ValueError as e:
        raise HTTPException(400, str(e))


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
            {"id": d.id, "name": d.name, "owner": d.owner, "created_at": d.created_at}
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
    return {"id": d.id, "name": d.name, "owner": d.owner, "created_at": d.created_at}


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
    limit: int = Query(500, ge=1, le=1000),
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
    except ccxt.BadSymbol:
        # 400 (not 404) so a client can tell "this symbol will never work" apart from
        # "this particular range holds no candles", which is the 404 above.
        raise HTTPException(400, f"Unknown symbol: {symbol}")
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
    # flush (not commit): the caller owns the transaction, so a failed import
    # rolls the new dataset back instead of leaving an empty phantom behind.
    db.flush()
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
    if fn.endswith(".xls"):
        # Every reader here is pinned to openpyxl, which only speaks .xlsx.
        raise HTTPException(400, "不支持旧版 .xls，请用 Excel 另存为 .xlsx 后再导入")
    if not fn.endswith((".xlsx", ".csv")):
        raise HTTPException(400, "Only .xlsx, .csv are supported")

    ds_name = (label.strip() if label and label.strip() else _dataset_label_from_filename(file.filename))
    suffix = ".csv" if fn.endswith(".csv") else ".xlsx"
    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name
        resolved = detect_template(tmp_path) if template == "auto" else template

        # One transaction for the whole import: the replace-delete, the new dataset
        # and the parsed rows commit together, so a parse failure anywhere leaves the
        # user's existing data untouched.
        dataset = _find_or_create_dataset(db, ds_name)
        dataset_id = int(dataset.id)
        dataset_name = str(dataset.name)
        if replace:
            db.query(TradeFill).filter(TradeFill.dataset_id == dataset_id).delete()
            db.query(Trade).filter(Trade.dataset_id == dataset_id).delete()

        result = trade_importer.parse_file(db, tmp_path, dataset_id, resolved)
        if not result.get("success"):
            # A recognised sheet that yields nothing must not be able to wipe a dataset.
            raise HTTPException(400, "未识别到任何可导入的交易，已保留原有数据")
        db.commit()
        result["template"] = resolved
        result["dataset_id"] = dataset_id
        result["dataset_name"] = dataset_name
        result["replaced"] = replace
        return result
    except HTTPException:
        db.rollback()
        raise
    except ValueError as e:
        db.rollback()
        raise HTTPException(400, str(e))
    except (zipfile.BadZipFile, pd.errors.ParserError) as e:
        db.rollback()
        raise HTTPException(400, f"文件无法解析，请确认是完整的 .xlsx / .csv 表格（{type(e).__name__}）")
    except Exception as e:
        db.rollback()
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


# --- Masters API ---


@app.get("/api/masters")
def list_masters(
    search: Optional[str] = None,
    has_positions_only: bool = Query(True),
    sort_by: str = Query("sharp_ratio", description="Default sharp_ratio; roi stays selectable"),
    sort_order: str = Query("desc"),
    page: int = Query(1, ge=1),
    limit: int = Query(30, ge=1, le=200),
    db: Session = Depends(get_db),
):
    return master_service.list_masters(
        db,
        search=search,
        has_positions_only=has_positions_only,
        sort_by=sort_by,
        sort_order=sort_order,
        page=page,
        limit=limit,
    )


@app.get("/api/masters/quotes")
def get_master_quotes():
    return {"data": master_service.get_quotes()}


@app.get("/api/masters/overlay")
def get_master_overlay(
    symbol: str,
    start_ts: int = Query(..., description="Start timestamp (ms)"),
    end_ts: int = Query(..., description="End timestamp (ms)"),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    data = master_service.get_overlay_actions(
        db,
        symbol=symbol,
        start_ts=start_ts,
        end_ts=end_ts,
        limit=limit,
    )
    return {"symbol": symbol, "data": data}


@app.get("/api/masters/{trader_id}")
def get_master_detail(trader_id: str, db: Session = Depends(get_db)):
    detail = master_service.get_master_detail(db, trader_id)
    if not detail:
        raise HTTPException(404, "Master trader not found")
    return detail


@app.get("/api/masters/{trader_id}/positions")
def get_master_positions(
    trader_id: str,
    symbol: Optional[str] = None,
    side: Optional[str] = None,
    start_date: Optional[int] = Query(None, description="Start timestamp (ms)"),
    end_date: Optional[int] = Query(None, description="End timestamp (ms)"),
    sort_by: str = Query("opened_at", description="Sort by field: opened_at, roi, pnl"),
    sort_order: str = Query("desc", description="Sort order: desc or asc"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    return master_service.get_master_positions(
        db,
        trader_id=trader_id,
        symbol=symbol,
        side=side,
        start_date=start_date,
        end_date=end_date,
        sort_by=sort_by,
        sort_order=sort_order,
        page=page,
        limit=limit,
    )


@app.post("/api/masters/{trader_id}/sync")
def sync_master_trader(trader_id: str, db: Session = Depends(get_db)):
    try:
        return master_service.sync_trader_from_binance(db, trader_id)
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


_static_dir = os.getenv("RETRAQ_STATIC_DIR")
if _static_dir and os.path.isdir(_static_dir):
    from fastapi.responses import FileResponse, JSONResponse
    from fastapi.staticfiles import StaticFiles
    from starlette.exceptions import HTTPException as StarletteHTTPException

    _index_html = os.path.join(_static_dir, "index.html")

    @app.exception_handler(404)
    async def spa_fallback(request: Request, exc: StarletteHTTPException) -> Response:
        """SPA deep links (/replay, /analysis, …) have no file; the router resolves them client-side."""
        if request.url.path.startswith("/api") or request.method not in ("GET", "HEAD"):
            return JSONResponse({"detail": exc.detail}, status_code=404)
        if not os.path.isfile(_index_html):
            return JSONResponse({"detail": exc.detail}, status_code=404)
        # Only navigations fall back; a missing asset must stay a 404 so a broken
        # build fails loudly instead of serving HTML as JS.
        if os.path.splitext(request.url.path)[1]:
            return JSONResponse({"detail": exc.detail}, status_code=404)
        return FileResponse(_index_html)

    # Real assets stay with StaticFiles; only its 404s reach the fallback above.
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="static")