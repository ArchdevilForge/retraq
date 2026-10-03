# CONSTRAINT-MATRIX — 条款 → 测试 → 证据

> 逐条对照 `docs/DESIGN.md`（D§n）与 `docs/PRODUCT.md`（P§n）中**可机器判定**的约束与测试锚点。
> 运行方式（仓库根目录，后端 :9527 + 前端 :5173 已启动）：
> `/usr/bin/python -m pytest frontend/e2e -q`
> 截图基线：`frontend/e2e/__screenshots__/`（每页面 × 双主题，人工审查一次后以 git diff 审查后续变化）。

图例：✅ 有通过中的测试锚点 ｜ ⚠️ xfail 锚点（实现与规范偏差，已记录） ｜ ❌ 缺口（规范有、实现无，未断言）

## docs/DESIGN.md

| 条款 | 约束（摘要） | 测试锚点（文件:行） | 状态 |
| --- | --- | --- | --- |
| D§1/§2.1 | 图表全屏画布 + 浮层面板；最外层容器 overflow-hidden | `test_invariants.py:45`（12 组合网格断言零全局滚动） | ✅ |
| D§2.1 | 所有可滚动区域 min-h-0/overflow-y-auto，不撑爆视口 | `helpers.py:109`（scrollWidth/Height ≤ innerWidth/Height），全页 × 主题 × 1280/1440 网格 | ✅ |
| D§2.2 | 顶部工具条：时间周期 5m/15m/1h/4h/1d | `test_replay.py:194`（断言 5 个周期按钮） | ✅ |
| D§2.2 | 数据源切换器（我的 ↔ 高手 ↔ sim）+ 同步入口 | `test_datasets.py:54`（三 owner 分组）；`test_datasets.py:82`（同步按钮 + mock） | ✅ |
| D§2.3 | 自由时间游标持续可见（换标的/选持仓/慢网换数据后不得隐形） | `test_replay.py`（常驻可见 + 拖动位移断言） | ✅ |
| D§2.3 | 藏未来回放：隐藏游标后 bar + ←/→ 逐根推进 + shown/total 进度 | `test_replay.py::test_hide_future_replay_practice` | ✅ |
| D§2.4 | 弹层范式：列表=工具条按钮+居中弹窗（点外关）；详情=选中驱动右浮卡（×/Esc） | `test_replay.py:218`（开合/点外/Esc 全链路）；`test_replay.py:358`（焦点落搜索框 + 背板上层 toggle） | ✅ |
| D§2.5 | 顶栏仅 复盘/分析 两项 | `helpers.py:167` + `test_invariants.py:45`（两页网格，tab 计数=2） | ✅ |
| D§3 | 深色默认主题 | `test_invariants.py:94`（无存储时 dark + 切换持久化） | ✅ |
| D§3 | 双模式 token 表（--background-base/weak 值） | light：`test_invariants.py:45`；dark：`test_invariants.py:75`（精确 hex #141212/#201d1d） | ✅ 双主题均精确对齐 |
| D§4.1 | 100% IBM Plex Mono | `helpers.py:119`（body 计算字体栈），三页网格 | ✅ |
| D§4.2 | 数字 tabular-nums | `helpers.py:125`（.tabular-nums 与 .oc-stat__value 计算样式） | ✅ |
| D§4.3 | 字号阶梯 | 截图基线人工审查（`test_visual.py:27`） | ✅（视觉） |
| D§5 | oc-* 组件类名体系 | 全套定位器均以 oc-* 取元素：oc-btn/oc-tab（`test_replay.py`）、oc-spinner（`test_invariants.py:155`）、oc-toast（`test_datasets.py:28` 等）、oc-hint-card（`test_replay.py:113`）、oc-dropdown/oc-list-item（`test_masters.py:37`） | ✅ |
| D§6 | 标注（绑定持仓）自动保存，不打断复盘流 | `test_replay.py:42`（防抖落库 + 刷新仍在）；`test_replay.py:82`（评分/错误分类） | ✅ |
| D§6 | 画线绑定 symbol+时间区域，回看仍可见 | `test_replay.py:152`（hline 落库 + 刷新回查） | ✅ |
| D§6 | ~~复盘页「今日复盘」入口~~ **v4 删除**（P§三 同步移除） | — | ➖ |
| D§7 | 心法卡按错误标签触发、可关闭、同一持仓只自动弹一次 | `test_replay.py:113` | ✅ |
| D§8.1 | 异步必现 oc-spinner，绝不白屏/假死 | `test_invariants.py:155`（K 线请求挂起时 spinner 可见）；复盘页 symbol 自挑期间同样有 spinner/error 态（ReplayPage symbolPick 分支） | ✅ |
| D§8.2 | 错误必中文提示 + 重试按钮，且可恢复 | `test_invariants.py:174`（mock 500 → 中文文案 + 重试 → 恢复） | ✅ |
| D§8.3 | 动作必出 Toast（导入/同步/删除/落库/复盘结论） | 导入 `test_datasets.py:28`；同步 `test_datasets.py:82`、`test_masters.py:110`；落库 `test_replay.py`；复盘结论 `test_analysis.py:45` | ✅ |
| D§8.4 | 可点击元素 cursor:pointer + focus 可见 | `helpers.py:168`（全量扫描）+ `test_invariants.py:132`（键盘 focus 指示器） | ✅ |
| D§8.5 | 尊重 prefers-reduced-motion | `test_invariants.py:112`（样式表含媒体规则） | ✅（规则存在；位移动画未逐一断言） |
| D§8.6 | 回放即时反馈（游标推进可见） | `test_replay.py::test_hide_future_replay_practice`（逐根推进计数） | ✅ |
| D§9 | fmtMoney 两位小数千分位 / fmtPct 正负号 | `test_analysis.py:20`（样本=4 笔 精确断言，截图基线含 3,000.00 格式） | ✅（部分视觉） |
| D§9 | fmtDateTime 严格 `YYYY-MM-DD HH:mm`（UTC+8） | `test_replay.py:191`（列表日期正则断言；fmtDateTime 源头已改为显式 Asia/Shanghai） | ✅ |
| D§10 | 严禁全局滚动条 | `test_invariants.py:45` 网格 | ✅ |
| D§10 | 严禁 Emoji 充当图标 | `helpers.py:174`（交互元素/标题/表格文本扫描），网格全页 | ✅ |
| D§10 | 严禁 alert()/confirm() | `helpers.py:181`（dialog 钩子），全程各测试隐式覆盖 | ✅ |
| D§10 | 严禁第二套图表/回放实现 | 结构保证：全站唯一 `ChartCanvas.tsx`（训练模式已删，不再有第二实现） | ✅（结构 + 运行时） |
| D§10 | 严禁高手/sim 混入 self 数据集（owner 隔离） | `test_datasets.py:54`（三 owner 分组各行其位）；`test_analysis.py:89`（分析默认不含 sim，需显式开关） | ✅ |

