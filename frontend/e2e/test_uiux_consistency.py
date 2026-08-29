#!/usr/bin/env python3
"""Comprehensive Playwright UI/UX Consistency & Interaction Test Suite for Retraq."""

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

        # Test 1: Navigation and Page Loading
        def t1():
            page.goto(f"{BASE_URL}/masters")
            page.wait_for_load_state("networkidle")
            expect(page).to_have_title("Retraq")
            expect(page.locator("header.oc-navbar")).to_be_visible()
            # Verify all 5 nav links exist
            for tab_name in ["复盘", "训练", "分析", "高手", "学习"]:
                expect(page.locator("header.oc-navbar").get_by_text(tab_name, exact=True)).to_be_visible()

        test_step("1. 导航栏与主菜单渲染", t1)

        # Test 2: Viewport Zero Page-Scroll Constraint
        def t2():
            # Check window has no global vertical or horizontal scroll
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

        # Test 4: Master Leaderboard & Sparklines
        def t4():
            leaderboard_header = page.locator("text=合约高手榜")
            expect(leaderboard_header).to_be_visible()
            # Verify list items loaded
            trader_items = page.locator("button.oc-list-item")
            expect(trader_items.first).to_be_visible()
            count = trader_items.count()
            assert count > 0, "No traders rendered in leaderboard"
            # Verify sparkline svg exists
            svgs = page.locator("button.oc-list-item svg")
            assert svgs.count() > 0, "No SVG sparklines rendered"

        test_step("4. 合约高手榜单与净值微图 (Sparkline)", t4)

        # Test 5: Three-Column Workstation & Rail Collapsing
        def t5():
            # Left panel collapse
            collapse_list_btn = page.locator("button[aria-label='收起列表']")
            if collapse_list_btn.is_visible():
                collapse_list_btn.click()
                time.sleep(0.3)
                rail_left = page.locator("button.oc-panel-rail--left")
                expect(rail_left).to_be_visible()
                # Restore
                rail_left.click()
                time.sleep(0.3)
                expect(page.locator("text=合约高手榜")).to_be_visible()

            # Right panel collapse
            collapse_detail_btn = page.locator("button[aria-label='收起详情']")
            if collapse_detail_btn.is_visible():
                collapse_detail_btn.click()
                time.sleep(0.3)
                rail_right = page.locator("button.oc-panel-rail--right")
                expect(rail_right).to_be_visible()
                # Restore
                rail_right.click()
                time.sleep(0.3)
                expect(page.locator("text=币安合约实盘")).to_be_visible()

        test_step("5. 三栏工作台导轨式收起与展开交互 (Panel Rail Collapse)", t5)

        # Test 6: Theme Switching & Dark/Light Persistence
        def t6():
            theme_btn = page.locator("header.oc-navbar button[aria-label*='主题']")
            expect(theme_btn).to_be_visible()

            # Toggle theme
            theme_btn.click()
            time.sleep(0.2)
            theme_attr_1 = page.locator("html").get_attribute("data-theme")

            theme_btn.click()
            time.sleep(0.2)
            theme_attr_2 = page.locator("html").get_attribute("data-theme")

            assert theme_attr_1 != theme_attr_2, f"Theme did not toggle: {theme_attr_1} vs {theme_attr_2}"

        test_step("6. 深浅色双模式与主题切换 (Theme Toggle)", t6)

        # Test 7: Master Positions List & Chart Focus Interaction
        def t7():
            # Click on second trader if available
            traders = page.locator("button.oc-list-item")
            if traders.count() > 1:
                traders.nth(1).click()
                time.sleep(0.5)

            # Check positions tab
            pos_tab = page.locator("button:has-text('合约交割单')")
            expect(pos_tab).to_be_visible()
            pos_tab.click()

            # Verify positions table rendered
            pos_buttons = page.locator("button:has-text('做多'), button:has-text('做空')")
            if pos_buttons.count() > 0:
                pos_buttons.first.click()
                time.sleep(0.3)
                # Verify active symbol badge or kline
                expect(page.locator("text=USDT 永续合约")).to_be_visible()

        test_step("7. 合约交割单与 K 线联动聚焦 (Position Chart Linkage)", t7)

        # Test 8: Master Overlay Toggle
        def t8():
            overlay_btn = page.locator("button:has-text('高手操作流')")
            expect(overlay_btn).to_be_visible()
            overlay_btn.click()
            time.sleep(0.5)
            # Overlay should now be active
            import re
            expect(overlay_btn).to_have_class(re.compile(r"oc-btn--primary"))

        test_step("8. 高手多空操作流图层开关 (Master Overlay Flow)", t8)

        # Test 9: Tab Switching in Detail Panel
        def t9():
            # Switch to Equity tab
            equity_tab = page.locator("button:has-text('净值走势')")
            equity_tab.click()
            time.sleep(0.2)
            expect(page.locator("text=7日收益曲线走势")).to_be_visible()

            # Switch to Wisdom tab
            wisdom_tab = page.locator("button:has-text('实战心法')")
            wisdom_tab.click()
            time.sleep(0.5)
            expect(page.locator("text=比特皇")).to_be_visible()
            expect(page.locator("text=Tony")).to_be_visible()

        test_step("9. 战绩画像、净值曲线与实战心法选项卡切换", t9)

        # Test 10: Clone Master to Local Dataset with Toast Feedback
        def t10():
            clone_btn = page.locator("button:has-text('导入为我的复盘')")
            if clone_btn.is_enabled():
                clone_btn.click()
                time.sleep(0.8)
                # Verify toast appeared
                toast = page.locator("div.oc-toast--success")
                expect(toast).to_be_visible()
                expect(toast).to_contain_text("成功")

        test_step("10. 一键克隆为我的复盘与 Toast 即时反馈", t10)

        # Test 11: Console Errors Verification
        def t11():
            # Filter out non-critical network warnings
            real_errors = [e for e in console_errors if "net::ERR_" not in e and "CORB" not in e and "favicon" not in e]
            assert len(real_errors) == 0, f"Found browser console errors: {real_errors}"

        test_step("11. 控制台 0 报错与异常拦截", t11)

        browser.close()

    print("\n" + "=" * 50)
    print(f"🎉 测试完成: {passed} 项通过, {failed} 项失败")
    print("=" * 50)

    if failed > 0:
        sys.exit(1)

if __name__ == "__main__":
    run_tests()
