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
| D§2.3 | 回放控制条：播放/暂停/单步/倍速 | `test_train.py:357`（单步、自动播放、4× 倍速） | ✅ |
| D§2.3 | 快捷键 Shift+↓ 播放、Shift+→ 单步 | `test_train.py:363`（键盘断言步进与播放/暂停切换） | ✅ |
| D§2.3 | 会话可恢复 / 复盘模式自由时间游标 | 落库恢复 `test_train.py:157`；自由游标 `test_replay.py:301`（常驻可见 + 拖动位移断言） | ✅ |
| D§2.4 | 弹层范式：列表=工具条按钮+左浮层（点外关、选中自动收）；详情=选中驱动右浮卡（×/Esc） | `test_replay.py:218`（开合/点外/Esc 全链路） | ✅ |
| D§2.5 | 顶栏仅 复盘/训练/分析 三项 | `helpers.py:144` + `test_invariants.py:45`（三页网格，含 tab 计数=3） | ✅ |
| D§3 | 深色默认主题 | `test_invariants.py:94`（无存储时 dark + 切换持久化） | ✅ |
| D§3 | 双模式 token 表（--background-base/weak 值） | light：`test_invariants.py:45`；dark：`test_invariants.py:75`（精确 hex #141212/#201d1d） | ✅ 双主题均精确对齐 |
| D§4.1 | 100% IBM Plex Mono | `helpers.py:119`（body 计算字体栈），三页网格 | ✅ |
| D§4.2 | 数字 tabular-nums | `helpers.py:125`（.tabular-nums 与 .oc-stat__value 计算样式） | ✅ |
| D§4.3 | 字号阶梯 | 截图基线人工审查（`test_visual.py:27`） | ✅（视觉） |
| D§5 | oc-* 组件类名体系 | 全套定位器均以 oc-* 取元素：oc-btn/oc-tab（`test_train.py:157`）、oc-spinner（`test_invariants.py:155`）、oc-toast（`test_datasets.py:28` 等）、oc-hint-card（`test_replay.py:113`）、oc-dropdown/oc-list-item（`test_masters.py:37`） | ✅ |
| D§6 | 标注（绑定持仓）自动保存，不打断复盘流 | `test_replay.py:42`（防抖落库 + 刷新仍在）；`test_replay.py:82`（评分/错误分类） | ✅ |
| D§6 | 画线绑定 symbol+时间区域，回看仍可见 | `test_replay.py:152`（hline 落库 + 刷新回查） | ✅ |
| D§6 | 复盘页常驻「今日复盘」入口 | `test_replay.py:253`（无需选中持仓即可写结论，与分析页时间线同源） | ✅ |
| D§7 | 心法卡按错误标签触发、可关闭、同一持仓只自动弹一次 | `test_replay.py:113` | ✅ |
| D§8.1 | 异步必现 oc-spinner，绝不白屏/假死 | `test_invariants.py:155`（K 线请求挂起时 spinner 可见） | ✅ |
| D§8.2 | 错误必中文提示 + 重试按钮，且可恢复 | `test_invariants.py:174`（mock 500 → 中文文案 + 重试 → 恢复） | ✅ |
| D§8.3 | 动作必出 Toast（导入/同步/删除/落库/复盘结论） | 导入 `test_datasets.py:28`；同步 `test_datasets.py:82`、`test_masters.py:110`；落库 `test_train.py:157`；复盘结论 `test_analysis.py:45` | ✅ |
| D§8.4 | 可点击元素 cursor:pointer + focus 可见 | `helpers.py:168`（全量扫描）+ `test_invariants.py:132`（键盘 focus 指示器） | ✅ |
| D§8.5 | 尊重 prefers-reduced-motion | `test_invariants.py:112`（样式表含媒体规则） | ✅（规则存在；位移动画未逐一断言） |
| D§8.6 | 回放即时反馈（游标/订单/强平可见反馈） | `test_train.py:357`（游标推进）；`test_train.py:157`（成交/止损即时反映） | ✅ |
| D§9 | fmtMoney 两位小数千分位 / fmtPct 正负号 | `test_analysis.py:20`（样本=4 笔 精确断言，截图基线含 3,000.00 格式） | ✅（部分视觉） |
| D§9 | fmtDateTime 严格 `YYYY-MM-DD HH:mm`（UTC+8） | `test_replay.py:191`（列表日期正则断言；fmtDateTime 源头已改为显式 Asia/Shanghai） | ✅ |
| D§10 | 严禁全局滚动条 | `test_invariants.py:45` 网格 | ✅ |
| D§10 | 严禁 Emoji 充当图标 | `helpers.py:174`（交互元素/标题/表格文本扫描），网格全页 | ✅ |
| D§10 | 严禁 alert()/confirm() | `helpers.py:181`（dialog 钩子），全程各测试隐式覆盖 | ✅ |
| D§10 | 严禁第二套图表/回放实现 | 结构保证：复盘/训练同用 `ChartCanvas.tsx`；运行时锚点 `test_replay.py:194` 与 `test_train.py:157` 同一组件渲染（工具条/标记一致） | ✅（结构 + 运行时） |
| D§10 | 严禁高手/sim 混入 self 数据集（owner 隔离） | `test_datasets.py:54`（三 owner 分组各行其位）；`test_analysis.py:89`（分析默认不含 sim，需显式开关） | ✅ |

