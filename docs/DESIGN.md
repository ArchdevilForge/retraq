# Retraq — UI/UX 约束与设计规范 (Design System & Interaction Constitution)

本文档是 Retraq 前端界面的**最高 UI/UX 约束规范**。所有新增页面、组件、交互与样式修改必须**100% 严格遵守**本规范，保持极致的一致性与专业性。

> v2 修订（2026-08-29）：经全功能 grill-me 拷问收敛。布局范式从"三栏工作台"改为"**图表全屏 + 浮层面板**"；深色成为默认主题；新增标注系统与回放控制规范。

---

## 1. 核心设计哲学 (Design Philosophy)

Retraq 定位为**专业、克制、沉浸的本地交易复盘与量化分析工具**（对齐 [opencode.ai](https://opencode.ai/) 工程美学，交互范式对标 TradingView）。

- **工具感与专业感**：专为长时间沉浸式复盘设计，界面信息密度高但排版呼吸感强，杜绝娱乐化、赌场化或花哨设计。
- **图表绝对主角 (Chart-First)**：K 线画布占据视口全部空间，是页面的背景层；一切功能面板以浮层形式叠加其上，**不得与图表平分版面**。
- **单视口工作台 (Single Viewport Workstation)**：整个应用窗口绝无外部全局滚动条，所有子面板内部独立纵向滚动。
- **全等宽硬核排版 (100% Monospace)**：全站统一使用 `IBM Plex Mono` 字体，表格与数值严格对齐。

---

## 2. 布局范式 (Layout Paradigm)

### 2.1 图表全屏画布（唯一范式）

复盘、分析共用同一套全屏画布结构：

- K 线图表铺满视口（`absolute inset-0` 或等效），作为页面背景层；
- 所有面板（列表、详情、工具条）以**浮层**叠加在图表上，浮层背景用 `--background-weak` + 2px 网格边框与图表建立层次分隔；
- 页面最外层容器固定为 `flex h-full min-h-0 flex-1 flex-col overflow-hidden p-2`；
- 所有可滚动区域必须显式声明 `min-h-0 flex-1 overflow-y-auto`，禁止高度撑爆父级视口。

#### 2.1.1 浮层不得遮挡行情（强制）

右侧浮层（`.oc-float-panel--right`，复盘详情卡）打开时，**图表画布必须让位**，而非被面板压住：

- 图表层右边界 = `var(--oc-float-panel-inset)`，由 `.oc-canvas:has(.oc-float-panel--right:not(.oc-float-panel--hidden))` 在面板打开时置为该面板足迹（`min(380px, 100vw-24px) + 16px`）；
- **价格轴与最新几根 K 线永不得被面板覆盖** —— 这是可用性红线，不是审美偏好；
- `≤767px` 时面板已占满可用宽度（`min(380px, 100vw-24px)`），让位无意义：此时图表保持满幅、由浮层整体覆盖（窄屏弹层范式）；
- 断言锚点：`frontend/e2e/test_train.py`（右面板左边界 ≥ 图表/价格轴右边界）。

#### 2.1.2 报表页单视口（分析）

分析页是**报表页**（非图表背景层），但同样遵守单视口铁律 —— **信息必须落在一屏内，禁止任何滚动**：

- 内容框架 `.oc-page__frame` 固定为 `min-h-0 flex-1 overflow-hidden`（**禁止 `overflow-y-auto`**），
  纵向不再滚动；
- **禁止 `max-w-*` 横向截断**：1440px 下 `max-w-6xl` 曾白掉 272px，密度反而低于铺满；
- 纵向靠**网格行吃满**（`grid-rows-[auto_minmax(0,1fr)]`），空白不得留在页面底部；
- 单个面板内容确实装不下时，**只有该面板内部**滚动（`min-h-0 flex-1 overflow-y-auto`），
  且必须是列表类内容（如交易对清单、结论时间线）；
- 并列关系的信息必须横向铺开（`grid-cols-3`），禁止纵向堆叠；
- 图表类组件必须支持**填满父容器**（`EquityCurve` 的 `fill` 属性），而非固定像素高；
- 断言锚点：`frontend/e2e/test_analysis.py::test_analysis_tabs_fit_single_viewport`
  （5 tab × 3 视口 ≥1280，断言框架零滚动 + 页面零滚动 + 内容铺满宽度）。

### 2.2 顶部工具条（浮层）

- 时间周期切换（5m / 15m / 1h / 4h / 1d）；
- 数据源切换器：我的数据集 ↔ 高手分区（"我的 / 高手"切换在复盘页左栏顶部）↔ sim 数据集；含币安同步入口；
- 模式标识：复盘视图 / 藏未来视图（二者共用一个引擎，仅可见性不同）。

### 2.3 回放控制条（Replay Transport）

对标 TradingView Bar Replay（v3.2 实现）：

- **控制四件套**（图表工具栏右侧控制组，紧跟藏未来开关）：
  `上一根 / 播放·暂停 / 下一根` + `单步步进`（1/5/15/30/60 根）+ `倍速`（1~20 根/秒，7 档）；
- **自动播放**：按倍速推进游标；**到达末根自动停止**（不留「播完了还在跑」的假状态）；
- **快捷键**：`←`/`→` 单步，`Shift+↓` 播放/暂停（输入框聚焦时不劫持）；
- **游标默认位**：选中持仓时 = 该笔**开仓 bar**（复盘的决策时刻）；未选中时 = 可见窗末根 bar。
  用户单步/拖动挪开后**不被拉回**（仅换标的/持仓/周期时重新锚定）；
- **详情卡「前往开仓时间」**：把游标复位到该笔开仓 bar（选中时已自动到达，此按钮用于手动挪开后找回）；
- **单步是唯一入口**：按钮、键盘、自动播放共用同一 `stepCursor`，避免多处 off-by-one；
- 游标线在图上有持续的视觉存在（细竖线 + 位置标签），不得隐形。

> 会话持久化（「回到上次游标位置」）**未实现**：跨刷新恢复游标需要把 cursor 与 symbol/timeframe
> 一起落 localStorage 并在数据到达后重放，收益低于上述四项；需要时再单独立项。

### 2.3.1 图上 OHLC 图例

工具条左组常驻（紧跟 symbol）：`开 高 低 收 涨跌 振幅`，等宽 + `tabular-nums`，
涨跌色跟随盈亏令牌（`--oc-profit` / `--oc-loss`）。

- **无光标**（默认）= 最新一根 bar；**有光标** = 跟随 crosshair；
- 实现上直接写 DOM 文本（`data-testid="ohlc-legend"`），**不走 React state** ——
  crosshair 移动是高频事件，setState 会整树重渲染并拖垮拖动帧率。

### 2.3.2 磁吸（Magnet）

画线工具的落点吸附开关（工具条图标按钮，`aria-pressed`）：

- 开启后落点吸附到光标所在 bar 的**最近 OHLC**，屏幕距离容忍 `MAGNET_TOLERANCE_PX = 8px`；
- 超出容忍范围不吸附（否则光标总被拽走，反而难画）；
- 预览线与最终落点使用同一吸附结果，不得出现「预览在这、落在那」；
- 纯函数在 `frontend/src/utils/chartMagnet.ts`（可单测），组件只做坐标换算注入。

### 2.4 弹层面板（TradingView 式按需调取）

图表之外**不允许任何常驻信息面板**——占屏权由"使用频率 × 当前任务相关度"决定，一切辅助信息通过工具条按钮唤起弹层：

- **入口按钮**（持仓 / 高手）：嵌在图表工具栏最右（TV 顶栏式），ghost 样式 + 图标，激活态高亮；
- **列表 = 居中弹窗**（TV symbol search 式）：点工具栏按钮弹出居中 modal（宽 ~760px、遮罩、高信息密度），点选行后关闭（选中反馈在图上）；点遮罩 / `Esc` / `关闭` 均可关闭；

- **详情浮卡**（持仓详情 / 高手画像+交割单）：右侧 384px 浮卡，选中即弹出、随选中存续，`×` 或 `Esc` 关闭，换选中即换内容；
- 弹窗/浮卡用 `--background-weak`/`--background-base` + 2px 网格边框（§2.1）；
- 默认全部关闭，图占满视口。`oc-panel-rail` 导轨按钮废除。

### 2.5 导航

顶栏仅两项：**复盘 / 分析**。训练页已删除（v3，见 docs/PRODUCT.md §六）；学习页取消（内容转为场景内上下文提示，见 §7）。

---

## 3. 色彩与语义规范 (Color Tokens & Semantics)

Retraq 实行**严格的主题双模式**（深色 Dark 为默认 / 浅色 Light 次选），由 `ThemeProvider` (`data-theme`) 驱动，禁止硬编码未适配主题的颜色。

| 语义角色 | 深色模式 (Dark，默认) | 浅色模式 (Light) | 变量 / 类名 | 规则说明 |
| :--- | :--- | :--- | :--- | :--- |
| **画布底色** | `#141212` | `#fdfcfc` (Warm Cream) | `--background-base` | 全站基底，温润不刺眼 |
| **面板底色 1** | `#201d1d` | `#f1eeee` | `--background-weak` | 浮层面板默认背景 |
| **面板底色 2** | `#282525` | `#e8e4e4` | `--surface-raised-base` | 激活项、悬浮态与输入框 |
| **主要文字** | `#fdfcfc` | `#201d1d` | `--text-strong` | 标题、核心数值、强调文本 |
| **次要文字** | `#b8b6b6` | `#646262` | `--text-base` | 正文、普通标签、表格内容 |
| **弱化文字** | `#9a9898` | `#9a9898` | `--text-weak` | 时间戳、单位、次级注释 |
| **最弱文字** | `#646262` | `#b8b6b6` | `--text-weaker` | 禁用态、极次级提示 |
| **边框线条** | `rgba(255, 255, 255, 0.1)` | `rgba(15, 0, 0, 0.12)` | `--border-weak-base` | 2px 网格边框或 1px 细线 |
| **强调主色** | `#fdfcfc` (亮白) | `#201d1d` (墨黑) | `--oc-accent` | 按钮、活跃状态标线 |
| **盈利 / 做多** | `#30D158` (Apple HIG) | `#248a3d` / `#30D158` | `oc-text-profit` | 语义盈亏绿，禁止使用刺眼荧光绿 |
| **亏损 / 做空** | `#FF3B30` (Apple HIG) | `#c41e12` / `#FF3B30` | `oc-text-loss` | 语义盈亏红 |

**语义底色配对**：`--surface-success-weak/base` 绿系、`--surface-critical-weak/base` 红系。
两者**必须色相一致**（历史偏差：深色 `--surface-critical-weak` 被误写为成功绿，导致做空/亏损行底色发绿；
已由 `designTokens.test.ts` 锁定）。

**对比度已知限制**（实测 WCAG 对比度，面板底 `#201d1d` / `#f1eeee`）：

| 令牌 | 深色 | 浅色 | 结论 |
| :--- | :--- | :--- | :--- |
| `--text-strong` | 16.3 | 14.5 | ✅ AAA |
| `--text-base` | 8.3 | 5.3 | ✅ AAA / AA |
| `--text-weak` | 5.8 | 2.5 | ⚠️ 浅色未达 4.5，仅可用于**非关键**时间戳/单位 |
| `--text-weaker` | 2.8 | 1.8 | ⚠️ 装饰性文字，**不得承载必要信息** |

故 `--text-weak` / `--text-weaker` 仅限时间戳、单位、次级注释等可缺失信息；
正文与数值一律用 `--text-base` 及以上。

---

## 4. 排版与字体系统 (Typography & Tabular Law)

1. **全站等宽字体**：
   - 必须使用 `var(--oc-font-mono)`（`IBM Plex Mono`, `ui-monospace`, `SF Mono`, `Menlo`）；
   - 禁止混用无衬线（Inter, Roboto 等）导致数字错位。
2. **数字对齐 (Tabular Nums)**：
   - 所有金额、价格、盈亏、收益率、数量、时间必须加上 `tabular-nums font-mono`，确保上下行数字基线与小数点对齐。
3. **字号阶梯**（唯一 7 档，对应 `--oc-text-*` / `text-oc-*`）：
   - 微观微标 / 角标：`10px`（`--oc-text-10`）
   - 微型标签 / 时间戳：`11px`（`--oc-text-11`）
   - 列表正文 / 次要数值 / 表格：`12px`（`--oc-text-12`）
   - 标准正文 / 表单 / 面板标题：`13px`（`--oc-text-13`）
   - 大正文 / 空态描述：`14px`（`--oc-text-14`）
   - 区块大标题 / 详情主标题：`16px`（`--oc-text-16`）
   - 核心 KPI 看板：`20px`（`--oc-text-20`）
   - 超大展示数值：`38px`（`--oc-text-display`）
4. **字号实现规则**：
   - 优先写 Tailwind 桥接工具类 `text-oc-9/10/11/12/13/14/16/20`；
   - **禁止 `text-[15px]`、`text-[18px]` 等阶梯外字号**。若确需新档，先在本节与 §11.2 登记并同步到 `index.css @theme`；
   - 阶梯外的 `text-xs / text-sm / text-base`（Tailwind 默认号）禁止使用 —— 与 IBM Plex Mono 设计阶梯不同源。

---

## 5. 组件规范与类名前缀 (`oc-*` Standards)

所有界面元素必须优先复用 `frontend/src/styles/opencode.css` 中的 `oc-*` 标准类名。

> 本表只列**已实现且在用**的类名（实证：CSS 定义 + TSX 消费）。新增组件先在此登记并实现后，
> 才能在其他地方引用；禁止在规范里预先声明尚未实现的类名（会产生“死规范”）。

| 组件类别 | 标准类名 | 使用场景与要求 |
| :--- | :--- | :--- |
| **导航栏** | `oc-navbar` `oc-navbar__start` `oc-navbar__nav` `oc-navbar__actions` `oc-brand-mark` `oc-brand-title` `oc-skip-link` | 顶部导航（复盘/分析） |
| **标签页/段选** | `oc-tabs` `oc-tabs--compact` `oc-tabs--fill` `oc-tab` `oc-tab--active` | 顶部导航与面板内段选控件共用 |
| **按钮** | `oc-btn` `oc-btn--primary` `oc-btn--secondary` `oc-btn--ghost` `oc-btn--ghost-selected` `oc-btn--sm` `oc-btn--md` `oc-btn--lg` | 统一样式，**禁止裸写未封装的 `<button>` 样式** |
| **图标按钮** | `oc-icon-btn` `oc-icon-btn--sm` `oc-icon-btn--md` `oc-icon-btn--secondary` | 仅图标控件，**必须**有 `aria-label` |
| **输入框** | `oc-input-wrap`（外框）`oc-input`（内部件）`oc-select`（原生下拉） | 边框/聚焦 outline 统一；`oc-select` 供裸 `<select>` 使用 |
| **列表项** | `oc-list-item` `oc-list-item--active` | 浮层条目；含 `content-visibility: auto` 长列表优化 |
| **行内横条** | `oc-bar-row` | 分析页可点击比例条行（下钻用） |
| **徽标/胶囊** | `oc-chip` `oc-chip--active` `oc-badge` | 段选胶囊、状态徽标 |
| **统计网格** | `oc-stat-grid` `oc-stat-grid--cols-2` `oc-stat-grid--cols-4` `oc-stat-grid--auto` `oc-stat` `oc-stat__label` `oc-stat__value` `oc-card` `oc-card--bordered` `oc-card__title` | KPI 数据看板卡片 |
| **面板/浮层** | `oc-panel` `oc-panel__header` `oc-panel__body` `oc-panel__title` `oc-float-panel` `oc-float-panel--left` `oc-float-panel--right` `oc-float-panel--hidden` `oc-canvas` `oc-canvas__chart` `oc-chart-shell` `oc-chart-toolbar` | §2.1/§2.4 图表全屏 + 浮层面板 |
| **弹窗** | `oc-modal` `oc-modal__header` `oc-modal__body` `oc-modal__footer` | `<dialog>` 居中弹窗 |
| **下拉** | `oc-dropdown` `oc-dropdown__item` `oc-dropdown__item--selected` | 数据源切换器等 |
| **表格** | `oc-table-wrap` `oc-table` | 数据表格（行线 1px） |
| **加载态** | `oc-spinner` `oc-spinner--xs` `oc-spinner--sm` `oc-spinner--md` `oc-skeleton` | 统一极简旋转指示器 |
| **空状态** | `oc-empty` `oc-empty--page` `oc-empty__title` `oc-empty__desc` `oc-guide-list` | 带 `[+]` ASCII 提示符的占位 |
| **全局通知** | `useToast()` / `oc-toast` `oc-toast-stack`（`--info/--success/--warning/--error`） | 右下角堆叠吐司，**禁止 `alert()`** |
| **文字语义** | `oc-text-profit` `oc-text-loss` `oc-text-muted` `oc-text-faint` `oc-text-accent` `oc-text-brand` | 语义着色，禁止硬编码色值 |
| **语义面** | `oc-surface-success` `oc-surface-error` | 盈亏背景弱色 |
| **心法提示** | `oc-hint-card` | 场景内上下文心法卡，可关闭，不遮挡关键行情 |
| **工具条** | `oc-float-toolbar` | 画布内浮动控制条 |

**浮动工具条（`oc-replay-bar` / `oc-replay-btn` / `oc-annotate-toolbar`）与标签输入（`oc-tag` / `oc-tag-input` / `oc-grade-badge`）未单独建类**：回放控制条与标注工具的图标按钮统一用 `oc-btn` / `oc-icon-btn`，标注的 setup/错误标签/评分统一用 `oc-btn--sm` 组。如需分册再加类，先在本节登记。

---

## 6. 标注系统规范 (Annotation System)

存储粒度分两类，数据模型必须区分：

| 粒度 | 内容 | 行为 |
| :--- | :--- | :--- |
| **绑定持仓** | 文字笔记、setup 标签、错误分类、评分（A+/B/C）、情绪记录、计划止损/目标价 | 随持仓增删查，进分析统计 |
| **绑定 symbol + 时间区域** | 画线标注 | 与持仓无关，回看同一区域时始终可见 |

- 画线工具集固定：横线（已有）、趋势线、水平区域（矩形）、斐波那契回调。新增工具须先修订本规范。
- 标注**自动保存**，不得打断复盘流；保存失败才 toast 报错。

---

## 7. 上下文心法提示 (Contextual Hints)

- 独立学习页取消；心法内容以 `oc-hint-card` 出现在复盘场景中；
- 触发依据：错误标签（如标记"追高"时弹出对应心法卡）、当前持仓的高手风格语境；
- 提示可关闭、不遮挡关键行情、每条同一持仓只自动弹出一次。

---

## 8. 交互与状态反馈铁律 (Interaction & State Feedback)

1. **永远不出现白屏 / 假死态**：
   - 任何异步操作（加载列表、拉取 K 线、导入数据、同步币安）必须展示对应的 `oc-spinner` 或骨架态；
2. **错误处理人性化**：
   - 网络异常或数据解析失败必须给出**中文友好提示**，并提供「重试」按钮，禁止直接抛出原始异常英文；
3. **操作结果即时反馈**：
   - 凡涉及"导入"、"同步"、"删除"、"切换"、"落库"等动作，必须调用 `useToast` 提供明确的 Toast 提示；
4. **可点击元素手型指针**：
   - 所有按钮、选项卡、交互卡片必须具有 `cursor: pointer`，并具备微弱的 Hover 背景过渡（`120ms ease`）；
5. **动效克制与减弱动效适配**：
   - 仅对背景色、文字颜色和面板透明度做过渡；
   - 严格尊重 `prefers-reduced-motion`，在无障碍模式下关闭任何复杂位移动画；
6. **回放即时反馈**：
   - 游标移动、订单触发、强平命中必须有即时视觉反馈（游标线移动、图上标记闪动）。

---

## 9. 数据格式化统一规范 (Data Formatting Standards)

所有数据展示必须调用 `frontend/src/utils/format.ts` 中的标准格式化函数：

- **金额与价格**：`fmtMoney(val)` —— 保留两位小数，千分位分隔符（如 `2,488.64`、`169,520.87`）；
- **百分比**：`fmtPct(val)` 或 `${val >= 0 ? '+' : ''}${val.toFixed(1)}%` —— 明确标注正负符号与 1 位小数；
- **日期与时间**：`fmtDateTime(ms)` —— 严格使用 `Asia/Shanghai (UTC+8)`，格式形如 `2026-08-27 20:30`；
- **持仓时长**：`fmtDurationMs(ms)` —— 智能格式化为 `X 天 Y 时` 或 `X 时 Y 分`；
- **交易方向标签**：做多标绿 `LONG` / 做空标红 `SHORT`，并显示杠杆倍数（如 `做多 20x`）。

---

## 10. 绝对禁止项 (Strict Anti-Patterns / Forbidden List)

- ❌ **严禁页面出现全局滚动条**（必须全部由 panel 内部 `overflow-y-auto` 消化）；
- ❌ **严禁使用 Emoji 充当 UI 功能图标**（统一使用 `lucide-react` 线框图标）；
- ❌ **严禁使用渐变色文字、毛玻璃叠加层 (Glassmorphism) 或炫酷阴影**；
- ❌ **严禁硬编码未适配深浅色主题的颜色**（如随意写死 `#fff` 或 `#000`；包括 JS 里的图表标记色）；
- ❌ **严禁在同一面板内出现多层卡片嵌套 (Card-in-Card 俄罗斯套娃)**；
- ❌ **严禁使用浏览器原生 `alert()` 或 `confirm()`**；
- ❌ **严禁出现第二套图表/回放实现**（全站唯一 `ChartCanvas.tsx`，藏未来视图与复盘共用）；
- ❌ **严禁把高手或模拟交易混入 self 数据集**（owner 隔离），分析页默认只展示 self 数据；
- ❌ **严禁裸写设计要素字面值**：`border-radius: 4px`、`z-index: 200`、`h-4 w-4`、`gap-[13px]`、
  `text-[15px]`、`py-0.2`（Tailwind 不生成，等于不生效）—— 一律改用 §11 令牌；
- ❌ **严禁使用 Tailwind 默认圆角/字号尺度**：`rounded-md` `rounded-lg` `rounded-full`
  `text-xs/sm/base/lg`（与 `--oc-radius-*` / `--oc-text-*` 不同源，会引入第二套尺度）；
- ❌ **右面板/浮层不得遮挡价格轴与最新行情**（§2.1.1）；

---

## 11. 设计要素规范 (Design Elements: Radius / Space / Size / Border / Icon / Layer)

§4 只管字体，§5 只管类名。**本节管其余所有视觉要素**：圆角、间距、尺寸、边框、图标、层级。
所有值必须有令牌来源；新增值必须先在本节登记。

### 11.1 圆角 (Radius)

| 档位 | 令牌 | 值 | 用量 |
| :--- | :--- | :--- | :--- |
| **硬边** | `--oc-radius-none` | `0` | 面板、浮层、弹窗、卡片、下拉、列表行、徽标、图表元素 —— **默认档** |
| **控件** | `--oc-radius-sm` | `4px` | 按钮、输入框、图标按钮（唯一允许软化的地方） |
| **胶囊** | `--oc-radius-pill` | `12px` | 纯数字/字符的小圆徽标（如重叠头像角标） |

规则：

- 实现层一律写 `border-radius: var(--oc-radius-*)`，**禁止裸写 `0` / `4px` 等字面值**；
- Tailwind 侧对应 `rounded-none` / `rounded-sm` / `rounded-pill`；
- **`rounded-md` / `rounded-lg` / `rounded-full` 禁止使用**（Tailwind 默认值与令牌不同源，会引入第二套圆角）；
- 语义规则：**面板/容器 = 硬边，可交互控件 = 4px**。不允许同一层级两套值。

### 11.2 间距 (Spacing)

基准 = **2px 网格**（与 Tailwind 的 0.5 步进同源）。合法值集合：

| 令牌 | 值 | 典型用途 | Tailwind |
| :--- | :--- | :--- | :--- |
| `--oc-space-1` | 4px | 图标与文字间隙、徽标内边距 | `gap-1` `px-1` |
| `--oc-space-2` | 8px | 控件内间隙、紧凑块间距、列表行纵向内边距 | `gap-2` `py-2` |
| `--oc-space-3` | 12px | 面板内边距、卡片内边距、行横向内边距 | `p-3` `px-3` |
| `--oc-space-4` | 16px | 区块间距、空态 gap、卡片分组 | `gap-4` `p-4` |
| `--oc-space-5` | 24px | 页面级留白、大区块分隔 | `gap-6` |
| `--oc-space-6` | 32px | 页面级最大留白、空态外层 padding | `p-8` |

**半档**（2px / 6px / 10px / 14px）允许用于图标旁隙与紧凑徽标：Tailwind `gap-1.5`(6px)
`gap-2.5`(10px) `px-3.5`(14px) 等 0.5 步进类均在合法集合内，无需新建令牌。

规则：

- **所有间距必须落在 2px 网格上**（偶数 px）。奇数 px 间距（`gap: 7px` `padding: 13px`）禁止；
- 禁止 Tailwind 无法生成的死类名（`py-0.2` / `px-1.2` / `py-0.75`）：这些类不会产生任何 CSS，写了等于没写；
- 任意值间距（`gap-[13px]` `p-[7px]`）禁止用于**常规布局**；
  仅在必须时允许：定位坐标（`top-[62px]` 对齐图表工具条）、视口比例（`pt-[7vh]`）、
  或不可推翻的组件尺寸（如 `w-[320px]`）；
- **禁止依赖 CSS 覆盖去修兄弟间距**（如 `.oc-empty__desc + .oc-btn { margin-top }`）—— 容器 `gap` 已经负责，调用方也不要再写 `mt-3`。

### 11.3 控件尺寸 (Control Size)

所有可点击控件的**高度必须**取自下表，禁止逐处 `h-[34px]` 类自创：

| 令牌 | 值 | 用途 |
| :--- | :--- | :--- |
| `--oc-control-sm` | 28px | 紧凑区控件（`.oc-btn--sm` `.oc-icon-btn--sm` `.oc-tabs--compact .oc-tab`） |
| `--oc-control-md` | 32px | **默认控件高**（裸 `.oc-btn` `.oc-btn--md` `.oc-input-wrap` `.oc-select` `.oc-tab`） |
| `--oc-control-lg` | 36px | 强调/大按钮（`.oc-btn--lg`） |
| `--oc-control-nav` | 44px | 导航栏、图标头像框 |

**压缩档**（低于 sm，仅限纯展示型小标签，不可单独作为点击目标）：

| 元素 | 高 | 说明 |
| :--- | :--- | :--- |
| `.oc-chip` | 26px | 段选胶囊：自身可点但成组使用，目标宽度远大于高度 |
| `.oc-badge` | 22px | 纯状态徽标，不可点击 |

其它固定尺寸（`.oc-spinner` 16/24、`.oc-navbar` 48 含 safe-area）属图形或容器，不走本表。

宽度由内容决定，仅图标类控件强制 `w == h`。

**裸 `.oc-btn` 即 md 档**（`min-height: var(--oc-control-md)`）：不得依赖 `line-height` 推导高度
（历史偏差：旧代码得到 30px，既不在 28/32/36 阶梯上、也随字号变动而漂移）。

### 11.4 边框 (Border)

| 令牌 | 值 | 语义 | 用途 |
| :--- | :--- | :--- | :--- |
| `--oc-border-hairline` | 1px | **分隔** | 列表行分隔、表格行线、区块内细分隔 |
| `--oc-border-structural` | 2px | **结构** | 面板/浮层/弹窗/按钮/输入框外框、硬边网格 |

规则：同层级不得混用。**容器外框一律 2px**；**内部行分隔一律 1px**。
禁止 `border-b-2` 与 `border-b` 在同类结构上随性切换。

### 11.5 图标尺寸 (Icon Size)

只有 3 档，对应 `lucide-react` 的 `size` 属性或 Tailwind `h-icon-* w-icon-*`：

| 令牌 | 值 | 用途 |
| :--- | :--- | :--- |
| `--oc-icon-inline` | 12px | 文字行内图标、徽标内、状态点缀 |
| `--oc-icon-action` | 14px | 按钮内图标、输入框前缀图标、表格操作图标 |
| `--oc-icon-tool` | 16px | 图表工具条、导航区、主操作图标 |

规则：

- **禁止 `h-3 w-3` / `h-3.5 w-3.5` / `h-4 w-4` 等 Tailwind 默认值**（14/14/16 混用难审查）；
- 装饰性图标必须 `aria-hidden`；独立功能图标必须置于带 `aria-label` 或可见文字的控件内；
- 非立方尺寸（如 `h-1.5 w-1.5` 圆点、头像框、Sparkline）属图形而非图标，豁免。

### 11.6 层级 (z-index)

层级靠令牌实现单一分配表，**禁止裸写数值**：

| 令牌 | 值 | 层 |
| :--- | :--- | :--- |
| `--oc-z-chart` | 10 | 图表内部覆盖层（尺子 canvas 等） |
| `--oc-z-canvas-float` | 20 | 画布内浮动工具条 |
| `--oc-z-float-panel` | 30 | 左侧浮层（列表/详情） |
| `--oc-z-above-modal` | 75 | 需压在居中弹窗之上的浮卡（详情卡 / 工具条入口） |
| `--oc-z-navbar` | 40 | 顶部导航 |
| `--oc-z-popover` | 60 | 下拉菜单 |
| `--oc-z-modal` | 70 | 居中弹窗及其背板 |
| `--oc-z-toast` | 300 | 全局 toast 堆叠 |
| `--oc-z-skip-link` | 500 | 无障碍跳转链接 |

规则：

- TSX 侧用 `style={{ zIndex: 'var(--oc-z-*)' }}`（不要在 Tailwind 里写 `z-[300]`）；
- 新增浮层必须先在上表登记，不得就地取号。

### 11.7 动效 (Motion)

- 过渡只允许 `background-color` / `border-color` / `color` / `box-shadow`，时长 `120ms ease`；
- 位移/缩放动画仅限 `oc-enter` 入场（`0.32s ease-out`）；
- 禁止渐变、毛玻璃、阴影（详见 §10）。

---

## 12. 设计令牌清单 (Token Catalogue)

| 类别 | 令牌名 | 定义位置 |
| :--- | :--- | :--- |
| 字体 | `--oc-font-mono` `--oc-font-sans` | `opencode.css :root` |
| 字号 | `--oc-text-12/13/14/16/20/display` | `opencode.css :root` |
| 行高/字重 | `--oc-leading*` `--oc-weight-*` | `opencode.css :root` |
| 圆角 | `--oc-radius-none/sm/pill`(+`-md`/`-lg` 兼容别名) | `opencode.css :root` |
| 间距 | `--oc-space-1..6` | `opencode.css :root` |
| 控件尺寸 | `--oc-control-sm/md/lg/nav` | `opencode.css :root` |
| 边框 | `--oc-border-hairline/structural` | `opencode.css :root` |
| 图标 | `--oc-icon-inline/action/tool` | `opencode.css :root` |
| 层级 | `--oc-z-*` | `opencode.css :root` |
| 色彩 | `--background-*` `--surface-*` `--text-*` `--border-*` `--oc-profit/loss` `--oc-chart-*` | `opencode.css :root` / `[data-theme="dark"]` |
| Tailwind 桥接 | `--radius-*` `--text-oc-*` `--spacing-oc-*` `--spacing-icon-*` `--spacing-control-*` | `index.css @theme` |

**新增样式要素流程**：① 在本节与 §11 登记令牌 → ② 在 `opencode.css :root` 定义 →
③ 如需 Tailwind 工具类，在 `index.css @theme` 桥接 → ④ 在 JSX/CSS 消费。四步缺一不可。

---