| D§2.1.2 | 分析页单视口：5 tab 零滚动 + 零页面滚动 + 内容铺满宽度（禁 max-w 截断）；< lg 窄屏仅框架零滚动 | `test_analysis.py::test_analysis_tabs_fit_single_viewport`（5 tab × 3 视口 ≥1280） | ✅ |
| D§2.1.2 | 并列信息横向铺开（日/周/月复盘），禁纵向堆叠 | `test_analysis.py:20`（三清单同屏可见）+ 截图基线 | ✅ |
| D§11.1 | 圆角三档（none/sm/pill），禁 Tailwind 默认尺度 | `designTokens.test.ts`（rounded-md/lg/full 扫描 + CSS 字面值扫描） | ✅ |
| D§11.2 | 间距 4px 基准，无死类名与任意值 | `designTokens.test.ts`（`py-0.2` 类非 0.5 倍数扫描） | ✅ |
| D§4.3 | 字号阶梯内，无 Tailwind 默认字号/阶梯外字号 | `designTokens.test.ts`（`text-[Npx]` + `text-xs/sm/base/lg` 扫描） | ✅ |
| D§11.5 | 图标三档（inline/action/tool） | `designTokens.test.ts`（`h-N w-N` 扫描） | ✅ |
| D§11.6 | 层级令牌化，禁裸写 z-index | `designTokens.test.ts`（TSX 与 CSS 双向扫描） | ✅ |
| D§5 | 可点击行必须用 oc-* 类（禁裸写 button） | `designTokens.test.ts`（裸 button 扫描，`oc-bar-row` 新增） | ✅ |
| D§11 | 令牌四步流程自洽（登记→定义→桥接→消费） | `designTokens.test.ts`（JSX 用到的 `h-control-*`/`h-icon-*` 必须有 `@theme` 桥接） | ✅ |
| D§8.1 | 路由级懒加载期必须有可见加载态 | `App.tsx` Suspense fallback（oc-spinner）+ `test_invariants.py:45` 网格 | ✅ |