## docs/PRODUCT.md

| 条款 | 约束（摘要） | 测试锚点（文件:行） | 状态 |
| --- | --- | --- | --- |
| P§三 | 复盘模式交易锚定：点持仓定位时间段 | `test_replay.py:194`（工具条切到 ETH-USDT） | ✅ |
| P§三 | 训练模式未来隐藏、实时决策 | `test_train.py:157`（标记价与窗口 bar 对齐后才可下单） | ✅ |
| P§三 | owner：self / master:{id} / sim；分析默认 self | `test_datasets.py:54`；`test_analysis.py:89` | ✅ |
| P§三 | 三层记录模型：上下文层（setup/错误/评分/笔记）零摩擦 | `test_replay.py:42`、`test_replay.py:82`（输入 → 自动落库） | ✅ |
| P§三 | 复盘节奏：日/周/月固定清单；结论存全局时间线，随时回看 | `test_analysis.py:45`（三个节奏块 + 写入 + API 回查 + 刷新回看） | ✅ |
| P§四 | 手动 CSV 导入兜底 + 导入 Toast | `test_datasets.py:28` | ✅ |
| P§四 | 数据源切换器内手动同步按钮（不触外网） | `test_datasets.py:82`（route mock + Toast） | ✅ |
| P§四 | 后端启动自动增量同步 / 密钥只存 .env | 后端职责，属 pytest 单测域（`backend/tests/`），不在 UI e2e 范围 | ➖ 范围外 |
| P§五.1 | 复盘页「我的/高手」分区切换，同一套图表与标注 | `test_masters.py:81`（切换 + 交割单联动统一引擎） | ✅ |
| P§五.2 | 同段行情「他 vs 我」overlay 对照 | `test_masters.py:81`（chip 统计同期自有持仓 + 圆点标注叠加开关） | ✅ |
| P§五.3 | 榜单默认 Sharp 排序（不按 ROI），ROI 可选 | `test_masters.py:37`（默认 sharp_ratio + 与 API 顺序一致 + 种子组 sharp 序）；`test_masters.py:64`（切 ROI 后种子序反转） | ✅ |
| P§五 | 高手心法锚定持仓旁补足语境 | 与 self 共用 AnnotationEditor（`test_replay.py:113` 锚定机制本体） | ✅（同组件） |
| P§六 | 订单：市价/限价/止损限价；挂单成交与撤销 | `test_train.py:157`（三种全走 UI）；`test_train.py:329`（撤销后不成交） | ✅（stop 单未覆盖，撮合逻辑同路径） |
| P§六 | 图上拖线 TP/SL 括号单 | `test_train.py:157`（第 8 步：hover 命中带位移证明 setStops 生效） | ✅ |
| P§六 | 反向开仓 / 部分平仓 / 加仓 | `test_train.py:157`（第 2–5 步逐一断言） | ✅ |
| P§六 | cross-margin 强平结算 | `test_train.py:274`（TRUMP 波动窗 + 20× 全仓 → 爆仓收场） | ✅ |
| P§六 | 开局面板（资金/费率/杠杆/保证金模式） | `test_train.py:274`（杠杆 20×、100% 仓输入） | ✅ |
| P§六 | 结果落库 → sim 数据集 → 可复盘/进分析 | `test_train.py:157`（第 9–10 步：落库 Toast + API 断言 + 切换器「训练」组可见） | ✅ |
| P§六 | K 线与复盘同源 | `test_train.py:157`（UI 标记价 == /api/klines 收盘价，逐 bar 对齐断言） | ✅ |
| P§七 | 报告集固定六类，全 tab 可加载，图表化拉满（权益曲线/横条图） | `test_analysis.py:20`（六 tab + 权益曲线 canvas + 种子数据核对）；`test_analysis.py:89`（视角切换） | ✅ |
| P§七 | 「模拟 vs 实盘」对比开关 | `test_analysis.py:89`（默认关，开启后 include_sim 请求） | ✅ |
| P§七 | master 视角切换 | `test_analysis.py:89`（视角 tab 切高手 → include_master refetch + 诚实空态） | ✅ |
| P§八 | 心法场景内上下文化，独立学习页取消 | `test_replay.py:113`（错误标签 → 心法卡）；导航无学习页（`test_invariants.py:45` tab=3） | ✅ |
| P§九 | 顶栏三项 + 数据源切换器 | `test_invariants.py:45` + `test_datasets.py:54` | ✅ |

