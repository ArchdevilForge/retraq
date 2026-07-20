# Design: ponytail-audit cleanup

## Boundaries

| Area | Change |
|------|--------|
| Motion | 删 GSAP；CSS class + reduced-motion |
| HTTP client | axios → thin `apiFetch` on native fetch |
| Charts | 共用 `mountCandleVolumeChart`；Inner 仍自管 anchor/crosshair |
| Backend tz | pytz → zoneinfo.ZoneInfo |
| Dead code | 删文件 / 删函数 / 移 contract 到 tests |

## Contracts

### apiFetch

```ts
// headers merge + optional JSON body
// dataset interceptor: same path rules as current axios interceptor
async function apiFetch<T>(path: string, init?: RequestInit & { params?: Record<string, unknown> }): Promise<T>
```

- 相对路径 `/api/...`（Vite proxy 不变）
- 错误：非 2xx throw Error，import 路径仍读 `detail`
- klines：map timestamp→time；重试 502/503/504（最多 4 次）；默认不带 nocache，可选 `forceRefresh`

### Chart mount helper

```ts
// frontend/src/utils/candleChart.ts (or chartTheme 旁)
type MountOpts = {
  timeScale?: DeepPartial<TimeScaleOptions>; // training vs replay 差异
  localization?: LocalizationOptions;
  priceScaleMargins?: { top: number; bottom: number };
};
function mountCandleVolumeChart(el: HTMLElement, theme: ChartTheme, opts?: MountOpts): {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
}
```

- TrainingChart：保留 barSpacing / shiftVisibleRangeOnNewBar
- ChartManagerInner：保留 localization + 之后再加 LineSeries anchor

### CSS motion

- `.oc-enter` / `.oc-enter-stagger > *`：opacity + translateY
- `@media (prefers-reduced-motion: reduce)`：动画关闭
- Navbar / page shell 挂 class，不再 useGSAP

## Data flow

无业务数据流变化。Dataset header 仍从 `localStorage[ACTIVE_DATASET_STORAGE_KEY]` 读。

## Tradeoffs

| Choice | Why |
|--------|-----|
| 不全并两个 Chart 组件 | Inner 有 anchor/双图同步，合并风险大；只抽 mount |
| fetch 不引 ky/ofetch | 零新依赖 |
| lazy → static import | 页面不大；少 Suspense 噪音 |
| 根 PNG 删除 | 调试产物；用户可本地再截 |

## Rollout / rollback

单 PR 式本地 diff；失败则按文件还原依赖与 api.ts。无迁移脚本。
