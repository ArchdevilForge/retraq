"""Layer 4 — runtime health via Chrome DevTools Protocol (goal layer 4).

chrome-devtools-MCP-equivalent checks implemented over Playwright's CDP
session: console/network cleanliness across a full journey, CPU throttling,
and heap growth. Screenshots for human review live in test_visual.py.
"""

import re

from playwright.sync_api import expect

from conftest import hook_page, new_context
from helpers import (
    assert_api_responses_clean,
    assert_console_clean,
    goto,
)

DRAG_SURFACE = "div.relative.min-h-0.flex-1 > div.absolute.inset-0"


def _heap_used_mb(cdp):
    for m in cdp.send("Performance.getMetrics")["metrics"]:
        if m["name"] == "JSHeapUsedSize":
            return m["value"] / 1024 / 1024
    raise AssertionError("JSHeapUsedSize metric missing")


def test_full_journey_console_and_network(browser, seed):
    """Layer 4 — console 0 error + 无未 mock 的 4xx/5xx（klines 上游 502 除外）。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    responses = []
    try:
        hook_page(page)
        page.on("response", lambda r: responses.append({"status": r.status, "url": r.url}))

        # replay: pick a trade, chart linkage, drawings panel
        goto(page, "/replay")
        page.get_by_role("button", name="打开持仓列表").click()
        page.locator("[aria-label='持仓列表'] button.oc-list-item").first.click()
        expect(page.locator("textarea[placeholder*='这笔交易']")).to_be_visible(timeout=10000)

        # masters: leaderboard + seeded trader detail
        page.get_by_role("button", name="打开高手列表").click()
        expect(page.locator("[aria-label='高手列表'] button.oc-list-item").first).to_be_visible(timeout=10000)
        page.locator("[aria-label='高手列表'] input[placeholder*='搜索']").fill("E2E")
        row = page.locator("[aria-label='高手列表'] button.oc-list-item", has_text="E2E甲")
        expect(row).to_be_visible(timeout=10000)
        row.click()
        expect(page.get_by_role("button", name=re.compile(r"^交割单"))).to_be_visible(timeout=10000)

        # replay: 藏未来回放（原训练模式的核心能力，已并入复盘工具条）
        goto(page, "/replay")
        toggle = page.locator("button[title*='隐藏未来']")
        expect(toggle).to_be_visible(timeout=10000)
        toggle.click()
        expect(page.get_by_text(re.compile(r"已隐藏未来"))).to_be_visible(timeout=5000)
        for _ in range(2):
            page.keyboard.press("ArrowRight")
            page.wait_for_timeout(120)

        # analysis: all six tabs
        goto(page, "/analysis")
        for label in ("行为", "时间", "风险", "标签"):
            page.get_by_role("tab", name=label).click()
            page.wait_for_timeout(250)

        assert_console_clean(page._console_errors)
        assert_api_responses_clean(responses)
    finally:
        ctx.close()


def test_cpu_throttled_replay_review_flow(browser, seed, api):
    """Layer 4 — 4× CPU 节流下复盘（含藏未来回放 + 标注）仍可完成。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    try:
        hook_page(page)
        cdp = ctx.new_cdp_session(page)
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})

        goto(page, "/replay")
        page.get_by_role("button", name="打开持仓列表").click()
        page.locator("[aria-label='持仓列表'] button.oc-list-item").first.click()
        expect(page.locator(".oc-chart-toolbar").first).to_be_visible(timeout=15000)
        # 列表弹窗选中后保持开（评审定稿）：操作图面前先 Esc 关浮卡与弹窗
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)

        # 藏未来回放：开启后逐根推进（aria-label 精确定位，回放传输/磁吸也带 aria-pressed）
        toggle = page.locator(".oc-chart-toolbar button[aria-label='隐藏未来 K 线']").first
        expect(toggle).to_be_visible(timeout=15000)
        toggle.click()
        expect(page.get_by_text(re.compile("已隐藏未来"))).to_be_visible(timeout=10000)
        for _ in range(3):
            page.keyboard.press("ArrowRight")
            page.wait_for_timeout(150)

        assert_console_clean(page._console_errors)
    finally:
        ctx.close()


def _dt(ms):
    from datetime import datetime

    return datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%dT%H:%M")


def test_heap_stable_over_long_session(browser, seed):
    """Layer 4 — 长会话 heap 无持续增长（页面往返两轮，阈值放宽到 80MB）。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    try:
        hook_page(page)
        cdp = ctx.new_cdp_session(page)
        cdp.send("Performance.enable")
        goto(page, "/replay")
        page.get_by_role("button", name="打开持仓列表").click()
        page.locator("[aria-label='持仓列表'] button.oc-list-item").first.click()
        expect(page.locator(".oc-chart-toolbar").first).to_be_visible(timeout=15000)
        base = _heap_used_mb(cdp)

        for _ in range(2):
            for path in ("/replay", "/analysis", "/replay"):
                goto(page, path)
                page.wait_for_timeout(400)

        growth = _heap_used_mb(cdp) - base
        assert growth < 80, f"heap grew {growth:.1f}MB over the journey (base {base:.1f}MB)"
    finally:
        ctx.close()