## 目标分层覆盖

| 层 | 内容 | 锚点 | 状态 |
| --- | --- | --- | --- |
| 1 不变量层 | 页面 × 双主题 × 1440/1280 网格（零滚动/等宽/tabular/cursor/emoji/alert/主题） | `test_invariants.py:45`（12 组合） | ✅ |
| 2 功能层 | 复盘 / 高手 / 训练 / 分析 / 数据集 状态机（上表逐条） | `test_replay.py` `test_masters.py` `test_train.py` `test_analysis.py` `test_datasets.py` | ✅ |
| 3 视觉层 | 页面 × 双主题关键状态截图 | `test_visual.py:27` → `__screenshots__/*.png`（10 张基线，人工审查） | ✅ |
| 4 运行时健康 | console 0 error、无未 mock 4xx/5xx、CPU 4× 节流、heap 长会话 | `test_runtime_health.py:29` / `:72` / `:110` | ✅ |

## 已发现并修复的规范偏差（本套件驱动）

1. **浮层面板遮挡图表工具条**（违反 D§2.2/§2.4）：面板 `top:8px` 盖住 54px 工具条，画线/周期/全屏按钮在面板开启时不可点击。修复：`opencode.css` 面板起始位下移至工具条之下（`top: calc(54px + 8px)`）。
2. **深色调色板偏离 D§3 色值表**：`--background-base/weak` 为 #201d1d/#302c2c。修复：对齐 #141212/#201d1d，raised/input/按钮/图表底色逐级落到规范色阶（#141212 < #201d1d < #282525 < #302c2c）。
3. **fmtDateTime 输出 `2026/8/18 08:00:00`**（违反 D§9）：源头改为显式 Asia/Shanghai + `YYYY-MM-DD HH:mm`；复盘时间线改用 fmtDateTime（原先 slice ISO 字符串还是 UTC 墙钟）。
4. **训练回放无快捷键、复盘无自由游标、无今日复盘入口、无他我对照、分析无 master 视角、数据集无删除 UI**：全部按规范补齐（见上表锚点）。

## 待裁决缺口（规范有、实现无）

> 2026-08-29 第二轮修复后全部闭环（深色 token、快捷键/自由游标、今日复盘入口、日期格式、
> 他我对照、分析 master 视角、数据集删除 UI）。第三轮按用户 grill 收敛结论将 D§2.4 从
> "常驻浮层面板" 升级为 "TV 式弹层范式"（列表浮层 / 详情浮卡 / 训练 modal+抽屉），
> 分析页新增权益曲线与横条图（P§七）。当前无遗留缺口。
