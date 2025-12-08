# nextcov

Collect V8 code coverage for Playwright E2E tests in Next.js applications.

## Features

- Collects client-side V8 coverage from Playwright tests
- Maps bundled code back to original source files using source maps
- Generates Istanbul-compatible coverage reports (HTML, LCOV, etc.)
- Works with Next.js production builds

## Installation

```bash
npm install nextcov --save-dev
```

## Requirements

- Node.js >= 18
- Next.js 14+
- Playwright 1.40+

### Peer Dependencies

```bash
npm install @playwright/test istanbul-lib-coverage istanbul-lib-report istanbul-reports --save-dev
```

## Usage

### 1. Configure Next.js for Source Maps

In your `next.config.js`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  productionBrowserSourceMaps: true,
}

module.exports = nextConfig
```

### 2. Add Coverage Fixture to Playwright

Create a test fixtures file (`e2e/fixtures.ts`):

```typescript
import { test as base } from '@playwright/test'
import { collectClientCoverage } from 'nextcov/playwright'

export const test = base.extend({
  coverage: [
    async ({ page }, use, testInfo) => {
      await collectClientCoverage(page, testInfo, use)
    },
    { scope: 'test', auto: true },
  ],
})

export { expect } from '@playwright/test'
```

### 3. Configure Playwright

In your `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test'
import { nextcovConfig } from 'nextcov/playwright'

export default defineConfig({
  ...nextcovConfig({
    // Coverage output directory
    coverageDir: 'coverage/e2e',
    // Source files to include
    include: ['src/**/*.{ts,tsx}'],
    // Files to exclude
    exclude: ['**/*.test.*', '**/__tests__/**'],
    // Report formats
    reports: ['html', 'lcov', 'text-summary'],
  }),
  // Your other Playwright config...
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:3000',
  },
})
```

### 4. Run Tests with Coverage

```bash
# Build Next.js with source maps
npm run build

# Start the server and run tests
npm run start & npx playwright test
```

## API

### `collectClientCoverage(page, testInfo, use)`

Collects V8 coverage for a single test. Call this in a Playwright fixture.

### `nextcovConfig(options)`

Returns Playwright reporter configuration for coverage collection.

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `coverageDir` | `string` | `'coverage/e2e'` | Output directory for coverage files |
| `include` | `string[]` | `['src/**/*']` | Glob patterns for files to include |
| `exclude` | `string[]` | `['node_modules/**']` | Glob patterns for files to exclude |
| `reports` | `string[]` | `['html', 'lcov']` | Istanbul report formats to generate |
| `buildDir` | `string` | `'.next'` | Next.js build output directory |

## How It Works

1. **Coverage Collection**: Uses Chrome DevTools Protocol (CDP) to collect V8 coverage data from the browser during test execution
2. **Source Mapping**: Maps bundled JavaScript back to original TypeScript/JSX source files using source maps
3. **Report Generation**: Converts V8 coverage to Istanbul format and generates reports

## Merging with Unit Test Coverage

To merge E2E coverage with unit test coverage:

```bash
# Generate unit test coverage
npm run test -- --coverage

# Generate E2E coverage
npx playwright test

# Merge coverage reports
npx nyc merge coverage coverage/merged
npx nyc report --temp-dir coverage/merged --reporter=html
```

## License

MIT
