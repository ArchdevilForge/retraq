"""Layer 2 — training flows (docs/PRODUCT.md §六; docs/DESIGN.md §2.3, §8.6).

Order prices are planned from the same kline data the run will replay
(deterministic: trading.db is static), so every fill/liquidation assertion is
exact rather than probabilistic.
"""

import re
from datetime import datetime

from playwright.sync_api import expect

from conftest import hook_page, new_context
from helpers import (
    assert_console_clean,
    drag_line_at,
    draggable_line_ys,
    goto,
    step_until,
)

RIGHT = "aside.oc-float-panel--right"
DRAG_SURFACE = "div.relative.min-h-0.flex-1 > div.absolute.inset-0"
CONTEXT_BARS = 50  # DEFAULT_CONTEXT_BARS: cursor starts at window bar 49


def _fetch_window(api, symbol, start_ms, end_ms):
    r = api.get(f"/api/klines/{symbol}/15m", params={"start": start_ms, "end": end_ms, "limit": 1000})
    assert r.ok, f"klines fetch failed: {r.status()} {r.text()}"
    return r.json()["data"]


def _dt_input(ms):
    return datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%dT%H:%M")


def _mark_price(page):
    stat = page.locator(".oc-stat", has=page.locator(".oc-stat__label", has_text="标记价"))
    return float(stat.locator(".oc-stat__value").inner_text())


def _realized(page):
    stat = page.locator(".oc-stat", has=page.locator(".oc-stat__label", has_text="已实现"))
    return float(stat.locator(".oc-stat__value").inner_text())


def _position_text(page):
    return page.locator(f"{RIGHT}").inner_text()


def _choose_flow_window(full, tail=130):
    """Pick a start index whose decision window supports the whole order flow:
    limit dip fill, stop-limit trigger+fill, and a triggering SL. Returns the
    start bar index of the 130-bar scenario (cursor sits at start+49)."""
    for i in range(0, max(1, len(full) - tail - 1)):
        cursor = i + CONTEXT_BARS
        m = full[cursor]["close"]
        end = i + tail
        if cursor + 60 >= end:
            break
        lk = next((k for k in range(1, 26)
                   if full[cursor + k]["low"] <= m * 0.998 or full[cursor + k]["open"] < m * 0.998), None)
        if lk is None:
            continue
        tk = next((k for k in range(1, 26) if full[cursor + k]["high"] >= m * 1.002), None)
        if tk is None:
            continue
        fk = next((k for k in range(tk + 1, min(tk + 16, end - cursor))
                   if full[cursor + k]["low"] <= m * 1.003 or full[cursor + k]["open"] < m * 1.003), None)
        if fk is None:
            continue
        c2 = cursor + lk
        sk = next((k for k in range(1, 16) if full[c2 + k]["low"] <= m * 0.997), None)
        if sk is None:
            continue
        return i
    return None


def _start_run(page, api, symbol, tail_bars=130, *, choose=False):
    """Start a manual run over a `tail_bars`-bar window; returns (bars, cursor_idx)."""
    r = api.get(f"/api/klines/{symbol}/15m", params={"limit": 1000})
    assert r.ok
    full = r.json()["data"]
    if choose:
        idx = _choose_flow_window(full, tail_bars)
        assert idx is not None, "no flow-suitable window in data"
    else:
        idx = len(full) - tail_bars
    goto(page, "/train")
    page.locator("label:has-text('交易对') input").fill(symbol)
    page.locator("label:has-text('开始') input").fill(_dt_input(full[idx]["timestamp"]))
    page.locator("label:has-text('结束') input").fill(_dt_input(full[-1]["timestamp"]))
    page.locator("button:has-text('开始训练'), button:has-text('开始')").last.click()
    expect(page.locator(".oc-stat", has=page.locator(".oc-stat__label", has_text="标记价"))).to_be_visible(
        timeout=20000
    )
    bars = _fetch_window(api, symbol, full[idx]["timestamp"], full[-1]["timestamp"])
    cursor = CONTEXT_BARS - 1
    assert abs(_mark_price(page) - bars[cursor]["close"]) < 1e-6, \
        f"cursor misaligned: UI mark {_mark_price(page)} vs bars[{cursor}] {bars[cursor]['close']}"
    return bars, cursor


def _open_market(page, direction="多"):
    page.locator(f"{RIGHT} button.oc-tab", has_text=direction).first.click()
    page.locator("button:has-text('开仓')").last.click()
    expect(page.locator(f"{RIGHT}").get_by_text(re.compile(r"^[多空] @ \d"))).to_be_visible(timeout=5000)


