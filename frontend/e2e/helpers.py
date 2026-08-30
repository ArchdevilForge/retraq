"""Shared e2e assertion helpers.

Every public helper cites the spec clause it guards (docs/DESIGN.md §n /
docs/PRODUCT.md §n); the full clause→test mapping lives in
CONSTRAINT-MATRIX.md next to this file.

Run from repo root with backend :9527 and frontend :5173 up:
    /usr/bin/python -m pytest frontend/e2e -q
"""

import re

from playwright.sync_api import Page, expect

BASE_URL = "http://localhost:5173"
API_URL = "http://localhost:9527"

NAV_TABS = ("复盘", "训练", "分析")  # DESIGN §2.5 / PRODUCT §九
PAGES = ("/replay", "/train", "/analysis")
VIEWPORTS = ((1440, 900), (1280, 800), (768, 900), (554, 800), (390, 800))
FONT_STACK = "IBM Plex Mono"  # DESIGN §4.1

# DESIGN §10 bans emoji as UI icons. Arrows (U+2190-21FF) are typography and
# stay allowed; everything in the symbol/emoji blocks below is a violation.
_EMOJI_CLASS = (
    "\U0001F000-\U0001FAFF"  # emoji + symbols
    "\U00002600-\U000027BF"  # misc symbols + dingbats
    "\U00002B00-\U00002BFF"  # arrows/stars block (⬆ etc.)
    "\U0001F1E6-\U0001F1FF"  # regional indicators (flags)
)
EMOJI_RE = re.compile(f"[{_EMOJI_CLASS}]\uFE0F?")
CJK_RE = re.compile(r"[\u4e00-\u9fff]")

# Upstream exchange fetches surface as 5xx resource lines when a sandboxed
# backend cannot reach binance; the app shows retry UI (allowed by §8.2).
# Resource-load console lines carry no URL, so the status text is the filter.
CONSOLE_NOISE = (
    "favicon",
    "net::ERR_",
    "CORB",
    "502 (Bad Gateway)",
)


def _is_console_noise(text: str) -> bool:
    return any(n in text for n in CONSOLE_NOISE)


def assert_console_clean(errors: list) -> None:
    real = [e for e in errors if not _is_console_noise(e)]
    assert not real, f"console errors: {real[:6]}"


def assert_api_responses_clean(responses: list) -> None:
    """Goal layer 4 — no unmocked 4xx/5xx from the app's own API.

    /api/klines/ 502s are upstream exchange fetches failing without internet;
    the app surfaces them with Chinese retry UI (§8.2), so they are allowed.
    """
    bad = [
        r for r in responses
        if r["status"] >= 400 and not (r["status"] == 502 and "/api/klines/" in r["url"])
    ]
    assert not bad, f"unexpected HTTP errors: {bad[:6]}"

_JS_VISIBLE_TEXT_SCAN = """(sel) => {
  const re = %s;
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    if (el.getClientRects().length === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden') continue;
    const t = (el.textContent || '').trim();
    if (re.test(t)) out.push({tag: el.tagName, text: t.slice(0, 24)});
  }
  return out;
}"""

_JS_CURSOR_SCAN = """() => {
  const out = [];
  for (const el of document.querySelectorAll(
    'button, a, [role="tab"], [role="button"], select, input[type="checkbox"], label:has(input[type="checkbox"])'
  )) {
    if (el.getClientRects().length === 0) continue;
    if (el.disabled) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.pointerEvents === 'none') continue;
    if (cs.cursor !== 'pointer') {
      out.push({
        tag: el.tagName,
        text: (el.textContent || '').trim().slice(0, 24),
        cursor: cs.cursor,
      });
    }
  }
  return out;
}"""


def goto(page: Page, path: str) -> None:
    page.goto(f"{BASE_URL}{path}")
    expect(page.locator("header.oc-navbar")).to_be_visible()


def navbar(page: Page):
    return page.locator("header.oc-navbar")


def assert_no_viewport_overflow(page: Page) -> None:
    """响应式边界：任何可见元素都不得伸出视口（工具栏裁切即破版）。

    fixed 定位元素（toast/遮罩）有自己的视口约束，由 boundary 测试单独覆盖。
    """
    bad = page.evaluate(
        """() => {
          const vw = window.innerWidth;
          const out = [];
          for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && (r.right > vw + 1 || r.left < -1) && el.getClientRects().length) {
              if (getComputedStyle(el).position === 'fixed') continue;
              out.push(String(el.className).slice(0, 50));
            }
          }
          return out;
        }"""
    )
    assert not bad, f"elements overflow the viewport horizontally: {bad[:4]}"


def assert_zero_page_scroll(page: Page) -> None:
    """DESIGN §2.1/§10 — the window itself never scrolls; panels scroll internally."""
    m = page.evaluate(
        "() => ({sh: document.scrollingElement.scrollHeight, ih: window.innerHeight,"
        " sw: document.scrollingElement.scrollWidth, iw: window.innerWidth})"
    )
    assert m["sh"] <= m["ih"] + 1, f"vertical page scroll: {m}"
    assert m["sw"] <= m["iw"] + 1, f"horizontal page scroll: {m}"


def assert_monospace(page: Page) -> None:
    """DESIGN §4.1 — 100% IBM Plex Mono stack."""
    ff = page.evaluate("() => getComputedStyle(document.body).fontFamily")
    assert FONT_STACK in ff, f"body font stack lacks {FONT_STACK}: {ff}"


