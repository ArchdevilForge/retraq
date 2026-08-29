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

            page.locator("aside.oc-float-panel--left button.oc-list-item").first.click()
            expect(page.locator(".oc-chart-toolbar").first).to_be_visible(timeout=10000)
            page.wait_for_timeout(700)
            _shot(page, f"replay-trade-selected-{theme}")

            page.locator("aside.oc-float-panel--left button:has-text('高手')").click()
            page.wait_for_timeout(700)
            _shot(page, f"replay-masters-{theme}")
        finally:
            ctx.close()

    def test_train_setup(self, browser, seed, theme):
        ctx = new_context(browser, seed, theme=theme)
        page = ctx.new_page()
        try:
            hook_page(page)
            goto(page, "/train")
            page.wait_for_timeout(700)
            _shot(page, f"train-setup-{theme}")
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
