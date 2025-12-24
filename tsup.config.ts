import { defineConfig } from 'tsup'

export default defineConfig([
  // Main entry point
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    outDir: 'dist',
    splitting: false,
    sourcemap: false,
    target: 'node20',
    external: ['@playwright/test'],
    shims: true, // Add shims for import.meta in CJS
    cjsInterop: true, // Handle ESM default exports in CJS
  },
  // Playwright submodule
  {
    entry: ['src/playwright/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    outDir: 'dist/playwright',
    splitting: false,
    sourcemap: false,
    target: 'node20',
    external: ['@playwright/test'],
    shims: true,
    cjsInterop: true,
  },
  // CLI entry (ESM only, executable)
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    outDir: 'dist',
    splitting: false,
    sourcemap: false,
    target: 'node20',
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  // Worker file (used by worker_threads, must be separate file)
  {
    entry: ['src/ast-worker.ts'],
    format: ['esm'],
    outDir: 'dist',
    splitting: false,
    sourcemap: false,
    target: 'node20',
  },
])
