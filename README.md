# nextcov

[![npm version](https://badge.fury.io/js/nextcov.svg)](https://badge.fury.io/js/nextcov)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

V8 code coverage for Next.js and Vite applications with Playwright E2E tests.

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

- **Next.js + Vite support** - Works with Next.js and Vite applications
- **Client + Server coverage** - Collects coverage from both browser and Node.js server (Next.js)
- **Client-only mode** - For Vite apps, static sites, SPAs, or deployed environments
- **Dev mode support** - Works with `next dev` (no build required), auto-detected
- **Production mode support** - Works with `next build && next start` using external source maps
- **Auto-detection** - Automatically detects dev vs production mode, no configuration needed
- **V8 native coverage** - Uses Node.js built-in `NODE_V8_COVERAGE` for accurate server coverage
- **Source map support** - Maps bundled code back to original TypeScript/JSX
- **Vitest compatible** - Output merges seamlessly with Vitest coverage reports
- **Playwright integration** - Simple fixtures for automatic coverage collection
- **Istanbul format** - Generates standard coverage-final.json for tooling compatibility
- **Multiple reporters** - HTML, LCOV, JSON, text-summary, and more
- **ESM and CJS support** - Works with both ES modules and CommonJS projects

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
- Next.js 14+ or Vite 5+
- Playwright 1.40+

### Peer Dependencies

```bash
npm install @playwright/test --save-dev
```

## Quick Setup with `nextcov init`

The fastest way to get started is with the `init` command:

```bash
npx nextcov init
```

This interactive command will:
- Create `e2e/global-setup.ts` - Initialize coverage collection
- Create `e2e/global-teardown.ts` - Finalize and generate reports
- Create `e2e/fixtures/test-fixtures.ts` - Coverage collection fixture
- Modify `playwright.config.ts` - Add nextcov configuration
- Modify `package.json` - Add npm scripts (`dev:e2e`, `coverage:merge`)
- Modify `next.config.ts` - Add E2E mode settings for source maps (Next.js only)

### Options

```bash
npx nextcov init                 # Interactive mode
npx nextcov init -y              # Use defaults, no prompts
npx nextcov init --client-only   # Client-only mode (no server coverage)
npx nextcov init --e2e-dir tests # Custom e2e directory
npx nextcov init --js            # Use JavaScript instead of TypeScript
npx nextcov init --force         # Overwrite existing files
```

### Coverage Mode

During interactive setup, you'll be asked to choose a coverage mode:

| Mode | Description | Use When |
|------|-------------|----------|
| **Full (client + server)** | Collects both browser and Node.js coverage | Next.js with `next dev` or `next start` |
| **Client-only** | Only browser coverage, simpler setup | Vite apps, static sites, SPAs, deployed environments |

After running `init`, follow the next steps shown to start collecting coverage.

## Example Projects

### nextcov-example

See [nextcov-example](https://github.com/stevez/nextcov-example) for a simple Next.js App Router application demonstrating nextcov with Playwright E2E tests.

**Highlights:**
- Simple todo CRUD application
- 100% branch coverage achieved with E2E tests
- Demonstrates coverage for client components with conditional rendering

| Metric | Coverage |
|--------|----------|
| Statements | 100% |
| Branches | 100% |
| Functions | 100% |
| Lines | 100% |

### restaurant-reviews-platform

See [restaurant-reviews-platform](https://github.com/stevez/restaurant-reviews-platform) for a complete working example of nextcov integrated with a Next.js App Router application using Playwright E2E tests and Vitest unit tests.

**Highlights:**
- Full-stack Next.js application with authentication
- Combines unit tests (Vitest) with E2E tests (Playwright)
- Demonstrates merging coverage from multiple sources

| Coverage Type | Lines | Description |
|---------------|-------|-------------|
| **Unit Tests** (Vitest) | ~80% | Client components, utilities, API routes |
| **E2E Tests** (Playwright + nextcov) | ~46% | Server components, pages, user flows |
| **Merged** | ~88% | Complete picture of your application |

### Key Files (restaurant-reviews-platform)

- [playwright.config.ts](https://github.com/stevez/restaurant-reviews-platform/blob/main/playwright.config.ts) - Playwright config with nextcov settings
- [e2e/fixtures.ts](https://github.com/stevez/restaurant-reviews-platform/blob/main/e2e/fixtures.ts) - Coverage collection fixture
- [e2e/global-setup.ts](https://github.com/stevez/restaurant-reviews-platform/blob/main/e2e/global-setup.ts) - Start server coverage (auto-detects dev/production)
- [e2e/global-teardown.ts](https://github.com/stevez/restaurant-reviews-platform/blob/main/e2e/global-teardown.ts) - Coverage finalization
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

// Export nextcov config separately for use in global-teardown
export const nextcov: NextcovConfig = {
  cdpPort: 9230,
  buildDir: '.next',           // Next.js build output directory (use 'dist' if customized)
  outputDir: 'coverage/e2e',
  sourceRoot: './src',
  include: ['src/**/*.{ts,tsx,js,jsx}'],
  exclude: [
    'src/**/__tests__/**',
    'src/**/*.test.{ts,tsx}',
    'src/**/*.spec.{ts,tsx}',
  ],
  reporters: ['html', 'lcov', 'json', 'text-summary'],
  log: true,                   // Enable verbose logging (default: false)
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
  nextcov,
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

### 4. Add Global Setup and Teardown

Create `e2e/global-setup.ts`:

```typescript
import * as path from 'path'
import { initCoverage, loadNextcovConfig } from 'nextcov/playwright'

export default async function globalSetup() {
  // Load config from playwright.config.ts
  const config = await loadNextcovConfig(
    path.join(process.cwd(), 'playwright.config.ts')
  )
  // Initialize coverage collection (works for both client-only and full modes)
  await initCoverage(config)
}
```

Create `e2e/global-teardown.ts`:

```typescript
import * as path from 'path'
import { finalizeCoverage } from 'nextcov/playwright'
import { loadNextcovConfig } from 'nextcov'

export default async function globalTeardown() {
  // Load config from playwright.config.ts
  const config = await loadNextcovConfig(
    path.join(process.cwd(), 'playwright.config.ts')
  )
  await finalizeCoverage(config)
}
```

### 5. Write Tests Using the Fixture

In your test files (`e2e/example.spec.ts`):

```typescript
import { test, expect } from './fixtures'

test('should load home page', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading')).toBeVisible()
})
```

### 6. Run Tests

```bash
# Build Next.js with source maps (use E2E_MODE for optimal coverage)
E2E_MODE=true npm run build

# Start the server with V8 coverage enabled and run tests
NODE_V8_COVERAGE=.v8-coverage NODE_OPTIONS='--inspect=9230' npm run start &
npx playwright test

# Or use start-server-and-test for better cross-platform support
npx start-server-and-test 'NODE_V8_COVERAGE=.v8-coverage NODE_OPTIONS=--inspect=9230 npm start' http://localhost:3000 'npx playwright test'
```

The key environment variables:
- `NODE_V8_COVERAGE=.v8-coverage` - Enables Node.js to collect V8 coverage data
- `NODE_OPTIONS='--inspect=9230'` - Enables CDP connection for triggering coverage flush

## Development Mode Coverage

nextcov supports collecting coverage directly from `next dev` without requiring a production build. This is useful for faster iteration during development.

### Auto-Detection

nextcov **automatically detects** whether you're running in dev mode or production mode. You don't need to configure anything - just use the same `globalSetup` and `globalTeardown` for both modes.

How it works:
- **Dev mode** (`next dev --inspect=9230`): Next.js spawns a worker process on port 9231 (inspect port + 1). nextcov connects to the worker via CDP and uses `Profiler.startPreciseCoverage()` to collect coverage.
- **Production mode** (`next start --inspect=9230`): Next.js runs on port 9230 directly. nextcov uses `NODE_V8_COVERAGE` env var to collect coverage, triggered via CDP.

The auto-detection output looks like:
```
📊 Auto-detecting server mode...
  Trying dev mode (worker port 9231)...
  ✓ Dev mode detected (webpack eval scripts found)
  ✓ Server coverage collection started
```

Or for production mode:
```
📊 Auto-detecting server mode...
  Trying dev mode (worker port 9231)...
  ⚠️ Failed to connect to CDP (dev mode): Error: connect ECONNREFUSED
  ℹ️ Production mode will be used (NODE_V8_COVERAGE + port 9230)
```

### Running Tests Against Dev Server

```bash
# Start Next.js dev server with V8 coverage and inspector enabled
NODE_V8_COVERAGE=.v8-coverage NODE_OPTIONS='--inspect=9230' npm run dev &

# Run Playwright tests
npx playwright test
```

### Dev Mode vs Production Mode

| Aspect | Dev Mode | Production Mode |
|--------|----------|-----------------|
| **Server Command** | `next dev` | `next build && next start` |
| **Source Maps** | Inline (base64 in JS) | External (.map files) |
| **Build Required** | No | Yes |
| **Hot Reload** | Yes | No |
| **Build Directory** | Not used (inline source maps) | Configurable (`buildDir`) |
| **CDP Port** | `cdpPort + 1` (e.g., 9231) | `cdpPort` (e.g., 9230) |
| **Performance** | Slower | Faster |
| **Recommended For** | Development iteration | CI/CD, final coverage |

### When to Use Each Mode

- **Dev Mode**: Quick feedback during development, testing new features
- **Production Mode**: CI pipelines, accurate production-like coverage, final reports

Both modes produce identical Istanbul-compatible output that can be merged with Vitest coverage.

## Vite Support

nextcov supports Vite applications with client-only coverage. Vite serves source files directly with inline source maps, making coverage collection straightforward.

### Quick Setup for Vite

```bash
npx nextcov init --client-only
```

This creates the necessary files for client-only coverage collection. Then configure your `playwright.config.ts`:

```typescript
import { defineConfig, devices } from '@playwright/test'
import type { NextcovConfig } from 'nextcov'

export const nextcov: NextcovConfig = {
  outputDir: 'coverage/e2e',
  sourceRoot: './src',
  collectServer: false,  // Client-only mode for Vite
  include: ['src/**/*.{ts,tsx,js,jsx}'],
  exclude: [
    'src/**/__tests__/**',
    'src/**/*.test.{ts,tsx}',
    'src/**/*.spec.{ts,tsx}',
  ],
  reporters: ['html', 'lcov', 'json', 'text-summary'],
}

export default defineConfig({
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:5173',  // Vite default port
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
  // ... other config
})
```

Run your tests:

```bash
npx playwright test
```

Coverage reports will be generated at `coverage/e2e/`.

## Client-Only Mode

For scenarios where you don't need server-side coverage, use `collectServer: false`. This is useful for:

- **Vite applications** - React, Vue, Svelte apps built with Vite
- **Static sites** - Next.js static exports (`next export` or `output: 'export'`)
- **SPAs** - Single page applications with external/serverless backends
- **Deployed environments** - Testing against staging or production URLs
- **Simpler setup** - No `NODE_V8_COVERAGE` or `--inspect` flags needed

### Configuration

Disable server coverage in your `playwright.config.ts`:

```typescript
export const nextcov: NextcovConfig = {
  collectServer: false,  // Skip all server coverage collection
  outputDir: 'coverage/e2e',
  reporters: ['html', 'lcov', 'json', 'text-summary'],
}
```

### Setup

With `collectServer: false`, the setup is simpler (no `--inspect` flags needed):

**1. Coverage fixture** (`e2e/fixtures.ts`) - same as full mode:
```typescript
import { test as base, expect } from '@playwright/test'
import { collectClientCoverage } from 'nextcov/playwright'

export const test = base.extend({
  coverage: [
    async ({ page }, use, testInfo) => {
      await collectClientCoverage(page, testInfo, use)
    },
    { scope: 'test', auto: true },
  ],
})

export { expect }
```

**2. Global setup** (`e2e/global-setup.ts`):
```typescript
import * as path from 'path'
import { initCoverage, loadNextcovConfig } from 'nextcov/playwright'

export default async function globalSetup() {
  const config = await loadNextcovConfig(path.join(process.cwd(), 'playwright.config.ts'))
  await initCoverage(config)  // Initializes client-only mode
}
```

**3. Global teardown** (`e2e/global-teardown.ts`):
```typescript
import * as path from 'path'
import { finalizeCoverage, loadNextcovConfig } from 'nextcov/playwright'

export default async function globalTeardown() {
  const config = await loadNextcovConfig(path.join(process.cwd(), 'playwright.config.ts'))
  await finalizeCoverage(config)  // Only processes client coverage
}
```

**4. Run tests** - no special server flags needed:
```bash
# Just start your server normally and run tests
npm start &
npx playwright test

# Or test against a deployed environment
npx playwright test --config=playwright.staging.config.ts
```

### When to Use Client-Only Mode

| Scenario | Use `collectServer: false`? |
|----------|------------------|
| Testing Next.js with `next dev` or `next start` | No - use full mode for server coverage |
| Testing static export (`next export`) | Yes |
| Testing against deployed staging/production | Yes |
| Testing SPA with external API | Yes |
| Quick local testing without inspector setup | Yes |

### Behavior

When `collectServer: false`:
- `startServerCoverage()` becomes a no-op (safe to call, does nothing)
- `finalizeCoverage()` only processes client-side coverage from Playwright
- No CDP connection attempts are made

### Server-Only Mode

For scenarios where you only want server coverage (e.g., API testing without browser), use `collectClient: false`:

```typescript
export const nextcov: NextcovConfig = {
  collectClient: false,  // Skip client coverage collection
  outputDir: 'coverage/e2e',
}
```

When `collectClient: false`:
- `collectClientCoverage()` still needs to be called (for test fixtures), but collected data is ignored during finalization
- `finalizeCoverage()` only processes server-side coverage

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

### Using the CLI (Recommended)

The simplest way to merge coverage is using the `nextcov` CLI:

```bash
# Merge unit and E2E coverage
npx nextcov merge coverage/unit coverage/e2e -o coverage/merged

# Merge multiple coverage directories
npx nextcov merge coverage/unit coverage/e2e coverage/browser -o coverage/all

# Customize reporters
npx nextcov merge coverage/unit coverage/e2e --reporters html,lcov,json
```

Add to your `package.json`:

```json
{
  "scripts": {
    "coverage:merge": "npx nextcov merge coverage/unit coverage/integration -o coverage/merged"
  }
}
```

### CLI Reference

```
Usage: npx nextcov merge <dirs...> [options]

Merge multiple coverage directories into a single report.

By default, coverage directives (import statements, 'use client', 'use server')
are stripped from the coverage data before merging. This ensures accurate merged
coverage when combining unit/component tests with E2E tests.

Arguments:
  dirs                  Coverage directories to merge (must contain coverage-final.json)

Options:
  -o, --output <dir>    Output directory for merged report (default: ./coverage/merged)
  --reporters <list>    Comma-separated reporters: html,lcov,json,text-summary (default: html,lcov,json,text-summary)
  --no-strip            Disable stripping of import statements and directives
  --help                Show this help message

Examples:
  npx nextcov merge coverage/unit coverage/integration
  npx nextcov merge coverage/unit coverage/e2e coverage/browser -o coverage/merged
  npx nextcov merge coverage/unit coverage/integration --reporters html,lcov
```

### Why Strip Directives?

When merging unit/component test coverage with E2E test coverage, you may encounter mismatched statement counts for the same file. This happens because:

- **Unit/component tests** (Vitest) see import statements and directives as executable statements
- **E2E tests** (Next.js bundled code) don't include imports or directives in coverage data

The `--no-strip` option is available if you want to preserve the original coverage data, but the default stripping behavior produces more accurate merged reports.

### Using the API (Advanced)

For more control, you can use the programmatic API:

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

#### `initCoverage(config?)`

Initializes coverage collection. This is the recommended function to call in globalSetup. It handles both client-only and full (client + server) modes:

- **Client-only mode** (`collectServer: false`): Just initializes logging/timing settings. No server connection is made.
- **Full mode** (`collectServer: true`): Connects to the Next.js server via CDP to collect server-side coverage.

```typescript
import { initCoverage, loadNextcovConfig } from 'nextcov/playwright'

const config = await loadNextcovConfig('./playwright.config.ts')
await initCoverage(config)
```

#### `startServerCoverage(config?)`

Starts server-side coverage collection. Lower-level function called by `initCoverage` for full mode. Auto-detects dev mode vs production mode.

```typescript
import { startServerCoverage, loadNextcovConfig } from 'nextcov/playwright'

const config = await loadNextcovConfig('./playwright.config.ts')
await startServerCoverage(config)
```

Returns `true` if dev mode was detected, `false` for production mode.

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
| `buildDir` | `string` | `'.next'` | Next.js build output directory |
| `outputDir` | `string` | `'coverage/e2e'` | Output directory for reports |
| `sourceRoot` | `string` | `'./src'` | Source root relative to project |
| `include` | `string[]` | `['src/**/*']` | Glob patterns to include |
| `exclude` | `string[]` | `['node_modules/**']` | Glob patterns to exclude |
| `reporters` | `string[]` | `['html', 'lcov', 'json']` | Report formats |
| `collectServer` | `boolean` | `true` | Collect server-side coverage (set `false` for static sites, SPAs) |
| `collectClient` | `boolean` | `true` | Collect client-side coverage from Playwright |
| `cleanup` | `boolean` | `true` | Clean up temp files |
| `cdpPort` | `number` | `9230` | CDP port for triggering v8.takeCoverage() |
| `log` | `boolean` | `false` | Enable verbose logging output |

### Main API (`nextcov`)

The main `nextcov` entry point exports a minimal public API. Most users should import from `nextcov/playwright` instead (see above).

#### Configuration Types

Used primarily for TypeScript definitions in `playwright.config.ts`:

```typescript
import type { NextcovConfig } from 'nextcov'

export const nextcov: NextcovConfig = {
  outputDir: 'coverage/e2e',
  sourceRoot: './src',
  // ... other options
}
```

#### `loadNextcovConfig(configPath?)`

Loads nextcov configuration from playwright.config.ts. Typically used in global-setup/teardown files.

```typescript
import { loadNextcovConfig } from 'nextcov'

const config = await loadNextcovConfig('./e2e/playwright.config.ts')
```

#### `mergeCoverage(options)`

Programmatically merge coverage reports. For most use cases, prefer the CLI: `npx nextcov merge`.

```typescript
import { mergeCoverage } from 'nextcov'

const result = await mergeCoverage({
  unitCoveragePath: './coverage/unit/coverage-final.json',
  e2eCoveragePath: './coverage/e2e/coverage-final.json',
  outputDir: './coverage/merged',
  reporters: ['html', 'lcov', 'json'],
  verbose: false,
  projectRoot: process.cwd(),
})
```

#### Helper Functions

For custom merge scripts:

```typescript
import {
  printCoverageSummary,
  printCoverageComparison,
  type MergeCoverageResult,
} from 'nextcov'

// Print formatted coverage summary
printCoverageSummary(result.summary, 'Merged Coverage')

// Print comparison between unit and E2E coverage
printCoverageComparison(result.unitSummary, result.e2eSummary, result.summary)
```

## How It Works

1. **Coverage Collection**
   - Client: Uses Playwright's CDP integration to collect V8 coverage from the browser
   - Server: Uses Node.js `NODE_V8_COVERAGE` env var to collect coverage, triggered via CDP `v8.takeCoverage()`

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

- Ensure Next.js is started with `NODE_V8_COVERAGE=.v8-coverage` and `NODE_OPTIONS='--inspect=9230'`
- Verify the CDP port matches your config
- Check that `globalTeardown` calls `finalizeCoverage()`

### Source Maps Not Found

- Run `npm run build` with `E2E_MODE=true`
- Check `.next/static/chunks/` for `.map` files
- Ensure webpack `devtool` is set to `'source-map'`

### Dev Mode Coverage Not Working

- Ensure Next.js dev server is started with `NODE_V8_COVERAGE=.v8-coverage` and `NODE_OPTIONS='--inspect=9230'`
- Check that your source files are in the `sourceRoot` directory (default: `src`)

### Inconsistent Branch Counts Between Unit and E2E Tests

If you notice E2E coverage has more branches than unit tests for the same file, it's likely because Next.js is transpiling optional chaining (`?.`) and nullish coalescing (`??`) operators.

**The problem:**
- Source code: `existingReview?.rating ?? 5`
- Transpiled: `existingReview === null || existingReview === void 0 ? void 0 : existingReview.rating`
- Unit tests see 1 branch (source), E2E sees 3 branches (transpiled)

**The solution:** Add a `browserslist` to your `package.json` targeting modern browsers:

```json
{
  "browserslist": [
    "chrome 111",
    "edge 111",
    "firefox 111",
    "safari 16.4"
  ]
}
```

This tells Next.js SWC to preserve `?.` and `??` operators since modern browsers support them natively. After adding this, rebuild your app and branch counts should be consistent.

**Note:** These browser versions match the [Next.js recommended modern targets](https://nextjs.org/docs/architecture/supported-browsers). Adjust based on your actual browser support requirements.

### V8 Does Not Track Ternary Operators and && Patterns Returning JSX

V8 coverage has a known limitation: it does not properly track branch coverage for ternary operators (`? :`) and logical AND (`&&`) patterns when they return JSX.

**The problem:**

```tsx
// These patterns are NOT tracked by V8 coverage
function MyComponent({ user }) {
  return (
    <div>
      {user ? <LoggedIn /> : <LoggedOut />}  {/* ternary - not tracked */}
      {user && <Welcome name={user.name} />}  {/* && pattern - not tracked */}
    </div>
  )
}
```

V8 sees these as expressions, not branches, so even if your tests exercise both paths, the coverage report may show them as uncovered or only partially covered.

**The solution:** Refactor to use `if` statements with early returns in helper components:

```tsx
// These patterns ARE properly tracked by V8 coverage
function UserGreeting({ user }: { user: User | null }) {
  if (!user) {
    return <LoggedOut />
  }
  return <LoggedIn />
}

function WelcomeMessage({ user }: { user: User | null }) {
  if (!user) {
    return null
  }
  return <Welcome name={user.name} />
}

function MyComponent({ user }) {
  return (
    <div>
      <UserGreeting user={user} />
      <WelcomeMessage user={user} />
    </div>
  )
}
```

**Why this works:**
- `if` statements are recognized as proper branches by V8
- Each branch path is tracked separately
- Coverage reports accurately show which branches were executed

**When to refactor:**
- When you notice branch coverage gaps between unit tests and E2E tests
- When merged coverage shows uncovered branches that you know are tested
- When you need accurate branch coverage metrics for CI/CD gates

**Note:** This is a V8 limitation, not a nextcov issue. The same behavior occurs with Vitest's V8 coverage provider. The refactoring pattern shown above ensures consistent, accurate branch coverage across all V8-based coverage tools.

### Slow Coverage Processing

If coverage processing takes a very long time (30+ seconds), you may have large bundled dependencies. V8 coverage works on the bundled output, so large libraries bundled into your app will slow down source map processing.

**Common culprits:**
- `react-icons` - Barrel exports bundle entire icon sets even when importing a few icons
- Large UI component libraries
- Unoptimized imports from `lodash`, `@mui/icons-material`, etc.

**Solutions:**
1. **Use direct imports** instead of barrel imports:
   ```typescript
   // Bad - bundles entire icon set
   import { FiEdit } from 'react-icons/fi'

   // Good - import only what you need
   import FiEdit from 'react-icons/fi/FiEdit'
   ```

2. **Use inline SVGs** for icons you use frequently:
   ```tsx
   // Best for small icon sets - zero runtime cost
   export const EditIcon = ({ size = 24 }) => (
     <svg width={size} height={size} viewBox="0 0 24 24">
       <path d="..." />
     </svg>
   )
   ```

3. **Enable optimizePackageImports** in Next.js config:
   ```js
   experimental: {
     optimizePackageImports: ['react-icons', 'lodash'],
   }
   ```

4. **Check your bundle size**: If `.next/server/app/page.js` is several MB, you likely have bundle bloat. A lean app should have page bundles under 500KB.

## License

MIT
