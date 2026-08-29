#!/usr/bin/env python3
"""Comprehensive Playwright UI/UX Consistency & Interaction Test Suite for Retraq (v2 canvas paradigm)."""

import re
import sys
import time

from playwright.sync_api import sync_playwright, expect

BASE_URL = "http://localhost:5173"

def run_tests():
    passed = 0
    failed = 0
    errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()

        console_errors = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: console_errors.append(str(err)))

        def test_step(name, func):
            nonlocal passed, failed
            print(f"👉 Testing: {name}...", end=" ", flush=True)
            try:
                func()
                print("✅ PASS")
                passed += 1
            except Exception as e:
                print(f"❌ FAIL: {e}")
                errors.append((name, str(e)))
                failed += 1

        # Test 1: Navigation and Page Loading (v2: 复盘/训练/分析 only)
        def t1():
            page.goto(f"{BASE_URL}/replay")
            page.wait_for_load_state("networkidle")
            expect(page).to_have_title("Retraq")
            expect(page.locator("header.oc-navbar")).to_be_visible()
            for tab_name in ["复盘", "训练", "分析"]:
                expect(page.locator("header.oc-navbar").get_by_text(tab_name, exact=True)).to_be_visible()
            # 高手/学习 merged away: /masters redirects to the replay workbench
            page.goto(f"{BASE_URL}/masters")
            page.wait_for_load_state("networkidle")
            expect(page.locator("header.oc-navbar").get_by_text("复盘", exact=True)).to_be_visible()

        test_step("1. 导航栏三 tab 与 /masters 重定向", t1)

        # Test 2: Viewport Zero Page-Scroll Constraint
        def t2():
            body_scroll_h = page.evaluate("() => document.body.scrollHeight")
            window_inner_h = page.evaluate("() => window.innerHeight")
            body_scroll_w = page.evaluate("() => document.body.scrollWidth")
            window_inner_w = page.evaluate("() => window.innerWidth")
            assert body_scroll_h <= window_inner_h + 1, f"Window has vertical overflow: scrollHeight={body_scroll_h} > innerHeight={window_inner_h}"
            assert body_scroll_w <= window_inner_w + 1, f"Window has horizontal overflow: scrollWidth={body_scroll_w} > innerWidth={window_inner_w}"

        test_step("2. 视口零全局滚动条约束 (Zero Page-Scroll)", t2)

        # Test 3: Typography & Monospace
        def t3():
            font_family = page.evaluate("() => getComputedStyle(document.body).fontFamily")
            assert "IBM Plex Mono" in font_family or "monospace" in font_family, f"Expected monospace font, got {font_family}"

        test_step("3. 全站 100% 等宽字体约束 (IBM Plex Mono)", t3)

        # Test 4: Dark is the default theme
        def t4():
            page.goto(f"{BASE_URL}/replay")
            page.wait_for_load_state("networkidle")
            theme = page.locator("html").get_attribute("data-theme")
            assert theme == "dark", f"Expected dark as default theme, got {theme!r}"

        test_step("4. 深色为默认主题 (Dark Default)", t4)

        # Test 5: 我的/高手 source switch inside the replay workbench
        def t5():
            masters_tab = page.locator("aside.oc-float-panel--left button:has-text('高手')")
            expect(masters_tab).to_be_visible()
            masters_tab.click()
            time.sleep(0.4)
            expect(page.locator("text=合约高手榜")).to_be_visible()
            trader_items = page.locator("aside.oc-float-panel--left button.oc-list-item")
            expect(trader_items.first).to_be_visible()
            svgs = page.locator("aside.oc-float-panel--left button.oc-list-item svg")
            assert svgs.count() > 0, "No SVG sparklines rendered"
            # back to mine
            mine_tab = page.locator("aside.oc-float-panel--left button:has-text('我的')")
            mine_tab.click()
            time.sleep(0.3)

        test_step("5. 复盘工作台 我的/高手 分区切换 (Source Switch)", t5)

        # Test 6: Floating panels & rail collapsing
        def t6():
            collapse_list_btn = page.locator("button[aria-label='收起列表']")
            if collapse_list_btn.is_visible():
                collapse_list_btn.click()
                time.sleep(0.3)
                rail_left = page.locator("button.oc-panel-rail--left")
                expect(rail_left).to_be_visible()
                rail_left.click()
                time.sleep(0.3)
                expect(page.locator("text=合约高手榜").or_(page.locator("text=交易列表")).first).to_be_visible()

            collapse_detail_btn = page.locator("button[aria-label='收起详情']")
            if collapse_detail_btn.is_visible():
                collapse_detail_btn.click()
                time.sleep(0.3)
                rail_right = page.locator("button.oc-panel-rail--right")
                expect(rail_right).to_be_visible()
                rail_right.click()
                time.sleep(0.3)

        test_step("6. 浮层面板导轨式收起与展开交互 (Panel Rail Collapse)", t6)

        # Test 7: Theme Switching & Dark/Light Persistence
        def t7():
            theme_btn = page.locator("header.oc-navbar button[aria-label*='主题']")
            expect(theme_btn).to_be_visible()
            theme_btn.click()
            time.sleep(0.2)
            theme_attr_1 = page.locator("html").get_attribute("data-theme")
            theme_btn.click()
            time.sleep(0.2)
            theme_attr_2 = page.locator("html").get_attribute("data-theme")
            assert theme_attr_1 != theme_attr_2, f"Theme did not toggle: {theme_attr_1} vs {theme_attr_2}"

        test_step("7. 深浅色双模式与主题切换 (Theme Toggle)", t7)

        # Test 8: Master delivery slips & chart linkage (master replay on the unified engine)
        def t8():
            page.locator("aside.oc-float-panel--left button:has-text('高手')").click()
            time.sleep(0.4)
            traders = page.locator("aside.oc-float-panel--left button.oc-list-item")
            if traders.count() > 1:
                traders.nth(1).click()
                time.sleep(0.5)
            pos_tab = page.locator("button:has-text('合约交割单')")
            expect(pos_tab).to_be_visible()
            pos_tab.click()
            pos_buttons = page.locator("aside.oc-float-panel--right button:has-text('做多'), aside.oc-float-panel--right button:has-text('做空')")
            if pos_buttons.count() > 0:
                pos_buttons.first.click()
                time.sleep(0.5)
                # Unified engine toolbar shows the position's symbol
                toolbar_symbol = page.locator(".oc-chart-toolbar .font-mono").first
                expect(toolbar_symbol).to_be_visible()

        test_step("8. 交割单与统一图表引擎联动聚焦 (Position Chart Linkage)", t8)

        # Test 9: Tab Switching in Detail Panel
        def t9():
            equity_tab = page.locator("button:has-text('净值走势')")
            equity_tab.click()
            time.sleep(0.3)
            wisdom_tab = page.locator("button:has-text('实战心法')")
            wisdom_tab.click()
            time.sleep(0.5)

        test_step("9. 战绩画像、净值曲线与实战心法选项卡切换", t9)

        # Test 10: Console Errors Verification
        def t10():
            # 5xx resource lines are upstream exchange fetches (klines) failing in a
            # sandboxed environment; the app surfaces them with retry UI. Everything
            # else is a real frontend console error.
            real_errors = [
                e for e in console_errors
                if "net::ERR_" not in e and "CORB" not in e and "favicon" not in e
                and not ("Failed to load resource" in e and "502" in e)
            ]
            assert len(real_errors) == 0, f"Found browser console errors: {real_errors}"

        test_step("10. 控制台 0 报错与异常拦截", t10)

        browser.close()

    print("\n" + "=" * 50)
    print(f"🎉 测试完成: {passed} 项通过, {failed} 项失败")
    print("=" * 50)

    if failed > 0:
        sys.exit(1)

if __name__ == "__main__":
    run_tests()
