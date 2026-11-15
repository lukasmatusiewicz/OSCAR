import path from 'node:path';
import { defineConfig } from '../server/node_modules/vitest/dist/config.js';

export default defineConfig({
  root: path.resolve(__dirname, '../server'),
  resolve: {
    alias: {
      '@oscar/shared': path.resolve(__dirname, '../shared/src'),
      zod: path.resolve(__dirname, '../server/node_modules/zod'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['../.eval-harness/**/*.holdout.spec.ts'],
  },
});
