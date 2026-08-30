"""Layer 2 — replay workbench flows (docs/DESIGN.md §6, §7; docs/PRODUCT.md §三, §五.1).

Each test anchors to spec clauses; see CONSTRAINT-MATRIX.md.
"""

import re
import time
from datetime import datetime

from playwright.sync_api import expect

from conftest import new_context
from helpers import assert_console_clean, assert_zero_page_scroll, cursor_x, goto

DRAG_SURFACE = "div.relative.min-h-0.flex-1 > div.absolute.inset-0"

# Unique marker so assertions survive concurrent user data in the same tables.
MARK = "e2e-标注-9f3a"

DEBOUNCE_MS = 800  # AnnotationEditor autosave debounce
SETTLE_MS = DEBOUNCE_MS + 700


def _open_first_trade(page):
    # §2.4 弹层范式：持仓按钮唤起居中列表弹窗，点行后弹窗收起、详情浮卡弹出
    page.get_by_role("button", name="打开持仓列表").click()
    page.locator("[aria-label='持仓列表'] button.oc-list-item").first.click()
    expect(page.locator("textarea[placeholder*='这笔交易']")).to_be_visible(timeout=10000)
    # The editor loads the stored annotation asynchronously; typing before the
    # load resolves lets the fetch response overwrite the input (autosave then
    # persists the wrong value). data-loaded flips once the fetch settles.
    page.locator("div.panel-card[data-loaded='true']").first.wait_for(state="attached", timeout=10000)
    page.wait_for_timeout(1200)  # let the debounced save from selection settle


def _annotation_of(api, subject_id):
    r = api.get(f"/api/annotations/trade/{subject_id}")
    return r.json() if r.ok else None


def test_annotation_autosave_and_reload_persistence(browser, seed, api):
    """§6 — 标注自动保存不打断复盘流；刷新后仍在（绑定持仓层）。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    try:
        from conftest import hook_page

        hook_page(page)
        goto(page, "/replay")
        _open_first_trade(page)

        note = page.locator("textarea[placeholder*='这笔交易']")
        note.fill(f"{MARK} 自动保存验证")
        page.wait_for_timeout(SETTLE_MS)

        # Find which seeded trade received the note (UI selection order is
        # an implementation detail; ownership by marker keeps it robust).
        hit = None
        for t in seed["trades"]:
            a = _annotation_of(api, t["id"])
            if a and a.get("note") == f"{MARK} 自动保存验证":
                hit = (t["id"], a)
        assert hit, "autosaved note not found on any seeded trade"

        # Reload → reselect → the note is still there (§6 persistence).
        page.reload()
        _open_first_trade(page)
        expect(page.locator("textarea[placeholder*='这笔交易']")).to_have_value(
            f"{MARK} 自动保存验证", timeout=10000
        )
    finally:
        for t in seed["trades"]:
            api.put(
                f"/api/annotations/trade/{t['id']}",
                data={"note": "", "setup_tags": [], "error_tags": [], "grade": None,
                      "emotion": None, "planned_stop": None, "planned_target": None},
            )
        ctx.close()


def test_grade_and_error_tag_persist(browser, seed, api):
    """§6/PRODUCT §三 三层记录模型 — 上下文层（评分/错误分类）随持仓落库。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    try:
        from conftest import hook_page

        hook_page(page)
        goto(page, "/replay")
        _open_first_trade(page)

        editor = page.locator("div.panel-card", has=page.get_by_text("复盘标注", exact=True))
        editor.get_by_role("button", name="B", exact=True).click()
        page.wait_for_timeout(SETTLE_MS)

        graded = None
        for t in seed["trades"]:
            a = _annotation_of(api, t["id"])
            if a and a.get("grade") == "B":
                graded = t["id"]
        assert graded, "grade B not autosaved on any seeded trade"
    finally:
        for t in seed["trades"]:
            api.put(
                f"/api/annotations/trade/{t['id']}",
                data={"note": "", "setup_tags": [], "error_tags": [], "grade": None,
                      "emotion": None, "planned_stop": None, "planned_target": None},
            )
        ctx.close()


