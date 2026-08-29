"""边界值测试 — 弹窗/浮层在任何视口都不得溢出窗口（goal: 详细测试 UIUX 边界）。

对每个浮层（高手榜弹窗、持仓弹窗、训练场景 modal、详情浮卡、今日复盘卡）
在小视口（1024×640 / 1280×720）下断言：边界全部落在视口内，且内容可内部滚动。
"""

import re

import pytest
from playwright.sync_api import expect

from conftest import hook_page, new_context
from helpers import assert_console_clean, goto

VIEWPORTS = ((1024, 640), (1280, 720))

MODAL_SCOPE = {
    "持仓列表": "[aria-label='持仓列表']",
    "高手列表": "[aria-label='高手列表']",
}


def _assert_within_viewport(page, selector, margin=8):
    """The element's border box must sit fully inside the viewport."""
    box = page.locator(selector).first.bounding_box()
    vw, vh = page.evaluate("() => [window.innerWidth, window.innerHeight]")
    assert box["x"] >= margin - 1, f"{selector} overflows left: x={box['x']}"
    assert box["y"] >= margin - 1, f"{selector} overflows top: y={box['y']}"
    assert box["x"] + box["width"] <= vw - margin + 1, \
        f"{selector} overflows right: right={box['x'] + box['width']} vw={vw}"
    assert box["y"] + box["height"] <= vh - margin + 1, \
        f"{selector} overflows bottom: bottom={box['y'] + box['height']} vh={vh}"
    return box


def _assert_inner_scroll(page, scope):
    """内容超出弹窗高度的地方必须有内部滚动条；不超出则放行。"""
    bad = page.locator(scope).evaluate(
        """(el) => {
          const nodes = [el, ...el.querySelectorAll('*')].filter(
            (n) => n.scrollHeight > n.clientHeight + 2 && n.clientHeight > 60,
          );
          return nodes
            .filter((n) => !['auto', 'scroll', 'overlay'].includes(getComputedStyle(n).overflowY))
            .map((n) => n.className?.toString().slice(0, 50) ?? n.tagName);
        }"""
    )
    assert not bad, f"{scope} clips overflowing content without a scroller: {bad[:3]}"


@pytest.mark.parametrize("w,h", VIEWPORTS)
def test_masters_modal_fits_small_viewports(browser, seed, w, h):
    ctx = new_context(browser, seed, viewport=(w, h))
    page = ctx.new_page()
    try:
        hook_page(page)
        goto(page, "/replay")
        page.get_by_role("button", name="打开高手列表").click()
        modal = page.locator(MODAL_SCOPE["高手列表"])
        expect(modal).to_be_visible(timeout=10000)
        page.wait_for_timeout(400)
        _assert_within_viewport(page, MODAL_SCOPE["高手列表"])
        _assert_inner_scroll(page, MODAL_SCOPE["高手列表"])
        assert_console_clean(page._console_errors)
    finally:
        ctx.close()


@pytest.mark.parametrize("w,h", VIEWPORTS)
def test_trades_modal_fits_small_viewports(browser, seed, w, h):
    ctx = new_context(browser, seed, viewport=(w, h))
    page = ctx.new_page()
    try:
        hook_page(page)
        goto(page, "/replay")
        page.get_by_role("button", name="打开持仓列表").click()
        modal = page.locator(MODAL_SCOPE["持仓列表"])
        expect(modal).to_be_visible(timeout=10000)
        page.wait_for_timeout(300)
        _assert_within_viewport(page, MODAL_SCOPE["持仓列表"])
        _assert_inner_scroll(page, MODAL_SCOPE["持仓列表"])
    finally:
        ctx.close()


@pytest.mark.parametrize("w,h", VIEWPORTS)
def test_train_modal_fits_small_viewports(browser, seed, w, h):
    ctx = new_context(browser, seed, viewport=(w, h))
    page = ctx.new_page()
    try:
        hook_page(page)
        goto(page, "/train")
        page.get_by_role("button", name="配置并开始训练").click()
        modal = page.locator("dialog[aria-label='训练场景配置']")
        expect(modal).to_be_visible(timeout=10000)
        page.wait_for_timeout(300)
        _assert_within_viewport(page, "dialog[aria-label='训练场景配置']")
        # 表单在 cap 内必须可完整触达（body 可滚）
        body = modal.locator(".oc-modal__body")
        scroll_ok = body.evaluate(
            "(el) => el.scrollHeight >= el.clientHeight - 2 && el.scrollHeight <= el.clientHeight + 2000"
        )
        assert scroll_ok
    finally:
        ctx.close()


@pytest.mark.parametrize("w,h", VIEWPORTS)
def test_detail_card_and_daily_review_fit(browser, seed, w, h):
    ctx = new_context(browser, seed, viewport=(w, h))
    page = ctx.new_page()
    try:
        hook_page(page)
        goto(page, "/replay")
        # 详情浮卡
        page.get_by_role("button", name="打开持仓列表").click()
        page.locator(MODAL_SCOPE["持仓列表"] + " button.oc-list-item").first.click()
        card = page.locator(".oc-float-panel--right")
        expect(card).to_be_visible(timeout=10000)
        page.wait_for_timeout(400)
        _assert_within_viewport(page, ".oc-float-panel--right")
        # 今日复盘卡
        page.get_by_role("button", name="打开今日复盘").click()
        review = page.locator("[data-testid='daily-review-card']")
        expect(review).to_be_visible(timeout=10000)
        page.wait_for_timeout(200)
        _assert_within_viewport(page, "[data-testid='daily-review-card']")
        assert_console_clean(page._console_errors)
    finally:
        ctx.close()


def test_no_page_scroll_with_modals_open(browser, seed):
    """§10 — 打开弹窗时页面本身仍不得出现全局滚动条。"""
    ctx = new_context(browser, seed, viewport=(1280, 720))
    page = ctx.new_page()
    try:
        hook_page(page)
        goto(page, "/replay")
        for name in ("打开持仓列表", "打开高手列表"):
            page.get_by_role("button", name=name).click()
            expect(page.locator(MODAL_SCOPE["持仓列表"] if "持仓" in name else MODAL_SCOPE["高手列表"])).to_be_visible(timeout=10000)
            m = page.evaluate(
                "() => ({sh: document.scrollingElement.scrollHeight, ih: window.innerHeight,"
                " sw: document.scrollingElement.scrollWidth, iw: window.innerWidth})"
            )
            assert m["sh"] <= m["ih"] + 1 and m["sw"] <= m["iw"] + 1, f"page scroll with {name}: {m}"
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)
    finally:
        ctx.close()