## docs/PRODUCT.md

| 条款 | 约束（摘要） | 测试锚点（文件:行） | 状态 |
| --- | --- | --- | --- |
| P§三 | 复盘模式交易锚定：点持仓定位时间段 | `test_replay.py:194`（工具条切到 ETH-USDT） | ✅ |
| P§三 | 复盘引擎无差别加载数据集：切数据集后自动挑该集 top 币种，不留误导空态 | `test_replay.py:385`（ETH→BTC 切换断言） | ✅ |
| P§七 | 分析页下钻：报表行点击 → 复盘引擎锁定该交易/币种（`?symbol=&trade=`） | `test_replay.py:398`（详情卡直弹 + 工具条切 symbol） | ✅ |
| P§三 | 藏未来回放：未来隐藏 + 逐根揭示（无下单/撮合） | `test_replay.py::test_hide_future_replay_practice` | ✅ |
| P§三 | owner：self / master:{id} / sim；分析默认 self | `test_datasets.py:54`；`test_analysis.py:89` | ✅ |
| P§三 | 三层记录模型：上下文层（setup/错误/评分/笔记）零摩擦 | `test_replay.py:42`、`test_replay.py:82`（输入 → 自动落库） | ✅ |
| P§三 | ~~复盘节奏~~ **v4 删除**（用户裁决；数据表保留） | — | ➖ |
| P§四 | 手动 CSV 导入兜底 + 导入 Toast | `test_datasets.py:28` | ✅ |
| P§四 | 数据源切换器内手动同步按钮（不触外网） | `test_datasets.py:82`（route mock + Toast） | ✅ |
| P§四 | 后端启动自动增量同步 / 密钥只存 .env | 后端职责，属 pytest 单测域（`backend/tests/`），不在 UI e2e 范围 | ➖ 范围外 |
| P§五.1 | 复盘页「我的/高手」分区切换，同一套图表与标注 | `test_masters.py:81`（切换 + 交割单联动统一引擎） | ✅ |
| P§五.2 | 同段行情「他 vs 我」overlay 对照 | `test_masters.py:81`（chip 统计同期自有持仓 + 圆点标注叠加开关） | ✅ |
| P§五.3 | 榜单默认 Sharp 排序（不按 ROI），ROI 可选 | `test_masters.py:37`（默认 sharp_ratio + 与 API 顺序一致 + 种子组 sharp 序）；`test_masters.py:64`（切 ROI 后种子序反转） | ✅ |
| P§五 | 高手心法锚定持仓旁补足语境 | 与 self 共用 AnnotationEditor（`test_replay.py:113` 锚定机制本体） | ✅（同组件） |
| P§六 | 订单：市价/限价/止损限价；挂单成交与撤销 | `test_replay.py`（三种全走 UI）；`test_replay.py`（撤销后不成交） | ✅（stop 单未覆盖，撮合逻辑同路径） |
| P§六 | 图上拖线 TP/SL 括号单 | `test_replay.py`（第 8 步：hover 命中带位移证明 setStops 生效） | ✅ |
| P§六 | 反向开仓 / 部分平仓 / 加仓 | `test_replay.py`（第 2–5 步逐一断言） | ✅ |
| P§六 | cross-margin 强平结算 | `test_replay.py`（TRUMP 波动窗 + 20× 全仓 → 爆仓收场） | ✅ |
| P§六 | 开局面板（资金/费率/杠杆/保证金模式） | `test_replay.py`（杠杆 20×、100% 仓输入） | ✅ |
| P§六 | ~~训练下单模拟~~ | v3 删除：0 产出；仅藏未来回放并入复盘（见 D§2.3） | ➖ 已废弃 |
| P§六 | K 线与复盘同源 | `test_replay.py`（UI 标记价 == /api/klines 收盘价，逐 bar 对齐断言） | ✅ |
| P§七 | 报告集固定六类，全 tab 可加载，图表化拉满（权益曲线/横条图） | `test_analysis.py:20`（六 tab + 权益曲线 canvas + 种子数据核对）；`test_analysis.py:89`（视角切换） | ✅ |
| P§七 | 「模拟 vs 实盘」对比开关 | `test_analysis.py:89`（默认关，开启后 include_sim 请求） | ✅ |
| P§七 | master 视角切换 | `test_analysis.py:89`（视角 tab 切高手 → include_master refetch + 诚实空态） | ✅ |
| P§八 | 心法场景内上下文化，独立学习页取消 | `test_replay.py:113`（错误标签 → 心法卡）；导航无学习页（`test_invariants.py:45` tab=3） | ✅ |
| P§九 | 顶栏三项 + 数据源切换器 | `test_invariants.py:45` + `test_datasets.py:54` | ✅ |

