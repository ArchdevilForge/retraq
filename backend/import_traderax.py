#!/usr/bin/env python3
"""Importer for Traderax Binance Futures Top Traders & Delivery Slips.

Strictly filters for futures (合约) traders and their closed position delivery slips.
"""

import argparse
import json
import os
import sys
import time
import zipfile
from typing import Optional

from sqlalchemy.orm import Session

# Allow running as standalone script
sys.path.insert(0, os.path.dirname(__file__))

from database import engine, SessionLocal
from migrate import ensure_database
from models import MasterTrader, MasterPosition
from services.symbol_utils import normalize_symbol, is_valid_symbol


def _safe_float(val: Optional[object], default: Optional[float] = None) -> Optional[float]:
    if val is None:
        return default
    try:
        f = float(val)  # type: ignore[arg-type]
        return f if (f == f and f != float("inf") and f != float("-inf")) else default
    except (ValueError, TypeError):
        return default


def _safe_int(val: Optional[object], default: Optional[int] = None) -> Optional[int]:
    if val is None:
        return default
    try:
        return int(float(str(val)))
    except (ValueError, TypeError):
        return default


def import_traderax_from_zip(zip_path: str, db: Session, clear_existing: bool = True) -> dict:
    if not os.path.isfile(zip_path):
        raise FileNotFoundError(f"Zip file not found: {zip_path}")

    start_time = time.time()
    print(f"📦 Reading Traderax data from zip: {zip_path}")

    with zipfile.ZipFile(zip_path, "r") as z:
        # 1. Read rankings
        rankings_7d: list[dict] = []
        rankings_30d: list[dict] = []
        rankings_90d: list[dict] = []

        if "traderax_data/rankings/rankings_7D.json" in z.namelist():
            rankings_7d = json.loads(z.read("traderax_data/rankings/rankings_7D.json").decode("utf-8"))
        if "traderax_data/rankings/rankings_30D.json" in z.namelist():
            rankings_30d = json.loads(z.read("traderax_data/rankings/rankings_30D.json").decode("utf-8"))
        if "traderax_data/rankings/rankings_90D.json" in z.namelist():
            rankings_90d = json.loads(z.read("traderax_data/rankings/rankings_90D.json").decode("utf-8"))

        futures_30d_map = {
            r["id"]: r for r in rankings_30d if isinstance(r, dict) and r.get("market") == "futures" and "id" in r
        }
        futures_90d_map = {
            r["id"]: r for r in rankings_90d if isinstance(r, dict) and r.get("market") == "futures" and "id" in r
        }

        # Collect unique futures traders
        trader_meta: dict[str, dict] = {}

        for r in rankings_7d:
            if not isinstance(r, dict) or r.get("market") != "futures" or "id" not in r:
                continue
            tid = str(r["id"])
            trader_meta[tid] = {
                "id": tid,
                "nickname": str(r.get("nickname") or "未命名交易员"),
                "market": "futures",
                "avatar_url": r.get("avatarUrl"),
                "roi": _safe_float(r.get("roi")),
                "pnl": _safe_float(r.get("pnl")),
                "mdd": _safe_float(r.get("mdd")),
                "win_rate": _safe_float(r.get("winRate")),
                "sharp_ratio": _safe_float(r.get("sharpRatio")),
                "aum": _safe_float(r.get("aum")),
                "trading_days": _safe_int(r.get("tradingDays")),
                "current_copy_count": _safe_int(r.get("currentCopyCount")),
                "max_copy_count": _safe_int(r.get("maxCopyCount")),
                "badge": r.get("badge"),
                "tags": json.dumps(r.get("rankingTags", []), ensure_ascii=False) if r.get("rankingTags") else None,
                "equity_chart": json.dumps(r.get("chart", []), ensure_ascii=False) if r.get("chart") else None,
                "equity_chart_30d": json.dumps(futures_30d_map[tid].get("chart", []), ensure_ascii=False)
                if tid in futures_30d_map and futures_30d_map[tid].get("chart")
                else None,
                "equity_chart_90d": json.dumps(futures_90d_map[tid].get("chart", []), ensure_ascii=False)
                if tid in futures_90d_map and futures_90d_map[tid].get("chart")
                else None,
                "detail_url": r.get("detailUrl"),
                "has_positions": False,
                "position_count": 0,
            }

        # Also add any futures trader from 30D / 90D not in 7D
        for src_map in (futures_30d_map, futures_90d_map):
            for tid, r in src_map.items():
                if tid not in trader_meta:
                    trader_meta[tid] = {
                        "id": tid,
                        "nickname": str(r.get("nickname") or "未命名交易员"),
                        "market": "futures",
                        "avatar_url": r.get("avatarUrl"),
                        "roi": _safe_float(r.get("roi")),
                        "pnl": _safe_float(r.get("pnl")),
                        "mdd": _safe_float(r.get("mdd")),
                        "win_rate": _safe_float(r.get("winRate")),
                        "sharp_ratio": _safe_float(r.get("sharpRatio")),
                        "aum": _safe_float(r.get("aum")),
                        "trading_days": _safe_int(r.get("tradingDays")),
                        "current_copy_count": _safe_int(r.get("currentCopyCount")),
                        "max_copy_count": _safe_int(r.get("maxCopyCount")),
                        "badge": r.get("badge"),
                        "tags": json.dumps(r.get("rankingTags", []), ensure_ascii=False) if r.get("rankingTags") else None,
                        "equity_chart": json.dumps(r.get("chart", []), ensure_ascii=False) if r.get("chart") else None,
                        "equity_chart_30d": None,
                        "equity_chart_90d": None,
                        "detail_url": r.get("detailUrl"),
                        "has_positions": False,
                        "position_count": 0,
                    }

        print(f"📊 Extracted {len(trader_meta)} futures traders from rankings")

        # 2. Read positions
        pos_names = [n for n in z.namelist() if n.startswith("traderax_data/positions_json/") and n.endswith(".json")]
        positions_to_insert: list[dict] = []
        traders_with_pos_count = 0

        for pf in pos_names:
            try:
                pdata = json.loads(z.read(pf).decode("utf-8"))
            except Exception as e:
                print(f"Warning: failed reading {pf}: {e}")
                continue

            trader_info = pdata.get("trader") or {}
            if trader_info.get("market") != "futures":
                continue

            recs = pdata.get("records") or []
            if not recs:
                continue

            tid = str(trader_info.get("id") or "")
            if not tid:
                continue

            if tid not in trader_meta:
                trader_meta[tid] = {
                    "id": tid,
                    "nickname": str(trader_info.get("nickname") or "未命名交易员"),
                    "market": "futures",
                    "avatar_url": trader_info.get("avatarUrl"),
                    "roi": _safe_float(trader_info.get("roi")),
                    "pnl": _safe_float(trader_info.get("pnl")),
                    "mdd": _safe_float(trader_info.get("mdd")),
                    "win_rate": _safe_float(trader_info.get("winRate")),
                    "sharp_ratio": _safe_float(trader_info.get("sharpRatio")),
                    "aum": _safe_float(trader_info.get("aum")),
                    "trading_days": _safe_int(trader_info.get("tradingDays")),
                    "current_copy_count": _safe_int(trader_info.get("currentCopyCount")),
                    "max_copy_count": _safe_int(trader_info.get("maxCopyCount")),
                    "badge": trader_info.get("badge"),
                    "tags": json.dumps(trader_info.get("rankingTags", []), ensure_ascii=False)
                    if trader_info.get("rankingTags")
                    else None,
                    "equity_chart": json.dumps(trader_info.get("chart", []), ensure_ascii=False)
                    if trader_info.get("chart")
                    else None,
                    "equity_chart_30d": None,
                    "equity_chart_90d": None,
                    "detail_url": trader_info.get("detailUrl"),
                    "has_positions": False,
                    "position_count": 0,
                }

            valid_pos_count = 0
            for idx, r in enumerate(recs):
                raw_sym = str(r.get("symbol") or "")
                sym = normalize_symbol(raw_sym)
                if not is_valid_symbol(sym):
                    continue

                pid = str(r.get("id") or "")
                opened_at = _safe_int(r.get("openedAt"))
                if not opened_at:
                    continue

                side_raw = str(r.get("side") or "").upper()
                side = "LONG" if "LONG" in side_raw or "BUY" in side_raw or "多" in side_raw else "SHORT"

                entry_price = _safe_float(r.get("entryPrice"))
                if entry_price is None or entry_price <= 0:
                    continue

                positions_to_insert.append(
                    {
                        "position_id": pid or None,
                        "trader_id": tid,
                        "symbol": sym,
                        "side": side,
                        "margin_mode": r.get("marginMode"),
                        "leverage": _safe_float(r.get("leverage"), 20.0),
                        "entry_price": entry_price,
                        "close_price": _safe_float(r.get("closePrice")),
                        "pnl": _safe_float(r.get("pnl")),
                        "roi": _safe_float(r.get("roi")),
                        "opened_at": opened_at,
                        "closed_at": _safe_int(r.get("closedAt")),
                        "max_amount": _safe_float(r.get("maxAmount")),
                        "closed_amount": _safe_float(r.get("closedAmount")),
                        "status": r.get("status") or "All Closed",
                    }
                )
                valid_pos_count += 1

            if valid_pos_count > 0:
                trader_meta[tid]["has_positions"] = True
                trader_meta[tid]["position_count"] = valid_pos_count
                traders_with_pos_count += 1

        print(
            f"🎯 Parsed {len(positions_to_insert)} futures positions across {traders_with_pos_count} traders"
        )

        # 3. Database Insertion in Transaction
        if clear_existing:
            print("🧹 Re-creating master traders and positions tables...")
            MasterPosition.__table__.drop(bind=engine, checkfirst=True)
            MasterTrader.__table__.drop(bind=engine, checkfirst=True)
            MasterTrader.__table__.create(bind=engine, checkfirst=True)
            MasterPosition.__table__.create(bind=engine, checkfirst=True)

        print("💾 Saving master traders to database...")
        trader_objs = [MasterTrader(**m) for m in trader_meta.values()]
        db.bulk_save_objects(trader_objs)
        db.flush()

        print(f"💾 Saving {len(positions_to_insert)} master positions in chunks...")
        chunk_size = 10000
        for i in range(0, len(positions_to_insert), chunk_size):
            chunk = positions_to_insert[i : i + chunk_size]
            pos_objs = [MasterPosition(**p) for p in chunk]
            db.bulk_save_objects(pos_objs)
            db.flush()

        db.commit()

        elapsed = time.time() - start_time
        print(
            f"✅ Successfully imported {len(trader_meta)} futures traders ({traders_with_pos_count} with delivery slips) "
            f"and {len(positions_to_insert)} contract positions in {elapsed:.2f}s!"
        )

        return {
            "traders_count": len(trader_meta),
            "traders_with_positions": traders_with_pos_count,
            "positions_count": len(positions_to_insert),
            "elapsed_seconds": round(elapsed, 2),
        }


def main():
    parser = argparse.ArgumentParser(description="Import Traderax Futures Top Traders data into Retraq")
    parser.add_argument(
        "--zip",
        type=str,
        default="/home/xeron/Downloads/traderax_data_full.zip",
        help="Path to traderax_data_full.zip",
    )
    args = parser.parse_args()

    ensure_database()
    db = SessionLocal()
    try:
        res = import_traderax_from_zip(args.zip, db, clear_existing=True)
        print("Import Summary:", res)
    finally:
        db.close()


if __name__ == "__main__":
    main()
