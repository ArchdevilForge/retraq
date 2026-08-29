"""Layer 2 — dataset flows (docs/PRODUCT.md §四, §三 owner 分组; docs/DESIGN.md §8.3).

Covers import → owner grouping → sync (mocked) → delete. UI 删除入口尚未实现
（api.deleteDataset 无 UI 调用方），删除仅能走 API——CONSTRAINT-MATRIX 记为缺口。
"""

import re
import sqlite3
import time

from playwright.sync_api import expect

from conftest import DB_PATH, hook_page, mock_binance_sync, new_context
from helpers import assert_console_clean, goto

IMPORT_CSV = (
    "交易对,方向,杠杆倍数,开仓均价,平仓均价,收益率,收益 (USDT),保证金（最大时）,买入时间,卖出时间\n"
    "ETH-USDT,做多,10,3000,3150,0.05,150,3000,2026-08-10 10:00:00,2026-08-10 18:00:00\n"
    "ETH-USDT,做空,5,3100,3050,0.0161,50,3100,2026-08-12 09:00:00,2026-08-12 15:00:00\n"
)


def _open_picker(page):
    page.locator("header.oc-navbar button[aria-haspopup='listbox']").click()
    return page.locator(".oc-dropdown")


def test_csv_import_through_dataset_picker(browser, seed, api):
    """§四 — 手动 Excel/CSV 导入保留为兜底路径，导入必出 Toast（§8.3）。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    before = {d["id"] for d in api.get("/api/datasets").json()["data"]}
    stamp = time.strftime("%H%M%S")
    try:
        hook_page(page)
        goto(page, "/replay")
        _open_picker(page)
        page.locator("input[aria-label='导入表格文件']").set_input_files(
            files=[{"name": f"[E2E]导入{stamp}.csv", "mimeType": "text/csv", "buffer": IMPORT_CSV.encode()}]
        )
        expect(page.locator(".oc-toast", has_text=re.compile(r"导入完成：2 笔成功"))).to_be_visible(timeout=15000)

        after = api.get("/api/datasets").json()["data"]
        created = [d for d in after if d["id"] not in before]
        assert created and created[0]["name"] == f"[E2E]导入{stamp}", f"imported dataset missing: {created}"
        assert_console_clean(page._console_errors)
    finally:
        for d in api.get("/api/datasets").json()["data"]:
            if d["id"] not in before:
                api.delete(f"/api/datasets/{d['id']}")
        ctx.close()


def test_owner_groups_in_picker(browser, seed):
    """PRODUCT §三 — 每个数据集带主体：我的 / 高手 / 训练 分组互不污染。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    con = sqlite3.connect(DB_PATH, timeout=15)
    try:
        con.execute("PRAGMA busy_timeout=15000")
        con.execute("INSERT OR IGNORE INTO datasets (name, owner) VALUES ('[E2E]高手数据集', 'master:e2e-m1')")
        con.execute("INSERT OR IGNORE INTO datasets (name, owner) VALUES ('[E2E]训练数据集', 'sim')")
        con.commit()

        hook_page(page)
        goto(page, "/replay")
        dropdown = _open_picker(page)
        for group in ("我的", "高手", "训练"):
            expect(dropdown.get_by_text(group, exact=True)).to_be_visible(timeout=10000)
        # owner isolation: each row lands in its own group (§三 / §10 不得混入 self)
        expect(dropdown.get_by_text(seed["dataset_name"])).to_be_visible()
        expect(dropdown.get_by_text("[E2E]高手数据集")).to_be_visible()
        expect(dropdown.get_by_text("[E2E]训练数据集")).to_be_visible()
        assert_console_clean(page._console_errors)
    finally:
        con.execute("DELETE FROM datasets WHERE name IN ('[E2E]高手数据集', '[E2E]训练数据集')")
        con.commit()
        con.close()
        ctx.close()


def test_binance_sync_button_mocked(browser, seed, page):
    """§四 — 数据源切换器内手动同步入口：mock 掉币安后 UI 出成功 Toast。"""
    mock_binance_sync(page)
    hook_page(page)
    goto(page, "/replay")
    dropdown = _open_picker(page)
    sync_btn = page.get_by_role("button", name=re.compile("同步币安合约"))
    expect(sync_btn).to_be_visible(timeout=10000)
    sync_btn.click()
    expect(page.locator(".oc-toast", has_text=re.compile(r"币安同步完成：新增 7 笔成交"))).to_be_visible(
        timeout=10000
    )


def test_delete_dataset_via_ui_two_step_confirm(browser, seed, api, page):
    """§四/§10 — 列表行内删除：两步确认（禁 confirm()）+ 成功 Toast + 列表消失。"""
    created = None
    try:
        resp = api.post(
            "/api/trades/import",
            params={"template": "langge", "label": "[E2E]UI删除"},
            multipart={"file": {"name": "del.csv", "mimeType": "text/csv", "buffer": IMPORT_CSV.encode()}},
        )
        assert resp.ok
        created = resp.json()["dataset_id"]

        goto(page, "/replay")
        _open_picker(page)
        row_btn = page.get_by_role("button", name=f"删除数据集 [E2E]UI删除")
        expect(row_btn).to_be_visible(timeout=10000)
        row_btn.click()  # 第一步：进入待确认
        confirm_btn = page.get_by_role("button", name=f"确认删除 [E2E]UI删除")
        expect(confirm_btn).to_be_visible()
        confirm_btn.click()  # 第二步：真删
        expect(page.locator(".oc-toast", has_text="数据集已删除")).to_be_visible(timeout=10000)
        expect(page.get_by_role("button", name=f"删除数据集 [E2E]UI删除")).not_to_be_visible(timeout=10000)

        ids = [d["id"] for d in api.get("/api/datasets").json()["data"]]
        assert created not in ids, "dataset still listed after UI delete"
    finally:
        if created:
            api.delete(f"/api/datasets/{created}")


def test_delete_dataset_via_api(browser, seed, api):
    """§四 — 删除数据集（级联成交/持仓）。UI 删除入口缺失，走 API 锚定行为。"""
    created = None
    try:
        resp = api.post(
            "/api/trades/import",
            params={"template": "langge", "label": "[E2E]待删除"},
            multipart={
                "file": {"name": "del.csv", "mimeType": "text/csv", "buffer": IMPORT_CSV.encode()}
            },
        )
        assert resp.ok
        created = resp.json()["dataset_id"]
        r = api.delete(f"/api/datasets/{created}")
        assert r.ok, r.text()
        ids = [d["id"] for d in api.get("/api/datasets").json()["data"]]
        assert created not in ids, "dataset still listed after delete"
    finally:
        if created:
            api.delete(f"/api/datasets/{created}")