def _plan_limit_buy(bars, cursor, max_look=25):
    """Price below mark that a future bar's low (or open gap) is guaranteed to touch."""
    mark = bars[cursor]["close"]
    for frac in (0.998, 0.995, 0.99):
        lp = mark * frac
        for k in range(1, max_look + 1):
            b = bars[cursor + k]
            if b["low"] <= lp or b["open"] < lp:
                return lp, k
    return None, None


def _plan_stop_limit_buy(bars, cursor, max_look=24):
    """Trigger above mark hit by a future high, then a later bar filling the limit."""
    mark = bars[cursor]["close"]
    t = mark * 1.002
    l = mark * 1.003
    for trig_k in range(1, max_look + 1):
        if bars[cursor + trig_k]["high"] >= t:
            for fill_k in range(trig_k + 1, min(trig_k + max_look, len(bars) - cursor - 1) + 1):
                b = bars[cursor + fill_k]
                if b["low"] <= l or b["open"] < l:
                    return t, l, trig_k, fill_k
    return None


def _plan_triggering_sl(bars, cursor, max_look=16):
    """SL below mark that a future bar's low is guaranteed to hit."""
    mark = bars[cursor]["close"]
    for frac in (0.997, 0.995, 0.992, 0.988, 0.984):
        sl = mark * frac
        for k in range(1, max_look + 1):
            if bars[cursor + k]["low"] <= sl:
                return sl, k
    return None, None


def _set_stops_via_form(page, sl, tp):
    pos_area = page.locator(f"{RIGHT} div", has_text=re.compile(r"^[多空] @ \d"))
    inputs = page.locator(f"{RIGHT} input[placeholder='止损'], {RIGHT} input[placeholder='止盈']")
    inputs.nth(0).fill(str(sl))
    inputs.nth(1).fill(str(tp))
    page.locator("button:has-text('更新止损止盈')").click()
    expect(pos_area.first).to_be_visible()


