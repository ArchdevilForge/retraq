"""Layer 3 — visual baselines (goal layer 3).

Captures every page × theme (plus key interactive states) into
e2e/__screenshots__/. Baselines are human-reviewed once; afterwards any diff
must be attributable to a spec-allowed change. Re-capture intentionally on
every run — review diffs via git.
"""

import re
from pathlib import Path

import pytest
from playwright.sync_api import expect

from conftest import hook_page, new_context
from helpers import PAGES, goto

OUT = Path(__file__).resolve().parent / "__screenshots__"


def _shot(page, name):
    page.screenshot(path=str(OUT / f"{name}.png"), full_page=False)


@pytest.mark.visual
@pytest.mark.parametrize("theme", ("dark", "light"))
class TestVisualBaselines:
    def test_replay_default_and_selected(self, browser, seed, theme):
        ctx = new_context(browser, seed, theme=theme)
        page = ctx.new_page()
        try:
            hook_page(page)
            goto(page, "/replay")
            page.wait_for_timeout(700)
            _shot(page, f"replay-default-{theme}")

            # §2.4 弹层范式：列表在浮层里，选中后浮卡弹出
            page.get_by_role("button", name="打开持仓列表").click()
            page.locator("[aria-label='持仓列表'] button.oc-list-item").first.click()
            expect(page.locator(".oc-chart-toolbar").first).to_be_visible(timeout=10000)
            page.wait_for_timeout(700)
            _shot(page, f"replay-trade-selected-{theme}")

            page.get_by_role("button", name="打开高手列表").click()
            page.wait_for_timeout(700)
            _shot(page, f"replay-masters-{theme}")
        finally:
            ctx.close()

    def test_replay_hide_future(self, browser, seed, theme):
        """藏未来回放态（原训练模式能力，已并入复盘）截图基线。"""
        ctx = new_context(browser, seed, theme=theme)
        page = ctx.new_page()
        try:
            hook_page(page)
            goto(page, "/replay")
            page.wait_for_timeout(1200)
            toggle = page.locator("button[title*='隐藏未来']")
            expect(toggle).to_be_visible(timeout=10000)
            toggle.click()
            page.wait_for_timeout(900)
            _shot(page, f"replay-hide-future-{theme}")
        finally:
            ctx.close()

    def test_analysis_overview(self, browser, seed, theme):
        ctx = new_context(browser, seed, theme=theme)
        page = ctx.new_page()
        try:
            hook_page(page)
            goto(page, "/analysis")
            page.wait_for_timeout(800)
            _shot(page, f"analysis-overview-{theme}")
        finally:
            ctx.close()
