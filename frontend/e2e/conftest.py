"""E2E fixtures: browser, seeded datasets/masters, external-request guard.

Servers must be up before running (see repo AGENTS.md):
    backend  : cd backend && uv run uvicorn main:app --reload --port 9527
    frontend : cd frontend && pnpm dev            (vite :5173)

Run from repo root:
    /usr/bin/python -m pytest frontend/e2e -q

Seeding is hermetic per session: a dedicated self dataset is created through
the public import API and three master traders are inserted directly into
SQLite (no write API exists); both are removed on teardown.
"""

import json
import sqlite3
import time
from pathlib import Path
from urllib.parse import urlparse

import pytest
from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright

from helpers import API_URL, BASE_URL

DB_PATH = Path(__file__).resolve().parents[2] / "backend" / "trading.db"

# Local-first: the app talks only to the Vite proxy; Google Fonts is the one
# allowed CDN (DESIGN §4 font stack). Anything else is aborted and recorded.
_ALLOWED_HOSTS = ("localhost", "127.0.0.1", "fonts.googleapis.com", "fonts.gstatic.com")

# 交割单 template (langge) — auto-detected from the 「交易对」header row.
SELF_CSV = (
    "交易对,方向,杠杆倍数,开仓均价,平仓均价,收益率,收益 (USDT),保证金（最大时）,买入时间,卖出时间\n"
    "ETH-USDT,做多,10,3000,3150,0.05,150,3000,2026-08-10 10:00:00,2026-08-10 18:00:00\n"
    "ETH-USDT,做空,5,3100,3050,0.0161,50,3100,2026-08-12 09:00:00,2026-08-12 15:00:00\n"
    "ETH-USDT,做多,20,3200,3136,-0.02,-128,3200,2026-08-15 14:00:00,2026-08-15 22:30:00\n"
    "ETH-USDT,做多,10,3000,3300,0.10,300,3000,2026-08-18 08:00:00,2026-08-19 02:00:00\n"
)

# sharp_ratio is the default sort and roi the decoy (PRODUCT §五.3): the seeded
# trio ranks oppositely under the two keys, so a wrong default cannot pass.
SEED_MASTERS = [
    {"id": "e2e-m1", "nickname": "E2E甲", "roi": 0.5, "pnl": 5000.0, "sharp_ratio": 3.0,
     "mdd": 0.1, "win_rate": 0.7, "trading_days": 200, "position_count": 2},
    {"id": "e2e-m2", "nickname": "E2E乙", "roi": 1.0, "pnl": 8000.0, "sharp_ratio": 2.0,
     "mdd": 0.2, "win_rate": 0.6, "trading_days": 150, "position_count": 1},
    {"id": "e2e-m3", "nickname": "E2E丙", "roi": 2.0, "pnl": 12000.0, "sharp_ratio": 1.0,
     "mdd": 0.3, "win_rate": 0.5, "trading_days": 100, "position_count": 1},
]

# ETH-USDT 15m klines span 2026-08-04..08-29 in the seeded trading.db.
SEED_MASTER_POSITIONS = [
    {"trader_id": "e2e-m1", "symbol": "ETH-USDT", "side": "LONG", "leverage": 20,
     "entry_price": 3000.0, "close_price": 3150.0, "pnl": 150.0, "roi": 0.05,
     "opened_at": 1786321200000, "closed_at": 1786350000000, "max_amount": 300.0},
    {"trader_id": "e2e-m1", "symbol": "ETH-USDT", "side": "SHORT", "leverage": 10,
     "entry_price": 3200.0, "close_price": 3136.0, "pnl": -128.0, "roi": -0.02,
     "opened_at": 1786556400000, "closed_at": 1786585800000, "max_amount": 320.0},
    {"trader_id": "e2e-m2", "symbol": "ETH-USDT", "side": "LONG", "leverage": 10,
     "entry_price": 3000.0, "close_price": 3300.0, "pnl": 300.0, "roi": 0.10,
     "opened_at": 1786653600000, "closed_at": 1786686000000, "max_amount": 300.0},
    {"trader_id": "e2e-m3", "symbol": "ETH-USDT", "side": "LONG", "leverage": 20,
     "entry_price": 3000.0, "close_price": 3150.0, "pnl": 150.0, "roi": 0.05,
     "opened_at": 1786740000000, "closed_at": 1786768800000, "max_amount": 300.0},
]