def assert_tabular_nums(page: Page, min_count: int = 1) -> None:
    """DESIGN §4.2 — numeric content uses tabular-nums.

    Catches both styles in use: the Tailwind `.tabular-nums` class and the
    `.oc-stat__value` component (which carries font-variant-numeric in CSS).
    """
    n = page.evaluate(
        """() => {
          let c = 0;
          for (const el of document.querySelectorAll('.tabular-nums, .oc-stat__value')) {
            if (el.getClientRects().length === 0) continue;
            if (getComputedStyle(el).fontVariantNumeric.includes('tabular-nums')) c += 1;
          }
          return c;
        }"""
    )
    assert n >= min_count, f"expected >={min_count} tabular-nums elements, got {n}"


def assert_nav_three_tabs(page: Page) -> None:
    """DESIGN §2.5 / PRODUCT §九 — exactly 复盘/训练/分析."""
    nb = navbar(page)
    for t in NAV_TABS:
        expect(nb.get_by_text(t, exact=True)).to_be_visible()
    tabs = nb.locator(".oc-tab")
    assert tabs.count() == 3, f"nav must have exactly 3 tabs, got {tabs.count()}"


def assert_theme(page: Page, expected: str) -> None:
    """DESIGN §3 — theme driven by html[data-theme]."""
    actual = page.locator("html").get_attribute("data-theme")
    assert actual == expected, f"expected data-theme={expected!r}, got {actual!r}"


def assert_theme_token(page: Page, var_name: str, expected: str) -> None:
    """DESIGN §3 token table — resolved CSS variable must match the spec value."""
    got = page.evaluate(
        "(v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()",
        var_name,
    ).lower()
    assert got == expected.lower(), f"{var_name}: expected {expected}, got {got}"


def assert_cursor_pointer(page: Page) -> None:
    """DESIGN §8.4 — every enabled interactive element has cursor:pointer."""
    bad = page.evaluate(_JS_CURSOR_SCAN)
    assert not bad, f"interactive elements missing cursor:pointer: {bad[:6]}"


def assert_no_emoji_icons(page: Page) -> None:
    """DESIGN §10 — no emoji in interactive elements / headings / tables."""
    js = _JS_VISIBLE_TEXT_SCAN % f"/[{_EMOJI_CLASS}]/u"
    hits = page.evaluate(js, "button, a, th, td, h1, h2, h3, h4, label, [role='tab']")
    assert not hits, f"emoji used as UI text/icon: {hits[:6]}"


def assert_no_alert_confirm(page: Page) -> None:
    """DESIGN §5/§10 — window.alert/confirm forbidden (hooked in conftest)."""
    dialogs = getattr(page, "_retraq_dialogs", [])
    assert not dialogs, f"native alert/confirm used: {dialogs}"


def draggable_line_ys(page: Page, surface: str) -> list:
    """Scan the chart surface for ns-resize hover bands (draggable price lines).

    Returns y offsets (px from surface top) of each hit zone, top to bottom.
    Used by the §六 drag-line test: the hover hit-test reads
    series.priceToCoordinate(line.price), so a moved band proves the
    position's SL/TP changed in state.
    """
    box = page.locator(surface).first.bounding_box()
    cx = box["x"] + box["width"] * 0.5
    ys = []
    step = 4
    y = box["height"] * 0.08
    while y < box["height"] * 0.95:
        page.mouse.move(cx, box["y"] + y, steps=1)
        # give the page a tick to process the pointermove before we read the
        # hover cursor, otherwise the scan races the event loop under load
        page.wait_for_timeout(10)
        cur = page.eval_on_selector(surface, "el => el.style.cursor")
        if cur == "ns-resize" and (not ys or y - ys[-1] > step):
            ys.append(y)
        y += step
    page.mouse.move(cx, box["y"] + 4, steps=1)
    page.wait_for_timeout(10)
    return ys


def drag_line_at(page: Page, surface: str, y_offset: float, dy_px: float) -> None:
    box = page.locator(surface).first.bounding_box()
    cx = box["x"] + box["width"] * 0.5
    y = box["y"] + y_offset
    page.mouse.move(cx, y, steps=2)
    page.mouse.down()
    page.mouse.move(cx, y + dy_px, steps=8)
    page.mouse.up()


def step_until(page: Page, predicate, max_steps: int = 20, timeout_ms: int = 30000) -> bool:
    """Press 前进一步 until predicate(page) holds; returns final state."""
    import time

    btn = page.locator("button:has-text('前进一步')")
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        if predicate(page):
            return True
        if btn.is_disabled():
            return predicate(page)
        btn.click()
        page.wait_for_timeout(120)
    return predicate(page)


def cursor_x(page: Page, surface: str) -> float | None:
    """Horizontal scan at 40% height for the time-cursor hover band (ew-resize).

    D§2.3: the replay cursor line must have persistent visual presence and be
    horizontally draggable; the hover affordance proves it is rendered.
    """
    box = page.locator(surface).first.bounding_box()
    y = box["y"] + box["height"] * 0.4
    hit = None
    x = box["width"] * 0.15
    while x < box["width"] * 0.92:
        page.mouse.move(box["x"] + x, y, steps=1)
        page.wait_for_timeout(8)
        cur = page.eval_on_selector(surface, "el => el.style.cursor")
        if cur == "ew-resize":
            return x
        x += 6
    return hit
