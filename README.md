# nextcov

[![npm version](https://badge.fury.io/js/nextcov.svg)](https://badge.fury.io/js/nextcov)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

V8 code coverage for Next.js applications with Playwright E2E tests.

Merge your Playwright E2E coverage with Vitest unit test coverage for complete coverage reports.

## Why nextcov?

### The React Server Components Testing Gap

Next.js App Router introduced React Server Components (RSC) and async server components. These are notoriously difficult to unit test because:

- **Server Components run only on the server** - They can't be rendered in jsdom or similar test environments
- **Async components fetch data directly** - Mocking becomes complex and often unreliable
- **Tight coupling with Next.js runtime** - Server actions, cookies, headers require the full framework

**The practical solution?** Test server components through E2E tests with Playwright, where they run in their natural environment. But until now, there was no good way to get coverage for these tests.

### The Coverage Problem

But this creates a coverage gap:
- **Unit tests** (Vitest) cover client components, utilities, and hooks
- **E2E tests** (Playwright) cover server components, pages, and user flows
- **No unified coverage** - You're missing the full picture

Getting accurate combined coverage is challenging because:
- Playwright runs against production builds (bundled, minified code)
- Source maps are needed to map back to original TypeScript/JSX
- Different coverage formats need to be merged correctly

### The Solution

**nextcov** is the first tool to bridge this gap by:
- Collecting V8 coverage from both client and server during E2E tests
- Using source maps to map bundled code back to original sources
- Producing Istanbul-compatible output that merges seamlessly with Vitest coverage

Now you can finally see the complete coverage picture for your Next.js application.

## Features

- **Next.js focused** - Built specifically for Next.js applications
- **Client + Server coverage** - Collects coverage from both browser and Node.js server
- **Source map support** - Maps bundled production code back to original TypeScript/JSX
- **Vitest compatible** - Output merges seamlessly with Vitest coverage reports
- **Playwright integration** - Simple fixtures for automatic coverage collection
- **Istanbul format** - Generates standard coverage-final.json for tooling compatibility
- **Multiple reporters** - HTML, LCOV, JSON, text-summary, and more

## Inspiration

This project is inspired by and builds upon:
- [Vitest](https://vitest.dev/) - For the V8 coverage approach and Istanbul integration
- [ast-v8-to-istanbul](https://github.com/AriPerkkio/ast-v8-to-istanbul) - For AST-based V8 to Istanbul conversion
- [monocart-coverage-reports](https://github.com/cenfun/monocart-coverage-reports) - For V8 coverage processing

## Installation

```bash
npm install nextcov --save-dev
```

## Requirements

- Node.js >= 20
- Next.js 14+
- Playwright 1.40+

### Peer Dependencies

```bash
npm install @playwright/test istanbul-lib-coverage istanbul-lib-report istanbul-reports --save-dev
```

## Example Project

See [restaurant-reviews-platform](https://github.com/stevez/restaurant-reviews-platform) for a complete working example of nextcov integrated with a Next.js App Router application using Playwright E2E tests and Vitest unit tests.

### Coverage Results

The example project demonstrates how nextcov bridges the coverage gap:

| Coverage Type | Lines | Description |
|---------------|-------|-------------|
| **Unit Tests** (Vitest) | ~80% | Client components, utilities, API routes |
| **E2E Tests** (Playwright + nextcov) | ~46% | Server components, pages, user flows |
| **Merged** | ~88% | Complete picture of your application |

### Key Files

- [e2e/playwright.config.ts](https://github.com/stevez/restaurant-reviews-platform/blob/main/e2e/playwright.config.ts) - Playwright config with nextcov settings
- [e2e/fixtures.ts](https://github.com/stevez/restaurant-reviews-platform/blob/main/e2e/fixtures.ts) - Coverage collection fixture
- [e2e/global-setup.ts](https://github.com/stevez/restaurant-reviews-platform/blob/main/e2e/global-setup.ts) - Server coverage setup
- [e2e/global-teardown.ts](https://github.com/stevez/restaurant-reviews-platform/blob/main/e2e/global-teardown.ts) - Coverage finalization
- [scripts/merge-coverage.ts](https://github.com/stevez/restaurant-reviews-platform/blob/main/scripts/merge-coverage.ts) - Merge unit + E2E coverage
- [next.config.js](https://github.com/stevez/restaurant-reviews-platform/blob/main/next.config.js) - Next.js source map configuration

## Quick Start

### 1. Configure Next.js for Source Maps

In your `next.config.js`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable source maps for production builds (required for coverage)
  productionBrowserSourceMaps: true,

  // Optional: Configure webpack for E2E mode
  webpack: (config, { dev }) => {
    if (process.env.E2E_MODE) {
      // Use full source maps for accurate coverage
      config.devtool = 'source-map'

      // Disable minification to preserve readable code
      config.optimization = {
        ...config.optimization,
        minimize: false,
      }
    }
    return config
  },
}

module.exports = nextConfig
```

### 2. Configure Playwright with nextcov

In your `playwright.config.ts`:

```typescript
import { defineConfig, devices } from '@playwright/test'
import type { NextcovConfig } from 'nextcov'

// Extend Playwright config type to include nextcov
type PlaywrightConfigWithNextcov = Parameters<typeof defineConfig>[0] & {
  nextcov?: NextcovConfig
}

const config: PlaywrightConfigWithNextcov = {
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'http://localhost:3000',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Nextcov configuration
  nextcov: {
    cdpPort: 9230,
    outputDir: 'coverage/e2e',
    sourceRoot: './src',
    include: ['src/**/*.{ts,tsx,js,jsx}'],
    exclude: [
      'src/**/__tests__/**',
      'src/**/*.test.{ts,tsx}',
      'src/**/*.spec.{ts,tsx}',
    ],
    reporters: ['html', 'lcov', 'json', 'text-summary'],
  },
}

export default defineConfig(config)
```

### 3. Add Coverage Fixture

Create `e2e/fixtures.ts`:

```typescript
import { test as base, expect } from '@playwright/test'
import { collectClientCoverage } from 'nextcov/playwright'

export const test = base.extend({
  // Auto-collect v8 coverage for each test
  coverage: [
    async ({ page }, use, testInfo) => {
      await collectClientCoverage(page, testInfo, use)
    },
    { scope: 'test', auto: true },
  ],
})

export { expect }
```

### 4. Add Global Setup

Create `e2e/global-setup.ts`:

```typescript
import * as path from 'path'
import { connectToCDP, loadNextcovConfig } from 'nextcov'

export default async function globalSetup() {
  // Load config from playwright.config.ts
  const config = await loadNextcovConfig(
    path.join(process.cwd(), 'e2e', 'playwright.config.ts')
  )

  // Connect to server for coverage collection
  console.log('Setting up server coverage...')
  await connectToCDP({ port: config.cdpPort })
}
```

### 5. Add Global Teardown

Create `e2e/global-teardown.ts`:

```typescript
import * as path from 'path'
import type { FullConfig } from '@playwright/test'
import { finalizeCoverage } from 'nextcov/playwright'
import { loadNextcovConfig } from 'nextcov'

export default async function globalTeardown(_config: FullConfig) {
  // Load config from playwright.config.ts
  const config = await loadNextcovConfig(
    path.join(process.cwd(), 'e2e', 'playwright.config.ts')
  )
  await finalizeCoverage(config)
}
```

### 6. Write Tests Using the Fixture

In your test files (`e2e/example.spec.ts`):

```typescript
import { test, expect } from './fixtures'

test('should load home page', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading')).toBeVisible()
})
```

### 7. Run Tests

```bash
# Build Next.js with source maps (use E2E_MODE for optimal coverage)
E2E_MODE=true npm run build

# Start the server with inspector enabled and run tests
NODE_OPTIONS='--inspect=9230' npm run start &
npx playwright test

# Or use start-server-and-test for better cross-platform support
npx start-server-and-test 'NODE_OPTIONS=--inspect=9230 npm start' http://localhost:3000 'npx playwright test'
```

## Merging with Vitest Coverage

The main power of nextcov is combining E2E coverage with unit test coverage.

### Configure Vitest for Coverage

In your `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['json', 'html'],
      reportsDirectory: './coverage/unit',
    },
  },
})
```

### Create a Merge Script

Create `scripts/merge-coverage.ts`:

```typescript
import * as path from 'path'
import {
  mergeCoverage,
  printCoverageSummary,
  printCoverageComparison,
} from 'nextcov'

const projectRoot = process.cwd()

async function main() {
  console.log('Merging coverage reports...\n')

  const result = await mergeCoverage({
    unitCoveragePath: path.join(projectRoot, 'coverage/unit/coverage-final.json'),
    e2eCoveragePath: path.join(projectRoot, 'coverage/e2e/coverage-final.json'),
    outputDir: path.join(projectRoot, 'coverage/merged'),
    projectRoot,
    verbose: true,
  })

  if (!result) {
    console.error('Failed to merge coverage')
    process.exit(1)
  }

  // Print merged summary
  printCoverageSummary(result.summary, 'Merged Coverage Summary')

  // Print comparison
  if (result.unitSummary) {
    printCoverageComparison(result.unitSummary, result.e2eSummary, result.summary)
  }

  // List E2E-only files
  if (result.e2eOnlyFiles.length > 0) {
    console.log(`\nE2E-only files (${result.e2eOnlyFiles.length}):`)
    for (const file of result.e2eOnlyFiles) {
      console.log(`  - ${file}`)
    }
  }
}

main().catch(console.error)
```

Run with:

```bash
npx ts-node --esm scripts/merge-coverage.ts
```

## API Reference

### Playwright Integration (`nextcov/playwright`)

#### `collectClientCoverage(page, testInfo, use)`

Collects V8 coverage for a single test. Use in a Playwright fixture.

```typescript
await collectClientCoverage(page, testInfo, use)
```

#### `finalizeCoverage(options?)`

Finalizes coverage collection and generates reports. Call in globalTeardown.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `projectRoot` | `string` | `process.cwd()` | Project root directory |
| `outputDir` | `string` | `'coverage/e2e'` | Output directory for reports |
| `sourceRoot` | `string` | `'./src'` | Source root relative to project |
| `include` | `string[]` | `['src/**/*']` | Glob patterns to include |
| `exclude` | `string[]` | `['node_modules/**']` | Glob patterns to exclude |
| `reporters` | `string[]` | `['html', 'lcov', 'json']` | Report formats |
| `collectServer` | `boolean` | `true` | Collect server-side coverage |
| `collectClient` | `boolean` | `true` | Collect client-side coverage |
| `cleanup` | `boolean` | `true` | Clean up temp files |

### Main API (`nextcov`)

#### `loadNextcovConfig(configPath?)`

Loads nextcov configuration from playwright.config.ts.

```typescript
import { loadNextcovConfig } from 'nextcov'

const config = await loadNextcovConfig('./e2e/playwright.config.ts')
```

#### `connectToCDP(options)`

Connects to Node.js server via Chrome DevTools Protocol for server coverage.

```typescript
import { connectToCDP } from 'nextcov'

await connectToCDP({ port: 9230 })
```

#### `mergeCoverage(options)`

Merges unit and E2E coverage reports.

```typescript
const result = await mergeCoverage({
  unitCoveragePath: './coverage/unit/coverage-final.json',
  e2eCoveragePath: './coverage/e2e/coverage-final.json',
  outputDir: './coverage/merged',
  reporters: ['html', 'lcov', 'json'],
  verbose: false,
  projectRoot: process.cwd(),
})
```

#### `CoverageProcessor`

Low-level class for processing V8 coverage.

```typescript
import { CoverageProcessor } from 'nextcov'

const processor = new CoverageProcessor(projectRoot, {
  outputDir: './coverage',
  sourceRoot: './src',
  include: ['src/**/*.{ts,tsx}'],
  exclude: ['**/*.test.*'],
  reporters: ['html', 'json'],
})

const result = await processor.processAllCoverage(v8CoverageEntries)
```

#### `CoverageMerger`

Class for merging coverage maps with different strategies.

```typescript
import { CoverageMerger } from 'nextcov'

const merger = new CoverageMerger({
  strategy: 'max',        // 'max' | 'add' | 'prefer-first' | 'prefer-last'
  applyFixes: true,       // Apply coverage fixes
})

const merged = await merger.merge(map1, map2, map3)
```

## How It Works

1. **Coverage Collection**
   - Client: Uses Playwright's CDP integration to collect V8 coverage from the browser
   - Server: Connects to Next.js server via CDP to collect Node.js coverage

2. **Source Mapping**
   - Loads source maps from Next.js build output (`.next/`)
   - Handles inline source maps and external `.map` files
   - Maps bundled JavaScript back to original TypeScript/JSX

3. **Format Conversion**
   - Converts V8 coverage format to Istanbul format using AST analysis
   - Preserves accurate line, function, and branch coverage

4. **Merging**
   - Merges coverage from multiple sources (unit tests, E2E tests)
   - Uses intelligent strategies to combine coverage data
   - Handles different instrumentation structures

5. **Report Generation**
   - Generates Istanbul-compatible reports (HTML, LCOV, JSON, etc.)
   - Compatible with standard coverage tools and CI integrations

## Troubleshooting

### 0% Coverage

- Ensure `productionBrowserSourceMaps: true` is set in `next.config.js`
- Verify source maps exist in `.next/static/chunks/*.map`
- Check that `E2E_MODE=true` is set when building

### Server Coverage Not Working

- Ensure Next.js is started with `NODE_OPTIONS='--inspect=9230'`
- Verify the CDP port matches your config
- Check that `globalSetup` calls `connectToCDP()`

### Source Maps Not Found

- Run `npm run build` with `E2E_MODE=true`
- Check `.next/static/chunks/` for `.map` files
- Ensure webpack `devtool` is set to `'source-map'`

## License

MIT
