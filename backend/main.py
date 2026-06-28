import os
import tempfile
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Query, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from migrate import ensure_database
from models import Trade, Profile
from profile_scope import get_profile_id
from services.kline_service import kline_service, TIMEFRAMES
from services.trade_importer import trade_importer, TEMPLATES, TEMPLATE_LABELS
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


class ProfileCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)


class ProfileUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)


@app.get("/api/import/templates")
def list_import_templates():
    return {
        "templates": [
            {"id": k, "label": TEMPLATE_LABELS.get(k, k)} for k in TEMPLATES
        ]
    }


@app.get("/api/profiles")
def list_profiles(db: Session = Depends(get_db)):
    rows = db.query(Profile).order_by(Profile.id).all()
    return {
        "data": [
            {"id": p.id, "name": p.name, "user_id": p.user_id, "created_at": p.created_at}
            for p in rows
        ]
    }


@app.post("/api/profiles")
def create_profile(body: ProfileCreate, db: Session = Depends(get_db)):
    if db.query(Profile).filter(Profile.name == body.name).first():
        raise HTTPException(400, "Profile name already exists")
    p = Profile(name=body.name)
    db.add(p)
    db.commit()
    db.refresh(p)
    return {"id": p.id, "name": p.name, "user_id": p.user_id, "created_at": p.created_at}


@app.patch("/api/profiles/{profile_id}")
def update_profile(profile_id: int, body: ProfileUpdate, db: Session = Depends(get_db)):
    p = db.query(Profile).filter(Profile.id == profile_id).first()
    if not p:
        raise HTTPException(404, "Profile not found")
    other = db.query(Profile).filter(Profile.name == body.name, Profile.id != profile_id).first()
    if other:
        raise HTTPException(400, "Profile name already exists")
    p.name = body.name
    db.commit()
    db.refresh(p)
    return {"id": p.id, "name": p.name, "user_id": p.user_id, "created_at": p.created_at}


@app.delete("/api/profiles/{profile_id}")
def delete_profile(profile_id: int, db: Session = Depends(get_db)):
    p = db.query(Profile).filter(Profile.id == profile_id).first()
    if not p:
        raise HTTPException(404, "Profile not found")
    db.delete(p)
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


@app.post("/api/trades/import")
async def import_trades(
    request: Request,
    file: UploadFile = File(...),
    template: str = Query("langge"),
    db: Session = Depends(get_db),
):
    profile_id = get_profile_id(request, db)
    if template not in TEMPLATES:
        raise HTTPException(400, f"Unknown template. Supported: {list(TEMPLATES)}")
    if not file.filename:
        raise HTTPException(400, "Missing filename")
    fn = file.filename.lower()
    if not fn.endswith((".xlsx", ".xls", ".csv")):
        raise HTTPException(400, "Only .xlsx, .xls, .csv are supported")
    suffix = ".csv" if fn.endswith(".csv") else ".xlsx"
    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name
        return trade_importer.parse_file(db, tmp_path, profile_id, template)
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


@app.get("/api/trades")
def get_trades(
    request: Request,
    symbol: Optional[str] = None,
    start_date: Optional[int] = Query(None, description="Start timestamp (ms)"),
    end_date: Optional[int] = Query(None, description="End timestamp (ms)"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    profile_id = get_profile_id(request, db)
    query = db.query(Trade).filter(Trade.profile_id == profile_id)
    if symbol:
        normalized = normalize_symbol(symbol)
        if not is_valid_symbol(normalized):
            return {"total": 0, "page": page, "limit": limit, "data": []}
        query = query.filter(Trade.symbol == normalized)
    if start_date:
        query = query.filter(Trade.entry_time >= start_date)
    if end_date:
        query = query.filter(Trade.entry_time <= end_date)

    trades = [t for t in query.order_by(Trade.entry_time.desc()).all() if is_valid_symbol(t.symbol)]
    total = len(trades)
    start_idx = (page - 1) * limit
    trades = trades[start_idx:start_idx + limit]

    return {
        "total": total,
        "page": page,
        "limit": limit,
        "data": [
            {
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
            for t in trades
        ],
    }


@app.get("/api/stats/overview")
def get_stats_overview(request: Request, db: Session = Depends(get_db)):
    profile_id = get_profile_id(request, db)
    return trade_analyzer.calculate_stats(db, profile_id)