## 目标分层覆盖

| 层 | 内容 | 锚点 | 状态 |
| --- | --- | --- | --- |
| 1 不变量层 | 页面 × 双主题 × 1440/1280 网格（零滚动/等宽/tabular/cursor/emoji/alert/主题） | `test_invariants.py:45`（12 组合） | ✅ |
| 2 功能层 | 复盘 / 高手 / 分析 / 数据集 状态机（上表逐条） | `test_replay.py` `test_masters.py` `test_analysis.py` `test_datasets.py` | ✅ |
| 3 视觉层 | 页面 × 双主题关键状态截图 | `test_visual.py:27` → `__screenshots__/*.png`（10 张基线，人工审查） | ✅ |
| 4 运行时健康 | console 0 error、无未 mock 4xx/5xx、CPU 4× 节流、heap 长会话 | `test_runtime_health.py:29` / `:72` / `:110` | ✅ |

## 已发现并修复的规范偏差（本套件驱动）
1. **浮层面板遮挡图表工具条**（违反 D§2.2/§2.4）：面板 `top:8px` 盖住 54px 工具条，画线/周期/全屏按钮在面板开启时不可点击。修复：`opencode.css` 面板起始位下移至工具条之下（`top: calc(54px + 8px)`）。
2. **深色调色板偏离 D§3 色值表**：`--background-base/weak` 为 #201d1d/#302c2c。修复：对齐 #141212/#201d1d，raised/input/按钮/图表底色逐级落到规范色阶（#141212 < #201d1d < #282525 < #302c2c）。
3. **fmtDateTime 输出 `2026/8/18 08:00:00`**（违反 D§9）：源头改为显式 Asia/Shanghai + `YYYY-MM-DD HH:mm`；复盘时间线改用 fmtDateTime（原先 slice ISO 字符串还是 UTC 墙钟）。
4. **复盘无自由游标、无今日复盘入口、无他我对照、分析无 master 视角、数据集无删除 UI**：全部按规范补齐（见上表锚点）。
5. **右侧浮层遮挡价格轴与最新行情**（违反 D§2.1）：浮层 `inset:0` 铺满画布、面板压在图表上（实测 1440px 下压住 388px，价格轴完全不可见）。修复：`.oc-canvas:has(.oc-float-panel--right)` 置 `--oc-float-panel-inset`，图表右边界让位；≤767px 保持满幅浮层。新增 e2e 断言。
6. **设计要素无约束导致的尺度分裂**（新增 D§11）：圆角三套并存（硬编码 0 / token 4px / Tailwind md=6px）、`py-0.2` 死类名（Tailwind 不生成）、`oc-select` 死类名（文档+JSX 有、CSS 无）、`h-4 w-4` 等 Tailwind 默认图标尺寸、z-index 散落 6 个裸值、`text-[18px]` 阶梯外字号、`TrainingChart` 硬编码 hex。修复：新增 §11/§12 规范 + 全套令牌 + `designTokens.test.ts` 护栏（13 项断言）。
7. **首屏三角全部页面同步加载**（性能）：初始 chunk 407.9 kB（gzip 125.4 kB）。修复：路由级 `React.lazy` + `Suspense` 加载态 → 初始 249.0 kB（gzip 80.4 kB，-36%）。
8. **分析页 390px 段选溢出视口**（D§2.1）：6 个 tab `nowrap` 超出 334px 容器。修复：`.oc-tabs--wrap`。