def test_train_full_order_flow_save_and_analysis(browser, seed, api):
    """§六 — 市价/限价/止损限价、加仓、部分平仓、反向、SL 触发、图上拖线、落库 → 分析可见。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    sim_datasets_before = {
        d["id"] for d in api.get("/api/datasets").json()["data"] if d["owner"] == "sim"
    }

    def counter_n():
        t = page.locator("header span", has_text=re.compile(r"^\d+/\d+$")).first.inner_text()
        return int(t.split("/")[0]) - 1  # 0-based cursorIndex into run.bars

    try:
        hook_page(page)
        bars, _cursor = _start_run(page, api, "BTC-USDT", tail_bars=130, choose=True)

        # 1) 市价开仓 long（§六 订单：市价）
        _open_market(page, "多")

        # 2) 加仓 → 已用保证金增大（§六 加仓）
        margin_text = page.locator(f"{RIGHT}").inner_text()
        m0 = re.search(r"保证金 (\d+\.\d+) U", margin_text)
        page.locator("button:has-text('加仓')").click()
        margin_text = page.locator(f"{RIGHT}").inner_text()
        m1 = re.search(r"保证金 (\d+\.\d+) U", margin_text)
        assert m0 and m1 and float(m1.group(1)) > float(m0.group(1)), "加仓 did not increase margin"

        # 3) 推进几根 bar 后部分平仓 50% → 已实现变化（§六 部分平仓）
        for _ in range(3):
            page.locator("button:has-text('前进一步')").click()
            page.wait_for_timeout(120)
        r_before = _realized(page)
        page.locator(f"{RIGHT} button.oc-btn", has_text=re.compile(r"^50%$")).click()
        page.wait_for_timeout(300)
        assert _realized(page) != r_before, "partial close did not realize PnL"

        # 4) 反向开仓 → 方向翻转（§六 反向开仓）
        page.locator("button:has-text('反向开仓')").click()
        expect(page.locator(f"{RIGHT}").get_by_text(re.compile(r"空 @ \d"))).to_be_visible(timeout=5000)

        # 5) 全平 → 空仓
        page.locator(f"{RIGHT} button.oc-btn", has_text=re.compile(r"^全平$")).click()
        page.wait_for_timeout(300)
        assert page.locator(f"{RIGHT}").get_by_text(re.compile(r"^[多空] @ \d")).count() == 0

        # 6) 限价挂单 → 推进成交（§六 限价单 + 撮合）
        cursor = counter_n()
        lp, fill_k = _plan_limit_buy(bars, cursor)
        assert lp, "no limit fill found in planned window"
        page.locator(f"{RIGHT} button.oc-tab", has_text="限价").first.click()
        page.locator(f"{RIGHT} label:has-text('限价') input").fill(f"{lp:.2f}")
        page.locator("button:has-text('下挂单')").last.click()
        expect(page.locator(f"{RIGHT}").get_by_text(re.compile(r"挂单 · 限价"))).to_be_visible()
        assert step_until(page, lambda p: p.locator(f"{RIGHT}").get_by_text(re.compile(r"^[多空] @ \d")).count() > 0,
                          max_steps=fill_k + 3), "limit order never filled"
        cursor = counter_n()

        # 7) 表单设置会触发的 SL → 推进到止损平仓（§六 价格触发自动平仓）
        sl, sl_k = _plan_triggering_sl(bars, cursor)
        assert sl, "no triggering SL found in planned window"
        _set_stops_via_form(page, f"{sl:.2f}", f"{bars[cursor]['close'] * 1.05:.2f}")
        assert step_until(
            page,
            lambda p: p.locator(f"{RIGHT}").get_by_text(re.compile(r"^[多空] @ \d")).count() == 0,
            max_steps=sl_k + 3,
        ), "SL never triggered"

        # 8) 再次市价开仓 → 设置安全 SL/TP → 图上拖线下移 SL（§六 图上拖线 TP/SL 括号单）
        _open_market(page, "多")
        cursor = counter_n()
        mark_now = _mark_price(page)
        # Keep both lines inside the visible bar range so the chart scale
        # renders them (out-of-range price lines never produce a hit zone).
        vis = bars[max(0, cursor - 20):cursor + 1]
        hi = max(b["high"] for b in vis)
        lo = min(b["low"] for b in vis)
        safe_tp = mark_now + (hi - mark_now) * 0.5 if hi > mark_now else mark_now * 1.002
        safe_sl = mark_now - (mark_now - lo) * 0.5 if lo < mark_now else mark_now * 0.998
        _set_stops_via_form(page, f"{safe_sl:.2f}", f"{safe_tp:.2f}")
        page.wait_for_timeout(400)
        bands = draggable_line_ys(page, DRAG_SURFACE)
        assert len(bands) >= 2, f"expected SL+TP draggable lines, found {len(bands)}"
        sl_y = bands[1]  # topmost = TP, next = SL
        drag_line_at(page, DRAG_SURFACE, sl_y, dy_px=30)
        page.wait_for_timeout(300)
        bands_after = draggable_line_at_offset(page, DRAG_SURFACE)
        assert bands_after is not None and bands_after > sl_y + 15, \
            "SL price line did not move after drag (drag → setStops broken)"
        page.locator(f"{RIGHT} button.oc-btn", has_text=re.compile(r"^全平$")).click()
        page.wait_for_timeout(300)

        # 9) 揭晓 → 落库本局 → sim 数据集（§六 结果落库，超越 TradingView 不保存 session）
        page.locator("button:has-text('揭晓')").click()
        save_btn = page.locator("button:has-text('落库本局')")
        expect(save_btn).to_be_visible(timeout=5000)
        save_btn.click()
        expect(page.locator(".oc-toast", has_text="本局已落库")).to_be_visible(timeout=10000)

        sims_after = api.get("/api/datasets").json()["data"]
        new_sims = [d for d in sims_after if d["owner"] == "sim" and d["id"] not in sim_datasets_before]
        assert new_sims, "no sim dataset created by 落库本局"
        assert "[训练]" in new_sims[0]["name"]

        # 10) 分析页可见：数据源切换器「训练」分组出现新 sim 数据集（§六 → 分析页）
        goto(page, "/replay")
        page.locator("header.oc-navbar button[aria-haspopup='listbox']").click()
        dropdown = page.locator(".oc-dropdown")
        expect(dropdown.get_by_text("训练", exact=True)).to_be_visible()
        expect(dropdown.get_by_text(re.compile(r"\[训练\]"))).to_be_visible()
        assert_console_clean(page._console_errors)
    finally:
        for d in api.get("/api/datasets").json()["data"]:
            if d["owner"] == "sim" and d["id"] not in sim_datasets_before:
                api.delete(f"/api/datasets/{d['id']}")
        ctx.close()


def draggable_line_at_offset(page, surface):
    """Re-scan and return the SL band y (second draggable line from top)."""
    bands = draggable_line_ys(page, surface)
    return bands[1] if len(bands) >= 2 else None


def test_train_liquidation_settles_run(browser, seed, api):
    """§六 — cross-margin 强平结算：杠杆开仓遇逆向行情 → 爆仓收场。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    try:
        hook_page(page)
        symbol = "TRUMP-USDT"  # memecoin volatility guarantees a 5% adverse leg
        r = api.get(f"/api/klines/{symbol}/15m", params={"limit": 1000})
        assert r.ok
        full = r.json()["data"]
        cursor0 = 49  # same initial cursor the run will use
        # find a start such that after the 50-bar context the next 60 bars hold a >=6% move
        start_idx = None
        for i in range(len(full) - 130, 60, -1):
            mark = full[i + cursor0]["close"]
            fut = full[i + cursor0 + 1: i + cursor0 + 61]
            if not fut:
                continue
            dip = (mark - min(b["low"] for b in fut)) / mark
            rise = (max(b["high"] for b in fut) / mark) - 1
            if max(dip, rise) >= 0.06:
                start_idx = i
                direction = "多" if rise >= dip else "空"
                break
        assert start_idx, "no liquidation window found in data"
        bars = _fetch_window(api, symbol, full[start_idx]["timestamp"], full[-1]["timestamp"])

        goto(page, "/train")
        page.locator("label:has-text('交易对') input").fill(symbol)
        page.locator("label:has-text('开始') input").fill(_dt_input(full[start_idx]["timestamp"]))
        page.locator("label:has-text('结束') input").fill(_dt_input(full[-1]["timestamp"]))
        page.locator("button:has-text('开始训练'), button:has-text('开始')").last.click()
        expect(page.locator(".oc-stat", has=page.locator(".oc-stat__label", has_text="标记价"))).to_be_visible(
            timeout=20000
        )
        assert abs(_mark_price(page) - bars[cursor0]["close"]) < 1e-6

        # 全仓 + 20x 杠杆（§六 开局面板：资金/杠杆/保证金模式）
        page.locator(f"{RIGHT} button.oc-tab", has_text=re.compile(r"^100%$")).click()
        page.locator(f"{RIGHT} label:has-text('杠杆') input").fill("20")
        page.locator(f"{RIGHT} button.oc-tab", has_text=direction).first.click()
        page.locator("button:has-text('开仓')").last.click()
        expect(page.locator(f"{RIGHT}").get_by_text(re.compile(r"^[多空] @ \d"))).to_be_visible(timeout=5000)

        assert step_until(
            page,
            lambda p: p.get_by_text("本局以爆仓结束").count() > 0,
            max_steps=70,
            timeout_ms=60000,
        ), "run did not settle by liquidation"
        assert_console_clean(page._console_errors)
    finally:
        ctx.close()