def _seed_master_rows() -> None:
    con = sqlite3.connect(DB_PATH, timeout=15)
    try:
        con.execute("PRAGMA busy_timeout=15000")
        for t in SEED_MASTERS:
            con.execute(
                """INSERT OR REPLACE INTO master_traders
                   (id, nickname, market, roi, pnl, mdd, win_rate, sharp_ratio, has_positions, position_count)
                   VALUES (?,?,?,?,?,?,?,?,1,?)""",
                (t["id"], t["nickname"], "futures", t["roi"], t["pnl"], t["mdd"],
                 t["win_rate"], t["sharp_ratio"], t["position_count"]),
            )
        con.execute("DELETE FROM master_positions WHERE trader_id LIKE 'e2e-%'")
        for i, p in enumerate(SEED_MASTER_POSITIONS):
            con.execute(
                """INSERT INTO master_positions
                   (position_id, trader_id, symbol, side, margin_mode, leverage, entry_price,
                    close_price, pnl, roi, opened_at, closed_at, max_amount, closed_amount, status)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (f"e2e-pos-{i}", p["trader_id"], p["symbol"], p["side"], "Cross",
                 p["leverage"], p["entry_price"], p["close_price"], p["pnl"], p["roi"],
                 p["opened_at"], p["closed_at"], p["max_amount"], p["max_amount"], "Closed"),
            )
        con.commit()
    finally:
        con.close()


def _cleanup_master_rows() -> None:
    con = sqlite3.connect(DB_PATH, timeout=15)
    try:
        con.execute("PRAGMA busy_timeout=15000")
        con.execute("DELETE FROM master_positions WHERE trader_id LIKE 'e2e-%'")
        con.execute("DELETE FROM master_traders WHERE id LIKE 'e2e-%'")
        con.commit()
    finally:
        con.close()


@pytest.fixture(scope="session")
def playwright():
    with sync_playwright() as p:
        yield p


@pytest.fixture(scope="session")
def browser(playwright):
    b = playwright.chromium.launch(headless=True)
    yield b
    b.close()


@pytest.fixture(scope="session")
def api(playwright):
    """HTTP client against the backend for seeding and assertions."""
    ctx = playwright.request.new_context(base_url=API_URL)
    yield ctx
    ctx.dispose()


@pytest.fixture(scope="session")
def seed(api):
    """Session-wide test data: one self dataset + three master traders."""
    stamp = time.strftime("%Y%m%d-%H%M%S")
    ds_name = f"[E2E] 复盘种子 {stamp}"
    resp = api.post(
        "/api/trades/import",
        params={"template": "langge", "label": ds_name},
        multipart={
            "file": {
                "name": "e2e_seed.csv",
                "mimeType": "text/csv",
                "buffer": SELF_CSV.encode("utf-8"),
            }
        },
    )
    assert resp.ok, f"seed import failed: {resp.status()} {resp.text()}"
    body = resp.json()
    ds_id = body["dataset_id"]
    assert body["success"] == 4, f"expected 4 seeded trades, got {body}"

    trades = api.get("/api/trades", headers={"X-Dataset-Id": str(ds_id)}).json()["data"]
    assert len(trades) == 4

    _seed_master_rows()
    yield {
        "dataset_id": ds_id,
        "dataset_name": ds_name,
        "trades": trades,
        "master_ids": [t["id"] for t in SEED_MASTERS],
    }
    api.delete(f"/api/datasets/{ds_id}")
    _cleanup_master_rows()


def install_guard(context: BrowserContext) -> list:
    """Abort non-local requests; returns the list of blocked hosts (§goal layer 4)."""
    blocked = []

    def guard(route):
        host = urlparse(route.request.url).hostname or ""
        if host in _ALLOWED_HOSTS:
            route.continue_()
        else:
            blocked.append(host)
            route.abort()

    context.route("**/*", guard)
    return blocked


def hook_page(page: Page) -> None:
    page._retraq_dialogs = []  # type: ignore[attr-defined]
    page._console_errors = []  # type: ignore[attr-defined]
    page.on("dialog", lambda d: (page._retraq_dialogs.append(f"{d.type}: {d.message}"), d.dismiss()))  # type: ignore[attr-defined]
    page.on("console", lambda m: page._console_errors.append(m.text) if m.type == "error" else None)  # type: ignore[attr-defined]
    page.on("pageerror", lambda e: page._console_errors.append(str(e)))  # type: ignore[attr-defined]


def new_context(browser: Browser, seed, *, viewport=(1440, 900), theme=None) -> BrowserContext:
    ctx = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]})
    ctx.add_init_script(
        f"window.localStorage.setItem('retraq.activeDatasetId', '{seed['dataset_id']}');"
        + (f"window.localStorage.setItem('retraq-theme', '{theme}');" if theme else "")
    )
    install_guard(ctx)
    return ctx


@pytest.fixture()
def context(browser, seed):
    ctx = new_context(browser, seed)
    yield ctx
    ctx.close()


@pytest.fixture()
def page(context):
    p = context.new_page()
    hook_page(p)
    yield p


def mock_binance_sync(page: Page, *, new_fills: int = 7, trade_count: int = 42) -> None:
    """§四 — the UI must work without reaching Binance; responses follow api.ts types."""
    page.route(
        "**/api/binance/sync",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"success": True, "new_fills": new_fills, "trade_count": trade_count, "dataset_id": 1}),
        ),
    )