def test_error_tag_triggers_contextual_hint_once(browser, seed, api):
    """§7 — 标记错误标签弹出对应心法卡；可关闭；同一持仓只自动弹一次。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    try:
        from conftest import hook_page

        hook_page(page)
        goto(page, "/replay")
        _open_first_trade(page)

        # 错误分类 section keeps its chips apart from the Setup section
        # (both preset lists contain 追高).
        err_section = page.locator(
            "div.space-y-1\\.5", has=page.locator("div", has_text=re.compile("^错误分类$"))
        ).last
        err_section.get_by_role("button", name="追高").click()
        hint = page.locator(".oc-hint-card", has_text="追高")
        expect(hint.first).to_be_visible()

        hint.first.get_by_role("button", name="关闭提示").click()
        expect(hint.first).not_to_be_visible()

        # Same subject + tag again must NOT re-show (sessionStorage guard).
        err_section.get_by_role("button", name="追高").click()  # toggle off
        err_section.get_by_role("button", name="追高").click()  # toggle on
        page.wait_for_timeout(400)
        assert page.locator(".oc-hint-card", has_text="追高").count() == 0, \
            "hint re-appeared for the same subject/tag (§7: 只自动弹出一次)"
    finally:
        for t in seed["trades"]:
            api.put(
                f"/api/annotations/trade/{t['id']}",
                data={"note": "", "setup_tags": [], "error_tags": [], "grade": None,
                      "emotion": None, "planned_stop": None, "planned_target": None},
            )
        ctx.close()


def test_hline_drawing_persists_across_reload(browser, seed, api):
    """§6 — 画线绑定 symbol+时间区域：落库后刷新仍在，回看同一区域可见。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    before: set = set()
    try:
        from conftest import hook_page

        hook_page(page)
        before = {d["id"] for d in api.get("/api/drawings", params={"symbol": "ETH-USDT"}).json()["data"]}

        goto(page, "/replay")
        _open_first_trade(page)

        tool = page.locator("button[title='水平线']")
        expect(tool).to_be_visible()
        tool.click()

        surface = page.locator("div.relative.min-h-0.flex-1 > div.absolute.inset-0").first
        box = surface.bounding_box()
        # Float panels overlay the chart edges; click in the free middle band.
        page.mouse.click(box["x"] + box["width"] * 0.42, box["y"] + box["height"] * 0.38)
        page.wait_for_timeout(SETTLE_MS)

        after = api.get("/api/drawings", params={"symbol": "ETH-USDT"}).json()["data"]
        created = [d for d in after if d["id"] not in before]
        assert created and created[0]["kind"] == "hline", f"hline not persisted: {after}"
        drawing_id = created[0]["id"]

        # Reload → same region → drawing is re-fetched and rendered (§6).
        page.reload()
        _open_first_trade(page)
        reloaded = api.get("/api/drawings", params={"symbol": "ETH-USDT"}).json()["data"]
        assert any(d["id"] == drawing_id and d["kind"] == "hline" for d in reloaded), \
            "hline lost after reload"
    finally:
        for d in api.get("/api/drawings", params={"symbol": "ETH-USDT"}).json()["data"]:
            if d["id"] not in before:
                api.delete(f"/api/drawings/{d['id']}")
        ctx.close()


