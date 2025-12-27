import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@/cli': resolve(__dirname, './src/cli'),
      '@/core': resolve(__dirname, './src/core'),
      '@/utils': resolve(__dirname, './src/utils'),
      '@/worker': resolve(__dirname, './src/worker'),
      '@/merger': resolve(__dirname, './src/merger'),
      '@/converter': resolve(__dirname, './src/converter'),
      '@/parsers': resolve(__dirname, './src/parsers'),
      '@/collector': resolve(__dirname, './src/collector'),
      '@/types.js': resolve(__dirname, './src/types.ts'),
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**'],
    },
  },
})
