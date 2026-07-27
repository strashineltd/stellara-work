import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx'],
    environment: 'jsdom',
    globals: false,
    // secrets.ts / config-v2.ts / db.ts 用 module-level state 隔离测试目录
    // 跨文件并发会污染，所以单文件串行
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
});