def test_trade_selection_anchors_chart(browser, seed):
    """PRODUCT §三 复盘模式 — 点持仓自动定位到其时间段（交易锚定）；§2.2 顶部工具条。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    try:
        from conftest import hook_page

        hook_page(page)
        goto(page, "/replay")
        assert_zero_page_scroll(page)
        _open_first_trade(page)

        # §9 — 日期时间统一 2026-08-27 20:30（Asia/Shanghai）
        # §9 日期断言在列表弹窗里取行（先开弹窗再读，读完关闭）
        page.get_by_role("button", name="打开持仓列表").click()
        first_row = page.locator("[aria-label='持仓列表'] button.oc-list-item").first.inner_text()
        page.keyboard.press("Escape")
        assert re.search(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}", first_row), f"date format off-spec: {first_row!r}"

        # Unified engine toolbar shows the anchored symbol (single engine, §三).
        toolbar_symbol = page.locator(".oc-chart-toolbar .font-mono").first
        expect(toolbar_symbol).to_have_text(re.compile("ETH-USDT"), timeout=10000)
        # §2.2 — 时间周期切换齐全（CSS uppercase 渲染，DOM 为小写）
        for tf in ("5m", "15m", "1h", "4h", "1d"):
            expect(page.locator(".oc-chart-toolbar").get_by_text(tf, exact=True)).to_be_visible()
        assert_console_clean(page._console_errors)
    finally:
        ctx.close()


def test_popover_open_close_and_detail_card(browser, seed):
    """§2.4 — 列表浮层：按钮唤起、点外部关闭；详情浮卡 × 关闭。"""
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    try:
        from conftest import hook_page

        hook_page(page)
        goto(page, "/replay")

        # 默认全关，图占满视口（背板常驻 DOM，hidden 类切换）
        expect(page.locator("[aria-label='持仓列表']")).to_be_hidden()

        # 打开 → 居中弹窗（TV symbol search 式，宽 760px；背板常驻、hidden 类切换）
        page.get_by_role("button", name="打开持仓列表").click()
        modal = page.locator("[aria-label='持仓列表']")
        expect(modal).to_be_visible()
        row = modal.locator("button.oc-list-item").first
        expect(row).to_be_visible()
        # §4.2 数字排版：列表行内金额使用 tabular-nums
        assert "tabular-nums" in (row.get_attribute("class") or "") or \
            row.locator(".tabular-nums").count() > 0, "trade row amount lacks tabular-nums"

        # 点击遮罩（弹窗外部）→ 关闭（hidden 类切换，元素常驻 DOM）
        page.mouse.click(200, 850)
        expect(page.locator("[aria-label='持仓列表']")).to_be_hidden()

        # 选中行 → 弹窗关闭、右侧详情浮卡弹出
        page.get_by_role("button", name="打开持仓列表").click()
        page.locator("[aria-label='持仓列表'] button.oc-list-item").first.click()
        expect(page.locator("[aria-label='持仓列表']")).to_be_hidden()
        card = page.locator(".oc-float-panel--right")
        expect(card).to_be_visible()
        expect(card.get_by_text("仓位详情")).to_be_visible()

        # × 关闭浮卡
        card.get_by_role("button", name="隐藏仓位详情").click()
        expect(page.locator(".oc-float-panel--right")).to_have_count(0)

        # Esc 关闭浮卡（重新选中后按 Esc）
        page.get_by_role("button", name="打开持仓列表").click()
        page.locator("[aria-label='持仓列表'] button.oc-list-item").first.click()
        expect(page.locator(".oc-float-panel--right")).to_be_visible()
        page.keyboard.press("Escape")
        expect(page.locator(".oc-float-panel--right")).to_have_count(0)
        assert_console_clean(page._console_errors)
    finally:
        ctx.close()


def test_daily_review_entry_on_replay(browser, seed, api):
    """§6/§三 — 复盘页常驻「今日复盘」入口：一句话结论写全局时间线。"""
    from conftest import hook_page

    today_key = datetime.now().strftime("%Y-%m-%d")
    backup = None
    for r in api.get("/api/reviews", params={"cadence": "daily"}).json()["data"]:
        if r["period_key"] == today_key:
            backup = r["content"]
    ctx = new_context(browser, seed)
    page = ctx.new_page()
    try:
        hook_page(page)
        goto(page, "/replay")
        entry = page.get_by_role("button", name="打开今日复盘")
        expect(entry).to_be_visible(timeout=15000)  # 常驻：无需选中任何持仓
        entry.click()
        ta = page.locator("textarea[placeholder*='一句话结论']")
        expect(ta).to_be_visible()
        ta.fill("e2e-今日-5c1b 守住计划")
        page.locator("button:has-text('保存今日结论')").click()
        expect(page.locator(".oc-toast", has_text="已保存今日结论")).to_be_visible(timeout=10000)

        rows = api.get("/api/reviews", params={"cadence": "daily"}).json()["data"]
        assert any(r["period_key"] == today_key and "e2e-今日-5c1b" in r["content"] for r in rows), \
            "daily conclusion not on global timeline"

        # 与分析页复盘 tab 同一份数据
        page.goto("http://localhost:5173/analysis?tab=review")
        expect(page.locator("textarea[placeholder*='一句话结论']").first).to_have_value(
            re.compile("e2e-今日-5c1b"), timeout=10000
        )
    finally:
        if backup is not None:
            api.put("/api/reviews", data={"cadence": "daily", "period_key": today_key, "content": backup})
        else:
            import sqlite3

            from conftest import DB_PATH

            con = sqlite3.connect(DB_PATH, timeout=15)
            con.execute("PRAGMA busy_timeout=15000")
            con.execute("DELETE FROM review_notes WHERE cadence='daily' AND period_key=?", (today_key,))
            con.commit()
            con.close()
        ctx.close()


def test_replay_free_time_cursor(browser, seed):
    """§2.3 — 复盘模式 bar 级自由游标：常驻可见（hover 手型）且可横向拖动。"""
    from conftest import hook_page

    ctx = new_context(browser, seed)
    page = ctx.new_page()
    try:
        hook_page(page)
        goto(page, "/replay")
        _open_first_trade(page)
        expect(page.locator(".oc-chart-toolbar").first).to_be_visible(timeout=10000)
        page.wait_for_timeout(600)
        # 游标默认停在可见区最后一根 bar；详情面板浮层盖住右缘，先收起再拖
        collapse = page.locator("button[aria-label='隐藏仓位详情']")
        if collapse.is_visible():
            collapse.click()
            page.wait_for_timeout(400)

        x0 = cursor_x(page, DRAG_SURFACE)
        # K 线绘制晚于工具条出现（全套压力/上游拉数时可达数秒）：轮询等待游标绘制完成
        for _ in range(40):
            if x0 is not None:
                break
            page.wait_for_timeout(300)
            x0 = cursor_x(page, DRAG_SURFACE)
        diag = page.evaluate(
            "() => ({c: document.querySelectorAll('canvas').length,"
            " alert: [...document.querySelectorAll('[role=alert]')].map((e) => e.textContent.slice(0, 60)),"
            " tb: document.querySelector('.oc-chart-toolbar')?.textContent?.slice(0, 100)})"
        )
        assert x0 is not None, f"time cursor not rendered (no ew-resize hover band); diag={diag}"
        box = page.locator(DRAG_SURFACE).first.bounding_box()
        y = box["y"] + box["height"] * 0.4
        page.mouse.move(box["x"] + x0, y, steps=2)
        page.mouse.down()
        page.mouse.move(box["x"] + x0 - 60, y, steps=8)
        page.mouse.up()
        page.wait_for_timeout(400)

        x1 = cursor_x(page, DRAG_SURFACE)
        assert x1 is not None and x1 < x0 - 40, f"cursor did not move left after drag: {x0} -> {x1}"
        assert_console_clean(page._console_errors)
    finally:
        ctx.close()


def test_list_modal_focus_and_toolbar_toggle(browser, seed):
    """§8.4/§2.4 — 弹层打开即落焦搜索框（TV symbol search 习惯）；
    工具栏入口按钮浮在弹窗背板之上，随时可再点收起（不被遮罩劫持）。"""
    from conftest import hook_page

    ctx = new_context(browser, seed)
    page = ctx.new_page()
    try:
        hook_page(page)
        goto(page, "/replay")

        page.get_by_role("button", name="打开持仓列表").click()
        modal = page.locator("[aria-label='持仓列表']")
        expect(modal).to_be_visible()
        expect(modal.locator("input#trade-pair-search")).to_be_focused()

        # 工具栏按钮在背板之上：真实点击可达（z 序回归锚点），再点即收起
        page.get_by_role("button", name="打开持仓列表").click()
        expect(modal).to_be_hidden()

        # 高手弹窗同样落焦搜索框
        page.get_by_role("button", name="打开高手列表").click()
        mmodal = page.locator("[aria-label='高手列表']")
        expect(mmodal).to_be_visible()
        expect(mmodal.locator("input[placeholder*='搜索交易员']")).to_be_focused()
        page.get_by_role("button", name="打开高手列表").click()
        expect(mmodal).to_be_hidden()
        assert_console_clean(page._console_errors)
    finally:
        ctx.close()


def test_symbol_autopick_switches_with_dataset(browser, seed, api):
    """PRODUCT §三/§1 — 数据集切换后图表自动挑新数据集持仓最多的币种，
    不允许停留在「从工具条选择」的误导空态（auto-symbol 自愈回归锚点）。"""
    from conftest import hook_page

    BTC_CSV = (
        "交易对,方向,杠杆倍数,开仓均价,平仓均价,收益率,收益 (USDT),保证金（最大时）,买入时间,卖出时间\n"
        "BTC-USDT,做多,5,60000,63000,0.05,500,60000,2026-08-20 10:00:00,2026-08-20 18:00:00\n"
        "BTC-USDT,做空,3,62000,61000,0.016,200,62000,2026-08-22 09:00:00,2026-08-22 15:00:00\n"
    )
    stamp = time.strftime("%H%M%S")
    resp = api.post(
        "/api/trades/import",
        params={"template": "langge", "label": f"[E2E]切换种子 {stamp}"},
        multipart={"file": {"name": "switch.csv", "mimeType": "text/csv", "buffer": BTC_CSV.encode()}},
    )
    assert resp.ok, f"import failed: {resp.status()} {resp.text()}"
    ds2 = resp.json()["dataset_id"]

    ctx = new_context(browser, seed)
    page = ctx.new_page()
    try:
        hook_page(page)
        goto(page, "/replay")
        expect(page.locator(".oc-chart-toolbar .font-mono").first).to_have_text(
            re.compile("ETH-USDT"), timeout=15000
        )

        # 切换到 BTC 数据集 → 图表自动跟随（无空态、无卡死）
        page.locator("button[aria-haspopup='listbox']").click()
        dropdown = page.locator(".oc-dropdown")
        expect(dropdown).to_be_visible()
        dropdown.get_by_text(f"[E2E]切换种子 {stamp}").click()

        toolbar_symbol = page.locator(".oc-chart-toolbar .font-mono").first
        expect(toolbar_symbol).to_have_text(re.compile("BTC-USDT"), timeout=15000)
        assert page.locator("text=从工具条选择持仓或高手开始复盘").count() == 0, \
            "dataset switch left the misleading empty state on screen"
        assert_console_clean(page._console_errors)
    finally:
        api.delete(f"/api/datasets/{ds2}")
        ctx.close()
