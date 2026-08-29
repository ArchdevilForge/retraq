"""Layer 2 — masters flows (docs/PRODUCT.md §五; docs/DESIGN.md §6, §8).

Seeded trio ranks oppositely under sharp_ratio and roi, so a wrong default
sort cannot pass by accident.
"""

import json
import re

from playwright.sync_api import expect

from conftest import hook_page, mock_binance_sync, new_context
from helpers import assert_console_clean, assert_zero_page_scroll, goto

PANEL = ".oc-float-panel--left"


def _open_masters(page):
    page.get_by_role("button", name="打开高手列表").click()
    expect(page.locator(f"{PANEL}").get_by_text("合约高手榜")).to_be_visible(timeout=10000)
    expect(page.locator(f"{PANEL} button.oc-list-item").first).to_be_visible(timeout=10000)


def _filter_seeded(page):
    """Narrow the 699-trader leaderboard to the three seeded rows."""
    page.locator(f"{PANEL} input[placeholder*='搜索']").fill("E2E")
    expect(page.locator(f"{PANEL} button.oc-list-item", has_text="E2E甲")).to_be_visible(timeout=10000)


def _seeded_order(page):
    texts = [page.locator(f"{PANEL} button.oc-list-item").nth(i).inner_text()
             for i in range(page.locator(f"{PANEL} button.oc-list-item").count())]
    names = [n for n in ("E2E甲", "E2E乙", "E2E丙") if any(n in t for t in texts)]
    return sorted(names, key=lambda n: min(i for i, t in enumerate(texts) if n in t))


def test_leaderboard_defaults_to_sharp_not_roi(browser, seed, api):
    """§五.3 — 排行榜默认 Sharp 排序，不按 ROI；UI 顺序与 API 一致。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    try:
        hook_page(page)
        goto(page, "/replay")
        _open_masters(page)

        sort_select = page.locator(f"{PANEL} select.oc-select").first
        assert sort_select.input_value() == "sharp_ratio", \
            f"default sort must be sharp_ratio, got {sort_select.input_value()}"
        # ROI stays selectable but must not be the default.
        assert sort_select.locator("option[value='roi']").count() == 1

        api_first = api.get("/api/masters").json()["data"][0]["nickname"]
        ui_first = page.locator(f"{PANEL} button.oc-list-item").first.inner_text()
        assert api_first in ui_first, f"UI first row {ui_first!r} != API first {api_first!r}"

        _filter_seeded(page)
        assert _seeded_order(page) == ["E2E甲", "E2E乙", "E2E丙"], \
            f"seeded sharp order wrong: {_seeded_order(page)}"
        assert_console_clean(page._console_errors)
    finally:
        ctx.close()


def test_switching_sort_to_roi_reorders(browser, seed):
    """§五.3 — ROI 是可选维度；切换后顺序反转（种子数据 sharp/roi 互逆）。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    try:
        hook_page(page)
        goto(page, "/replay")
        _open_masters(page)
        _filter_seeded(page)
        page.locator(f"{PANEL} select.oc-select").first.select_option("roi")
        page.wait_for_timeout(800)
        assert _seeded_order(page) == ["E2E丙", "E2E乙", "E2E甲"], \
            f"roi order should invert the seeded trio: {_seeded_order(page)}"
    finally:
        ctx.close()


def test_master_source_switch_and_delivery_slip_linkage(browser, seed):
    """§五.1/§五.2 — 复盘引擎换数据源复盘高手：交割单 → 同一图表引擎联动。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    try:
        hook_page(page)
        goto(page, "/replay")
        assert_zero_page_scroll(page)
        _open_masters(page)
        _filter_seeded(page)

        page.locator(f"{PANEL} button.oc-list-item", has_text="E2E甲").click()
        slips = page.get_by_role("button", name=re.compile("合约交割单"))
        expect(slips).to_be_visible(timeout=10000)
        slips.click()

        pos = page.locator(
            ".oc-float-panel--right button", has_text=re.compile(r"[多空]\s*\d+x")
        ).first
        expect(pos).to_be_visible(timeout=10000)
        pos.click()

        toolbar_symbol = page.locator(".oc-chart-toolbar .font-mono").first
        expect(toolbar_symbol).to_have_text(re.compile("ETH-USDT"), timeout=10000)

        # P§五.2 — 同期「他 vs 我」：chip 显示同期自有持仓数与盈亏，可切换叠加
        chip = page.locator("[data-testid='self-compare-chip']")
        expect(chip).to_be_visible(timeout=10000)
        expect(chip).to_contain_text(re.compile(r"\d+ 笔"))
        chip.get_by_role("button", name="隐藏对照").click()
        expect(chip.get_by_role("button", name="显示对照")).to_be_visible()

        # 战绩画像 tabs: 净值走势 / 实战心法（§五 画像复用同一详情面板）
        page.get_by_role("button", name="净值走势").click()
        expect(page.get_by_text("7日收益曲线走势")).to_be_visible(timeout=10000)
        page.get_by_role("button", name="实战心法").click()
        panel = page.locator(".oc-float-panel--right")
        expect(
            panel.get_by_text("加载合约心法中…").or_(panel.locator("div.rounded-lg")).first
        ).to_be_visible(timeout=10000)
        assert_console_clean(page._console_errors)
    finally:
        ctx.close()


def test_master_sync_mocked(browser, seed, page):
    """§四/§五 — 手动同步入口在 UI 可用且不触外网（route mock 掉币安请求）。"""
    mock_binance_sync(page)  # dataset-level sync stays mocked too
    page.route(
        "**/api/masters/e2e-m1/sync",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"success": True, "new_count": 3, "total_positions": 10}),
        ),
    )
    goto(page, "/replay")
    _open_masters(page)
    _filter_seeded(page)
    page.locator(f"{PANEL} button.oc-list-item", has_text="E2E甲").click()

    sync_btn = page.get_by_role("button", name=re.compile("更新最新交割单"))
    expect(sync_btn).to_be_visible(timeout=10000)
    sync_btn.click()

    expect(page.locator(".oc-toast", has_text="已从币安同步最新交割单")).to_be_visible(timeout=10000)
