import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Local-vs-UTC bucketing is part of the contract; pin the zone so it is reproducible.
    env: { TZ: 'Asia/Shanghai' },
    // designTokens.test.ts 断言 CSS 源文本（DESIGN §11 护栏）：必须让 `?raw` 拿到真实
    // 内容而不是 vitest 默认的 CSS 空桩。
    css: true,
  },
});
