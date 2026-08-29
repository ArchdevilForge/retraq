"""Layer 2 — analysis flows (docs/PRODUCT.md §七, §三; docs/DESIGN.md §8).

The review test overwrites the user's real daily note for today; it backs the
row up first and restores (or deletes) it afterwards.
"""

import re
import sqlite3
from datetime import datetime

from playwright.sync_api import expect

from conftest import DB_PATH, hook_page, new_context
from helpers import assert_console_clean, goto

TODAY_KEY = datetime.now().strftime("%Y-%m-%d")
MARK = "e2e-今日结论-7d2c"


def test_analysis_six_tabs_load_with_seed_data(browser, seed):
    """§七 — 报告集图表化：六个 tab 全部可加载，且总览吃当前 self 数据集。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    try:
        hook_page(page)
        goto(page, "/analysis")

        tabs = ["总览", "行为", "时间", "风险", "标签", "复盘"]
        for label in tabs:
            tab = page.get_by_role("tab", name=label)
            expect(tab).to_be_visible()
            tab.click()
            panel = page.locator(f"#analysis-panel-{ {'总览':'overview','行为':'behavior','时间':'time','风险':'risk','标签':'tags','复盘':'review'}[label] }")
            expect(panel).to_be_visible(timeout=10000)

        # Back on overview: seeded dataset has exactly 4 trades → 样本 = 4 笔.
        page.get_by_role("tab", name="总览").click()
        sample = page.locator(".oc-stat", has=page.locator(".oc-stat__label", has_text="样本"))
        expect(sample.locator(".oc-stat__value")).to_have_text(re.compile(r"4\s*笔"), timeout=10000)
        assert_console_clean(page._console_errors)
    finally:
        ctx.close()


def test_review_conclusion_on_global_timeline(browser, seed, api):
    """§三/§七 — 复盘结论写入全局时间线（独立于数据集），刷新后可回看。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    # Back up today's real daily note (if any) — the test upserts the same key.
    backup = None
    for r in api.get("/api/reviews", params={"cadence": "daily"}).json()["data"]:
        if r["period_key"] == TODAY_KEY:
            backup = r["content"]
    try:
        hook_page(page)
        goto(page, "/analysis?tab=review")

        # §三 复盘节奏 — 日/周/月三个节奏块各自带固定问题清单
        ta = page.locator("textarea[placeholder*='一句话结论']").first
        expect(ta).to_be_visible(timeout=10000)
        cards = page.locator(".oc-card", has=page.locator("textarea[placeholder*='一句话结论']"))
        expect(cards).to_have_count(3)
        ta.fill(f"{MARK} 今天守住计划，没有追高")
        page.locator("button:has-text('保存本期结论'), button:has-text('更新本期结论')").first.click()
        expect(page.locator(".oc-toast", has_text="已保存")).to_be_visible(timeout=10000)

        # Global timeline is dataset-independent: API rows carry the note…
        rows = api.get("/api/reviews").json()["data"]
        assert any(r["cadence"] == "daily" and r["period_key"] == TODAY_KEY and MARK in r["content"]
                   for r in rows), "review conclusion not on global timeline"

        # …and a reload replays it (回看).
        page.reload()
        ta = page.locator("textarea[placeholder*='一句话结论']").first
        expect(ta).to_have_value(f"{MARK} 今天守住计划，没有追高", timeout=10000)
        assert_console_clean(page._console_errors)
    finally:
        if backup is not None:
            api.put("/api/reviews", data={"cadence": "daily", "period_key": TODAY_KEY, "content": backup})
        else:
            con = sqlite3.connect(DB_PATH, timeout=15)
            con.execute("PRAGMA busy_timeout=15000")
            con.execute("DELETE FROM review_notes WHERE cadence='daily' AND period_key=?", (TODAY_KEY,))
            con.commit()
            con.close()
        ctx.close()


def test_tag_analysis_sim_compare_toggle(browser, seed):
    """§六/§七 — 「模拟 vs 实盘」对比开关存在，默认关闭，开启后带 include_sim 请求。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    try:
        hook_page(page)
        reqs = []
        page.on("request", lambda r: reqs.append(r.url) if "/api/analysis/by-setup" in r.url else None)
        goto(page, "/analysis?tab=tags")

        toggle = page.get_by_role("checkbox", name=re.compile("对比训练"))
        expect(toggle).to_be_visible(timeout=10000)
        assert not toggle.is_checked(), "sim compare must default to off (分析默认只统计 self)"
        assert "include_sim=False" in reqs[0] or "include_sim=false" in reqs[0] or "include_sim" not in reqs[0], reqs

        toggle.check()
        page.wait_for_timeout(800)
        assert any("include_sim=True" in u or "include_sim=true" in u for u in reqs), \
            f"toggling sim compare did not refetch with include_sim: {reqs}"
        assert_console_clean(page._console_errors)
    finally:
        ctx.close()