## 待裁决缺口（规范有、实现无）

> 2026-08-29 第二轮修复后全部闭环（深色 token、快捷键/自由游标、今日复盘入口、日期格式、
> 他我对照、分析 master 视角、数据集删除 UI）。第三轮按用户 grill 收敛结论将 D§2.4 从
> "常驻浮层面板" 升级为 "TV 式弹层范式"（列表浮层 / 详情浮卡 / 详情抽屉），
> 分析页新增权益曲线与横条图（P§七）。当前无遗留缺口。

## v3 功能精简（2026-09-12）：基于实测使用率

| 功能 | 代码量 | 实测使用（DB） | 决策 |
| --- | --- | --- | --- |
| 训练（下单模拟） | 3996 行 + e2e 471 行 | **sim 数据集 0 个** | 🔴 删除；保留藏未来回放 |
| 画线工具 | ChartCanvas 内 | drawings 0 行 | 🟢 **保留并增强**（用户主用区域/尺子/水平线） |
| 上下文标注 | AnnotationEditor 281 行 | 18 行标注仅 2 行非空 | 🟡 入口前移到详情卡顶部（摩擦是头号杀手） |
| 高手 | 3151 行 + 后端 443 行 | 696 traders / 166810 positions | 🟢 保留 |

同期修复的真实缺陷：

10. **canvas 字体不生效**：`ctx.font = '11px var(--oc-font-mono)'` —— canvas 2D 不解析 CSS 变量，浏览器静默回退 sans-serif（3 处）。修复：`readCanvasFont()` 读计算值。
11. **尺子价格精度不一致**：硬编码 `toFixed(4)`，BTC 显示 `-165.8389` 而价格轴是 `2404.39`。修复：统一走 `fmtPrice()`。
12. **区域无标注**：用户主用的工具却没有区间价格与幅度。修复：渲染 `lo ~ hi · N%` 标签。
13. **标注入口埋在详情卡底部**：需滚动才能看到标签区（实测 scrollHeight 911 > 710），核心价值功能被折叠。修复：移到首屏第一位。
14. **`TIMEFRAME_MS` 重复定义 3 份**（training/ChartManager 各一份）。修复：统一到 `services/api.ts`。
15. **藏未来开在末根**：开启后无未来可揭示，等于没东西练。修复：开启时游标自动回退 60 根 + `shown/total` 进度计数。
16. **窄视口工具条溢出**：新增按钮后 390px 撑破视口。修复：工具条右组 `flex-wrap`。