def test_pending_limit_cancel(browser, seed, api):
    """§六 — 挂单可撤销；撤销后不成交。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    try:
        hook_page(page)
        bars, cursor = _start_run(page, api, "BTC-USDT", tail_bars=130, choose=True)
        lp, _k = _plan_limit_buy(bars, cursor)
        assert lp
        page.locator(f"{RIGHT} button.oc-tab", has_text="限价").first.click()
        page.locator(f"{RIGHT} label:has-text('限价') input").fill(f"{lp:.2f}")
        page.locator("button:has-text('下挂单')").last.click()
        expect(page.locator(f"{RIGHT}").get_by_text(re.compile(r"挂单 · 限价"))).to_be_visible()

        page.locator("button:has-text('撤销挂单')").click()
        expect(page.locator(f"{RIGHT}").get_by_text(re.compile(r"挂单 · 限价"))).not_to_be_visible()

        # advance a few bars: still flat, no position opened
        for _ in range(5):
            page.locator("button:has-text('前进一步')").click()
            page.wait_for_timeout(100)
        assert page.locator(f"{RIGHT}").get_by_text(re.compile(r"^[多空] @ \d")).count() == 0, \
            "cancelled order filled anyway"
        assert_console_clean(page._console_errors)
    finally:
        ctx.close()


def test_transport_controls(browser, seed, api):
    """§2.3 — 回放控制条：单步前进、自动播放、倍速（快捷键未实现，见 MATRIX 缺口）。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    try:
        hook_page(page)
        _start_run(page, api, "BTC-USDT", tail_bars=130)
        counter = page.locator("header").get_by_text(re.compile(r"^\d+/\d+$")).first

        def n():
            return int(counter.inner_text().split("/")[0])

        n0 = n()
        page.locator("button:has-text('前进一步')").click()
        page.wait_for_timeout(200)
        assert n() == n0 + 1, "step did not advance cursor"

        page.locator("header select[aria-label='播放速度']").select_option("4")
        page.locator("button:has-text('自动播放')").click()
        page.wait_for_timeout(1500)
        assert n() > n0 + 1, "playback did not advance cursor"
        page.locator("button:has-text('暂停')").click()
    finally:
        ctx.close()
