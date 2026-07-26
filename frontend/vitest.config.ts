import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Local-vs-UTC bucketing is part of the contract; pin the zone so it is reproducible.
    env: { TZ: 'Asia/Shanghai' },
  },
});