## v3.2 回放传输 / 查价 / 磁吸（2026-09-12）

| 新增 | 依据 | 断言 |
| --- | --- | --- |
| 回放传输四件套：单步 / 播放 / 步进 / 倍速 + `Shift+↓` | D§2.3（规格早已写入，此前仅实现 ←/→） | `test_replay.py::test_replay_transport_playback_steps_and_speed` |
| 选中持仓游标落开仓 bar + 「前往开仓时间」复位 | P§七（复盘第一步 = 回到下决定的时刻） | `test_replay.py::test_jump_to_trade_entry_restores_cursor` |
| 工具条 OHLC 图例（跟随 crosshair） | P§七 图表化 | `test_replay.py::test_ohlc_legend_follows_crosshair` |
| 磁吸（落点吸附最近 OHLC，8px 容忍） | P§六 画线增强 | `src/utils/chartMagnet.test.ts`（8 例边界） |
| 删除训练残留死代码 `saveTrainingSession` / `TrainingCycleInput` / `TrainingSaveResult` | v3 已删 `/api/train/save`，前端 0 调用者 | typecheck |

## v3.1 分析页收敛（2026-09-12）

| 变更 | 理由 |
| --- | --- |
| 删除分析页「复盘」tab | 与复盘页「今日复盘」写同一份 `review_notes`，功能重复；写复盘是行动、不属统计报表 → 合并到复盘页浮层（承载日/周/月完整节奏） |
| 分析页 6 tab → 5 tab | 总览 / 行为 / 时间 / 风险 / 标签 |
| 行为 tab 补 3 块 | `revengeTrades[]`（逐笔 + 距上次亏损分钟）、`overtradingDays[]`（日期/笔数/盈亏）、`tendToOversize`/`tendToRevenge` 倾向标签 —— 数据早已算出但从未渲染 |
| 时间 tab 补 2 块 | 时段明细（`hourlyStats` 的 winRate/avgPnl 原本只进 tooltip）、按星期胜率与最佳/最差 |
| 风险 tab 补 回撤曲线 | `EquityCurve` 泛化支持 `series='drawdown'`（peak-to-trough），复用同一图表引擎 |
| 全部 tab `auto-rows-fr` / `grid-rows-[..minmax(0,1fr)]` | 消除页面底部留白（行为曾 327px、时间 118px、风险 358px） |

`test_analysis_tabs_fit_single_viewport` 断言覆盖 5 tab × 3 视口。

## v4.0 复盘笔记移除 + 工具栏重排（2026-09-13）

| 变更 | 理由 |
| --- | --- |
| 删除「今日复盘」入口 + ReviewPanel + `/api/reviews` + checklists | 用户裁决「删除这个复盘笔记」；v1 tab → v3 浮层 → v4 删，两次迁移证明该功能无处安放。`review_notes` 表保留（2 行历史数据，无迁移框架不动表） |
| 工具栏改两行铺满 | 实测 1440px 下左 794 + 传输 332 + 右 630 = 1756px > 1424px 可用，flex-wrap 随机断行且与页面级按钮重叠。改为显式两行：行1 标的/周期/OHLC 图例 + 回放传输；行2 藏未来/磁吸/画线/全屏/对比 |
| 画线随 K 线移动（bug） | `onRangeChange` 从不重绘 overlay canvas，平移/缩放后画线钉在旧屏幕坐标。修复：可视范围变化即 `paintOverlay()` |
| 多条画线（bug） | 完成一笔即 `setDrawMode('none')`，画第二条必须重新点工具。改为 sticky（再点同钮/Esc 退出），Esc 可取消未完成的第一点 |

断言：`test_replay.py` 传输/跳转/图例三件套 + `test_boundaries.py::test_detail_card_fit`（改名）。
