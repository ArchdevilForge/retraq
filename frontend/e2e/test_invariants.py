"""Layer 1 — layout invariants across pages × themes × viewports.

Grid: {/replay, /train, /analysis} × {dark, light} × {1440×900, 1280×800}.
Each assertion cites its clause; see CONSTRAINT-MATRIX.md.
"""

import pytest
from playwright.sync_api import expect

from conftest import hook_page, install_guard, new_context
from helpers import (
    assert_console_clean,
    assert_cursor_pointer,
    assert_no_viewport_overflow,
    assert_monospace,
    assert_nav_three_tabs,
    assert_no_alert_confirm,
    assert_no_emoji_icons,
    assert_tabular_nums,
    assert_theme,
    assert_theme_token,
    assert_zero_page_scroll,
    goto,
    navbar,
    PAGES,
    VIEWPORTS,
)

THEMES = ("dark", "light")

# DESIGN §3 token table. Light values match the implementation exactly; the
# dark palette diverges (see test_dark_theme_spec_token_values below), so the
# grid only asserts what the implementation satisfies: tokens resolve and the
# dark scheme is applied.
TOKENS = {
    "light": {"--background-base": "#fdfcfc", "--background-weak": "#f1eeee"},
}

# tabular-nums minimum per page: train shows no numbers until a run starts;
# replay keeps its numbers inside the closed-by-default list popover (§2.4),
# which the popover test asserts instead.
TABULAR_MIN = {"/replay": 0, "/analysis": 1, "/train": 0}


@pytest.mark.parametrize("w,h", VIEWPORTS)
@pytest.mark.parametrize("theme", THEMES)
@pytest.mark.parametrize("path", PAGES)
def test_layout_invariants(browser, seed, path, theme, w, h):
    ctx = new_context(browser, seed, viewport=(w, h), theme=theme)
    page = ctx.new_page()
    hook_page(page)
    try:
        goto(page, path)
        expect(navbar(page)).to_be_visible()
        page.wait_for_timeout(600)  # let async panels settle

        assert_nav_three_tabs(page)        # DESIGN §2.5
        assert_zero_page_scroll(page)      # DESIGN §2.1/§10
        assert_no_viewport_overflow(page)  # 响应式边界：无元素横向出窗
        assert_monospace(page)             # DESIGN §4.1
        assert_tabular_nums(page, TABULAR_MIN[path])  # DESIGN §4.2
        assert_cursor_pointer(page)        # DESIGN §8.4
        assert_no_emoji_icons(page)        # DESIGN §10
        assert_no_alert_confirm(page)      # DESIGN §5/§10
        assert_theme(page, theme)          # DESIGN §3
        if theme == "light":
            for var, want in TOKENS[theme].items():
                assert_theme_token(page, var, want)  # DESIGN §3 token table
        else:
            scheme = page.evaluate(
                "() => getComputedStyle(document.documentElement).colorScheme"
            )
            assert scheme == "dark", f"color-scheme should be dark, got {scheme}"
        assert_console_clean(page._console_errors)
    finally:
        ctx.close()


def test_dark_theme_spec_token_values(browser, seed):
    """DESIGN §3 — exact dark-mode token values from the spec table."""
    ctx = new_context(browser, seed, theme="dark")
    page = ctx.new_page()
    hook_page(page)
    try:
        goto(page, "/replay")
        assert_theme_token(page, "--background-base", "#141212")
        assert_theme_token(page, "--background-weak", "#201d1d")
        assert_theme_token(page, "--surface-raised-base-hover", "rgba(255, 255, 255, 0.05)")
    finally:
        ctx.close()


def test_dark_is_default(browser, seed):
    """DESIGN §3 — fresh session (no stored theme) must land on dark; the toggle
    switches immediately and the explicit choice persists across reloads."""
    ctx = new_context(browser, seed)  # no theme injected
    page = ctx.new_page()
    hook_page(page)
    try:
        goto(page, "/replay")
        assert_theme(page, "dark")
        page.locator("header.oc-navbar button[aria-label*='主题']").click()
        assert_theme(page, "light")
        page.reload()
        page.locator("header.oc-navbar").wait_for(state="visible")
        assert_theme(page, "light")  # explicit choice stored in localStorage
    finally:
        ctx.close()


def test_masters_route_redirects_to_replay(browser, seed):
    """P§五.1/§九 — 高手页不再独立存在：/masters 落到复盘工作台。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    hook_page(page)
    try:
        page.goto("http://localhost:5173/masters")
        page.locator("header.oc-navbar").wait_for(state="visible")
        assert_nav_three_tabs(page)
    finally:
        ctx.close()


def test_reduced_motion_respected(browser, seed):
    """DESIGN §8.5 — the stylesheet must carry a prefers-reduced-motion block."""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    try:
        goto(page, "/replay")
        has_block = page.evaluate(
            """() => [...document.styleSheets].some((sheet) => {
              try {
                return [...sheet.cssRules].some(
                  (r) => r.media && /prefers-reduced-motion/.test(r.media.mediaText),
                );
              } catch { return false; }
            })"""
        )
        assert has_block, "no prefers-reduced-motion media rule found (DESIGN §8.5)"
    finally:
        ctx.close()


def test_focus_visible_indicator(browser, seed):
    """DESIGN §8.4 — keyboard focus shows a visible indicator."""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    hook_page(page)
    try:
        goto(page, "/analysis")
        page.keyboard.press("Tab")
        info = page.evaluate(
            """() => {
              const el = document.activeElement;
              if (!el || el === document.body) return null;
              const cs = getComputedStyle(el);
              const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
              return {ok: outline || cs.boxShadow !== 'none', tag: el.tagName};
            }"""
        )
        assert info is not None, "Tab did not move focus"
        assert info["ok"], f"focused <{info['tag']}> has no visible focus indicator"
    finally:
        ctx.close()


def test_async_shows_spinner(browser, seed):
    """DESIGN §8.1 — loading K lines must surface a spinner, never a blank/dead state."""
    import time

    ctx = new_context(browser, seed)
    page = ctx.new_page()
    hook_page(page)
    try:
        # No trade selected → no chart → no fetch; open the list popover, pick a
        # row, then stall the klines request so the loading state is observable.
        page.route("**/api/klines/**", lambda route: (time.sleep(1.5), route.continue_()))
        goto(page, "/replay")
        page.get_by_role("button", name="打开持仓列表").click()
        page.locator("[aria-label='持仓列表'] button.oc-list-item").first.click()
        expect(page.locator(".oc-spinner").first).to_be_visible(timeout=5000)
        expect(page.locator(".oc-spinner").first).to_have_count(0, timeout=10000)
    finally:
        ctx.close()


def test_error_is_chinese_with_retry(browser, seed):
    """DESIGN §8.2 — API failure renders a Chinese message + 重试, and recovers."""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    hook_page(page)
    import re

    try:
        blocking = page.route("**/api/masters**", lambda route: route.fulfill(status=500, body='{"detail":"高手列表加载失败"}'))
        goto(page, "/replay")
        page.get_by_role("button", name="打开高手列表").click()
        err_zone = page.locator("[aria-label='高手列表']")
        expect(err_zone.get_by_text(re.compile("高手列表加载失败"))).to_be_visible()
        retry = err_zone.get_by_role("button", name=re.compile("重试"))
        expect(retry).to_be_visible()
        page.unroute("**/api/masters**")
        blocking = None
        retry.click()
        expect(err_zone.locator("button.oc-list-item").first).to_be_visible(timeout=10000)
    finally:
        ctx.close()
