"""Layer 2 — analysis flows (docs/PRODUCT.md §七, §三; docs/DESIGN.md §8).

The review test overwrites the user's real daily note for today; it backs the
row up first and restores (or deletes) it afterwards.
"""

import re

import pytest
import sqlite3
from datetime import datetime

from playwright.sync_api import expect

from conftest import DB_PATH, hook_page, new_context
from helpers import assert_console_clean, goto

MARK = "e2e-今日结论-7d2c"


def test_analysis_six_tabs_load_with_seed_data(browser, seed):
    """§七 — 报告集图表化：五个 tab 全部可加载，且总览吃当前 self 数据集。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    try:
        hook_page(page)
        goto(page, "/analysis")

        tabs = ["总览", "行为", "时间", "风险", "标签"]
        for label in tabs:
            tab = page.get_by_role("tab", name=label)
            expect(tab).to_be_visible()
            tab.click()
            panel = page.locator(f"#analysis-panel-{ {'总览':'overview','行为':'behavior','时间':'time','风险':'risk','标签':'tags'}[label] }")
            expect(panel).to_be_visible(timeout=10000)

        # Back on overview: seeded dataset has exactly 4 trades → 样本 = 4 笔;
        # §七 图表化拉满：权益曲线 + 横条图渲染（4 笔均平仓 → 曲线可绘）
        page.get_by_role("tab", name="总览").click()
        sample = page.locator(".oc-stat", has=page.locator(".oc-stat__label", has_text="样本"))
        expect(sample.locator(".oc-stat__value")).to_have_text(re.compile(r"4\s*笔"), timeout=10000)
        expect(page.get_by_text("权益曲线（累计盈亏）")).to_be_visible()
        expect(page.locator(".oc-card", has=page.get_by_text("权益曲线")).locator("canvas").first).to_be_visible()
        assert_console_clean(page._console_errors)
    finally:
        ctx.close()


TAB_IDS = {"总览": "overview", "行为": "behavior", "时间": "time",
           "风险": "risk", "标签": "tags"}


@pytest.mark.parametrize("w,h", [(1440, 900), (1280, 800), (1600, 1000)])
def test_analysis_tabs_fit_single_viewport(browser, seed, w, h):
    """D§2.1 / P§七 — 分析页单视口：五个 tab 全部不得产生滚动（信息落在一屏内）。

    历史偏差：总览 +143px、标签 +78px、复盘 +361px 的框架级滚动，
    行为/时间/风险底部 327/118/358px 留白，且 max-w-6xl 在 1440px 下白掉 272px。
    < lg 窄屏卡片纵向堆叠必然超一屏，此时只要求框架零滚动（tabpanel 内部可滚，D§2.1.2）。
    """
    ctx = new_context(browser, seed, viewport=(w, h))
    page = ctx.new_page()
    try:
        hook_page(page)
        goto(page, "/analysis")
        for label, tid in TAB_IDS.items():
            page.get_by_role("tab", name=label).click()
            expect(page.locator(f"#analysis-panel-{tid}")).to_be_visible(timeout=10000)
            page.wait_for_timeout(700)  # 等图表/异步面板落位
            m = page.evaluate(
                """() => {
                  const f = document.querySelector('.oc-page__frame');
                  const se = document.scrollingElement;
                  return {frameOverflow: f.scrollHeight - f.clientHeight,
                          pageScroll: se.scrollHeight > window.innerHeight + 1,
                          frameWidth: Math.round(f.getBoundingClientRect().width),
                          viewportWidth: window.innerWidth};
                }"""
            )
            assert m["frameOverflow"] <= 4, f"{label} 框架级滚动 {m['frameOverflow']}px @ {w}x{h}"
            assert not m["pageScroll"], f"{label} 出现页面级滚动 @ {w}x{h}"
            # 密度：内容框架应铺满可用宽度（不再被 max-w-6xl 截断留白）
            assert m["frameWidth"] >= m["viewportWidth"] - 40,                 f"{label} 内容未铺满：{m['frameWidth']} / {m['viewportWidth']} @ {w}x{h}"
        assert_console_clean(page._console_errors)
    finally:
        ctx.close()


def test_tag_analysis_sim_and_master_views(browser, seed):
    """§六/§七 — sim 对比开关与 master 视角切换：默认 self，开关带入请求参数。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    try:
        hook_page(page)
        reqs = []
        page.on("request", lambda r: reqs.append(r.url) if "/api/analysis/by-setup" in r.url else None)
        goto(page, "/analysis?tab=tags")

        sim_toggle = page.get_by_role("checkbox", name=re.compile("对比训练"))
        master_toggle = page.get_by_role("checkbox", name=re.compile("对比高手"))
        expect(sim_toggle).to_be_visible(timeout=10000)
        expect(master_toggle).to_be_visible()
        assert not sim_toggle.is_checked() and not master_toggle.is_checked(), \
            "对比开关必须默认关闭（分析默认只统计 self）"
        assert "include_master=True" not in reqs[0], reqs

        sim_toggle.check()
        page.wait_for_timeout(800)
        assert any("include_sim=True" in u or "include_sim=true" in u for u in reqs), \
            f"toggling sim compare did not refetch with include_sim: {reqs}"

        # master 视角：切主视图 → 自动并入 master 组并 refetch
        page.get_by_role("tab", name="高手").click()
        page.wait_for_timeout(800)
        assert any("include_master=True" in u or "include_master=true" in u for u in reqs), \
            f"master view did not refetch with include_master: {reqs}"
        # master 数据集当前无 trades（position 级数据）→ 诚实空态
        expect(page.get_by_text("还没有带 setup 标签的交易")).to_be_visible(timeout=10000)
        assert_console_clean(page._console_errors)
    finally:
        ctx.close()
