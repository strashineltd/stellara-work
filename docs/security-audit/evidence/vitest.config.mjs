import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = fileURLToPath(new URL('.', import.meta.url));

export default {
  root,
  resolve: { alias: {
    vitest: path.join(root, 'node_modules/vitest/dist/index.js'),
    'electron-log/main': path.join(evidence, 'log-stub.mjs'),
  } },
  test: {
    include: [path.join(evidence, 'reproduce-loops.audit.ts')],
    environment: 'node',
    fileParallelism: false,
  },
};
