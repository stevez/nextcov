# Changelog

All notable changes to this project will be documented in this file.

## [0.12.1] - 2024-12-27

### Added

- **Dependencies** - Added for enhanced check command output
  - `chalk@^4.1.2` - Terminal color output for ESLint-style formatting

- **Documentation** - Enhanced README with comprehensive CLI command reference
  - Added "CLI Commands" section documenting all three commands (`init`, `merge`, `check`)
  - Added "Detecting V8 Coverage Blind Spots" section with problem description, solutions, and real-world impact
  - Included before/after code examples showing how to fix blind spots
  - Added CI integration examples for GitHub Actions
  - Documented real-world metrics: refactoring JSX patterns increased trackable branches from 433 to 445 (+12 paths)

### Changed

- **Console Reporter** - Enhanced with colored output using chalk
  - ESLint-style colored output for better readability
  - Bold code snippets in verbose mode
  - Color-coded file paths, warnings, and messages

## [0.12.0] - 2024-12-26

### Added

- **New `check` CLI command** - Scan codebase for V8 coverage blind spots in JSX code
  - Detects JSX ternary operators: `{cond ? <A /> : <B />}` that V8 cannot track for branch coverage
  - Detects JSX logical AND operators: `{cond && <Component />}` that V8 cannot track for branch coverage
  - Only flags patterns inside JSX expression containers (`{...}`), not variable assignments
  - Usage: `npx nextcov check [paths...] [options]`
  - Options:
    - `--verbose` - Show code snippets in console output
    - `--json` - Output results as JSON
    - `--ignore-patterns` - Exit with 0 even if issues found (for CI warnings)
  - Returns exit code 0 (clean), 1 (issues found), or 2 (error)
  - Scans `.js`, `.jsx`, `.ts`, `.tsx` files
  - Automatically ignores `node_modules/`, `.next/`, `dist/`, `build/`, `.git/`, `coverage/`, test files
  - Example: `npx nextcov check src/ --verbose`

- **JSX Pattern Detector** - AST-based detection using Babel parser
  - Uses `@babel/parser` to parse JSX/TypeScript code into AST
  - Uses `@babel/traverse` to walk AST and find problematic patterns
  - Gracefully handles syntax errors and non-JSX files
  - Tracks parent nodes to distinguish JSX expression containers from variable assignments
  - Extracts code snippets for verbose output
  - Comprehensive test suite with 18 tests (92.68% statement coverage)

- **File Scanner** - Glob-based directory scanning
  - Scans directories recursively for JS/TS files
  - Supports specific file paths or directory patterns
  - Custom ignore patterns support
  - Cross-platform path normalization (forward slashes on all platforms)
  - Comprehensive test suite with 13 tests (95% statement coverage)

- **Console Reporter** - Formatted output for scan results
  - Human-readable console output with file:line:column locations
  - JSON output mode for programmatic consumption
  - Verbose mode with code snippets
  - Issue grouping by file
  - Help text with remediation guidance
  - Comprehensive test suite with 13 tests (100% coverage)

- **Dependencies** - Added for JSX pattern detection
  - `@babel/traverse@^7.28.5` - AST traversal with visitor pattern
  - `@types/babel__traverse@^7.28.0` - TypeScript type definitions

### Changed

- **CLI bundle size increased** - From 74 KB to 80.13 KB (~8% increase)
  - Babel dependencies added for JSX pattern detection (~6 KB impact)
  - Acceptable trade-off for check command functionality

### Tests

- **Improved test coverage** - Added 56 new tests across 4 test files
  - Total tests: 742 passing (up from 686)
  - New test files:
    - `src/linter/detectors/__tests__/jsx-patterns.test.ts` (18 tests)
    - `src/linter/__tests__/scanner.test.ts` (13 tests)
    - `src/linter/__tests__/reporter.test.ts` (13 tests)
    - `src/cli/commands/__tests__/check.test.ts` (12 tests)
  - Linter module coverage: 98.46% statement, 100% branch, 100% function

## [0.11.2] - 2024-12-26

### Changed

- **Reduced public API surface for smaller bundle size** - Minimized main entry point exports
  - Removed 60+ internal exports from `src/index.ts` that users should never import directly
  - Removed default value exports (`DEFAULT_NEXTCOV_CONFIG`, `DEFAULT_INCLUDE_PATTERNS`, etc.) - only needed internally
  - Removed utility function exports (`normalizePath`) - only needed internally
  - Kept only 5 essential runtime exports: `loadNextcovConfig`, `resolveNextcovConfig`, `mergeCoverage`, `printCoverageSummary`, `printCoverageComparison`
  - Type definitions (`NextcovConfig`, etc.) remain available for TypeScript users
  - Most users import from `nextcov/playwright` instead of main entry point
  - Bundle size reduced from 143 KB to 27.28 KB (~81% reduction)
  - Updated [README.md](README.md#L742-L803) API documentation to reflect minimal public API

## [0.11.1] - 2024-12-26

### Changed

- **Comprehensive codebase reorganization** - Restructured entire codebase into focused domain folders for better maintainability and scalability
  - **Phase 1** (v0.11.0): Split `converter.ts` and `constants.ts` into modular `converter/` and `parsers/` folders
  - **Phase 2**: Organized utilities into `utils/` folder
    - Moved `config.ts`, `logger.ts`, `constants.ts`, `dev-mode-extractor.ts` to `src/utils/`
    - Created `utils/index.ts` for centralized exports
  - **Phase 3**: Organized CLI into `cli/` folder structure
    - Split `cli.ts` into `cli/commands/merge.ts` and `cli/index.ts`
    - Moved `init.ts` to `cli/commands/init.ts`
    - Created `cli/index.ts` as main CLI entry point
  - **Phase 4**: Organized core processing modules into `core/` folder
    - Moved `processor.ts`, `v8-reader.ts`, `reporter.ts`, `sourcemap-loader.ts` to `src/core/`
    - Created `core/index.ts` for centralized exports
    - Removed unnecessary `converter.ts` re-export layer
  - **Phase 5**: Organized worker modules into `worker/` folder
    - Moved `ast-worker.ts` and `worker-pool.ts` to `src/worker/`
    - Created `worker/index.ts` for centralized exports
    - Updated worker path resolution for new `dist/worker/` build location
    - Updated tsup config to output workers to `dist/worker/`
  - **Phase 6**: Organized merger module into `merger/` folder
    - Split `merger.ts` (968 lines) into 3 focused files:
      - `merger/core.ts` (842 lines) - CoverageMerger class and merging logic
      - `merger/printer.ts` (65 lines) - Console output formatting
      - `merger/utils.ts` (86 lines) - Helper functions and lookups
    - Created `merger/index.ts` for centralized exports

- **Refactored imports to use TypeScript path aliases** - Replaced relative imports (`../../`) with clean `@/` prefix
  - Configured TypeScript path aliases in [tsconfig.json](tsconfig.json#L24-L35) with `@/*` mappings
  - Added [tsc-alias](https://www.npmjs.com/package/tsc-alias) to build script for path resolution in compiled JavaScript
  - Updated [vitest.config.ts](vitest.config.ts#L6-L17) with resolve.alias configuration
  - Migrated 35+ files across all modules (cli, core, converter, merger, utils, worker, collector, parsers)
  - Updated dynamic imports and vi.mock paths in CLI commands and tests

### Internal

- **Build system enhancement** - Added tsc-alias step after tsup compilation
  - Build script now: `tsup && tsc-alias` to resolve path aliases in output
- **TypeScript error fixes** - Fixed type inference issues in test files
  - Added `FileCoverageData` type casts to `.toJSON()` calls in coverage tests
  - Fixed incorrect test assertions with extra parameters
  - Removed non-existent exports (`setVerbose`, `WorkerResult`)
- **New folder structure** - Codebase now organized into 9 domain-focused folders:
  - `cli/` - Command-line interface and commands
  - `core/` - Core processing modules (processor, reporter, reader, source maps)
  - `utils/` - Shared utilities (config, logger, constants, extractors)
  - `worker/` - Worker thread parallelization
  - `merger/` - Coverage merging logic
  - `converter/` - V8-to-Istanbul conversion
  - `parsers/` - Bundler-specific URL parsers
  - `collector/` - Coverage collection (CDP, dev mode, production)
  - `playwright/` - Playwright test fixtures
- All 686 tests passing with full TypeScript type checking
- No API changes - this is purely an internal code organization improvement

## [0.11.0] - 2024-12-26

### Changed

- **Refactored converter and parsers into modular structure** - Split large monolithic files into focused modules for better maintainability
  - Split `converter.ts` (2,117 lines) into `converter/` folder with 4 modules:
    - `converter/index.ts` - Main CoverageConverter class (1,007 lines)
    - `converter/merge.ts` - V8 coverage merging (82 lines)
    - `converter/sanitizer.ts` - Source map sanitization (340 lines)
    - `converter/coverage-fixes.ts` - Istanbul coverage fixes (754 lines)
  - Created `parsers/` folder (6 modules, 553 lines total):
    - Extracted bundler-specific patterns from `constants.ts`
    - `parsers/nextjs.ts` - Next.js URL patterns (101 lines)
    - `parsers/vite.ts` - Vite URL patterns (93 lines)
    - `parsers/webpack.ts` - Webpack URL patterns (94 lines)
    - `parsers/sourcemap.ts` - Source map patterns (92 lines)
    - `parsers/url-utils.ts` - URL utilities (68 lines)
  - Reduced `constants.ts` from 317 to 92 lines (-71%)
  - All exports remain backward compatible - no breaking changes for users

### Internal

- **Improved test coverage** - Added comprehensive tests for new modules (+2,047 test lines)
  - Coverage improved from 72.75% to 77.53% (+4.78%)
  - Created 9 new test files for parsers and converter modules
  - All 678 tests passing

## [0.10.1] - 2024-12-26

### Fixed

- **`nextcov init` now uses pinned dependency versions** - cross-env, start-server-and-test, and concurrently now use specific version ranges (`^7.0.3`, `^2.0.8`, `^9.1.0`) instead of `"latest"` for reproducible builds

## [0.10.0] - 2024-12-25

### Added

- **`nextcov init` command** - Interactive scaffolding for nextcov setup
  - Creates `global-setup.ts`, `global-teardown.ts`, and `test-fixtures.ts`
  - Modifies `playwright.config.ts` with nextcov configuration
  - Adds npm scripts (`dev:e2e`, `build:e2e`, `start:e2e`, `test:e2e`, `coverage:merge`) to `package.json`
  - Modifies `next.config.ts` with E2E mode settings for source maps
  - Options: `--client-only`, `--e2e-dir`, `--js`, `--force`, `-y` (skip prompts)

- **Coverage mode selection in `nextcov init`** - Choose between Full and Client-only modes
  - **Full mode**: Creates `global-setup.ts` with server coverage, `dev:e2e` uses `--inspect`
  - **Client-only mode**: Creates `global-setup.ts` for client coverage, simpler `dev:e2e` script, `collectServer: false` in config

- **`initCoverage()` function** - Unified entry point for globalSetup
  - Works for both client-only and full (client + server) modes
  - Replaces the confusing pattern of calling `startServerCoverage()` for client-only mode
  - Example: `await initCoverage(config)` in global-setup.ts

- **Vite support** - Client-only coverage for Vite applications
  - Detects Vite source URLs (e.g., `http://localhost:5173/src/App.tsx`)
  - Use `collectServer: false` in nextcov config for Vite apps
  - Full example in README under "Vite Support" section

- **`text-summary` in default reporters** - Both `nextcov init` templates and `nextcov merge` CLI now include `text-summary` reporter by default

- **Component test coverage in merge script** - `coverage:merge` script now includes `coverage/component` directory
  - Generated script: `nextcov merge coverage/unit coverage/component coverage/e2e -o coverage/merged`

- **`--no-strip` option for `nextcov merge`** - Disable automatic stripping of import statements and directives
  - By default, `merge` strips import statements and `'use client'`/`'use server'` directives for accurate merged coverage
  - Use `--no-strip` to preserve original coverage data

### Fixed

- **Client-only mode in `nextcov init`** - Fixed several issues with client-only setup
  - `dev:e2e` script now correctly uses `E2E_MODE=true` instead of `--inspect` flag
  - Global teardown template includes correct comment for client-only mode
  - Playwright config correctly sets `collectServer: false`

- **Full mode (client + server) in `nextcov init`** - Fixed server coverage setup
  - `start:local` script includes `NODE_V8_COVERAGE` for proper server coverage collection
  - Webpack config properly handles `isServer` parameter for source map paths
  - Added `devtoolModuleFilenameTemplate` for accurate server-side source mapping

- **Config loading in CJS projects** - Fixed `loadNextcovConfig()` not loading config from `playwright.config.ts` in projects without `"type": "module"` in package.json
  - In CJS projects, named exports like `export const nextcov = {...}` appear under `module.default.nextcov` instead of `module.nextcov`
  - Now checks multiple locations: `module.nextcov`, `module.default?.nextcov`, and `actualConfig?.nextcov`

## [0.9.4] - 2024-12-24

### Added

- **Dual ESM/CJS build** - Package now exports both ESM and CommonJS formats
  - ESM: `dist/index.js`, `dist/playwright/index.js`
  - CJS: `dist/index.cjs`, `dist/playwright/index.cjs`
  - Enables compatibility with tools that require CJS (e.g., Playwright's TypeScript loader when using symlinks via yalc/npm link)
  - Uses tsup bundler for reliable dual-format output

### Changed

- **Build system migrated to tsup** - Replaced `tsc` with `tsup` for bundling
  - Adds `shims: true` for `import.meta.url` compatibility in CJS
  - Adds `cjsInterop: true` for proper default export handling
  - Worker file (`ast-worker.js`) built as separate ESM entry

### Fixed

- **Worker path resolution for bundled code** - `findWorkerPath()` now checks parent directory for `ast-worker.js`
  - Fixes worker loading when code is bundled into `dist/playwright/` subdirectory
- **ESM/CJS interop for ast-v8-to-istanbul** - Added runtime detection to unwrap default export in CJS context
  - Fixes `(0, import_ast_v8_to_istanbul.default) is not a function` error in CJS mode

## [0.9.3] - 2024-12-24

### Enhanced

- **`collectServer: false` now skips `startServerCoverage()` entirely** - Previously only affected `finalizeCoverage()`
  - No CDP connection attempts are made when server coverage is disabled
  - Safe for static sites, SPAs, or deployed environments
  - No `NODE_V8_COVERAGE`, `--inspect`, or `global-setup.ts` required

## [0.9.2] - 2024-12-22

### Fixed

- **Filter Next.js internal sources on Linux/CI** - Major performance fix for CI environments
  - Previously: Unix absolute paths like `/src/client/...` or `/home/runner/src/...` bypassed the projectRoot check
  - Now: Unix paths are properly validated against projectRoot, same as Windows paths
  - Impact: Bundles like `908.js` (1.4MB, 279 sources) that contain only Next.js internals are now skipped entirely
  - Expected CI improvement: ~10 seconds → ~1 second for coverage processing

## [0.9.1] - 2024-12-22

### Added

- **Single-threaded mode via `NEXTCOV_WORKERS=0`** - Disable worker threads for low-core CI environments
  - Set `NEXTCOV_WORKERS=0` to run AST processing directly in the main thread
  - Avoids worker thread overhead which can be significant on 2-core GitHub Actions runners
  - Uses dynamic import to load `ast-worker.js` only when needed
  - Semantics: `0` = main thread (fastest for low-core), `1` = single worker (not recommended), `2+` = parallel workers
  - Performance note: With the multi-range optimization from 0.9.0, single-threaded mode performs similarly to multi-threaded mode (~800ms vs ~830ms) since per-entry processing is now ~22ms

### Changed

- **Increased `SOURCE_MAP_RANGE_THRESHOLD` from 50KB to 100KB** - More conservative threshold for source map range optimization

## [0.9.0] - 2024-12-22

### Performance

- **Multi-range source code filtering for large bundles** - Dramatically improved AST processing performance for large webpack bundles
  - Previously: Used a single min-max byte range for source code filtering (e.g., 515KB range for 73KB of user code)
  - Now: Computes multiple contiguous byte ranges, identifying separate "islands" of user code
  - Example: owner/create/page.js now processes 8 ranges totaling 73KB instead of a single 515KB range
  - Performance improvement: ~64% faster total convert time (2000ms → 720ms in restaurant-reviews-platform)
  - Added `srcCodeRanges` property to WorkerInput (deprecating single `srcCodeRange`)
  - Gap threshold of 1KB between ranges ensures proper merging of adjacent user modules
  - Padding: 1KB before and 5KB after each range to capture boundary nodes

- **Lowered optimization threshold from 200KB to 50KB** - More bundles now benefit from source code range filtering
  - The multi-range optimization is powerful enough to apply to smaller bundles

### Fixed

- **Memory leak in worker pool** - Worker threads are now properly terminated after coverage processing completes
  - Previously: Worker threads remained alive after processing, causing memory buildup
  - Now: `terminateWorkerPool()` is called after `processAllCoverage()` completes
  - Fixes Windows crash (exit code 3221226505) that occurred intermittently

### Added

- **Unit tests for srcCodeRanges** - Added 7 new tests covering multiple ranges, preference over deprecated srcCodeRange, fallback behavior, empty arrays, overlapping ranges, and webpack bundle scenarios

## [0.8.5] - 2024-12-21

### Changed

- **Reduced npm package size** - Excluded test files (`dist/**/__tests__`) from published package (~316KB savings)
- **CDP connection timeout** - Added configurable timeout for CDP connections (default: 30 seconds)
  - New `cdpTimeout` config option for slow CI environments
  - Uses `Promise.race` to enforce timeout on CDP client connections

### Security

- **Path traversal protection** - Applied `isPathWithinBase()` validation in `sourcemap-loader.ts` and `processor.ts` to prevent directory traversal attacks when resolving source file paths

### Improved

- **Graceful JSON error handling** - Coverage file parsing in `v8-reader.ts` now uses `safeJsonParse()` to skip corrupted/truncated JSON files instead of crashing

## [0.8.4] - 2024-12-20

### Improved

- **Quieter CDP port probing** - Added HTTP pre-check before connecting to CDP ports to avoid noisy `[MCR] Error: connect ECONNREFUSED` log messages
  - New `isCdpPortAvailable()` function checks `/json/list` endpoint before calling monocart's CDPClient
  - When probing for dev mode (port 9231), unavailable ports are now silently skipped
  - Mode detection messages (`Dev mode detected`, `Production mode detected`) now always show using `console.log()`

### Added

- **Path traversal protection** - Added `isPathWithinBase()` helper for validating file paths stay within project boundaries
- **Safe JSON parsing** - Added `safeJsonParse()` utility with error logging for V8 coverage file parsing
- **Exported CDP utilities** - `isCdpPortAvailable`, `connectToCdp`, `connectAndStartCoverage` now exported from `collector/index.js`

## [0.8.3] - 2024-12-20

### Fixed

- **Remove phantom branches from webpack module wrappers** - Fixed E2E tests reporting more branches than unit tests
  - When webpack bundles async modules, it wraps them in `__webpack_require__.a(module, async (deps, result) => { try { ... } })`
  - V8 sees the `try` block as a branch point and records it
  - Source maps map this back to line 1, column 0 of the original source file with zero length
  - These "phantom branches" don't represent any real branching logic in the source code
  - New `removePhantomBranches()` method filters out branches with type "if" at line 1:0 with zero-length location
  - Example: restaurant-reviews-platform had 403 → 395 branches (8 phantom removed)
  - Example: nextcov-example had 17 → 14 branches (3 phantom removed)
  - Only affects branch counts; statements, functions, and lines are unchanged

## [0.8.2] - 2024-12-19

### Fixed

- **Branch coverage merge bug with 3+ sources** - Fixed incorrect branch coverage when merging 3 or more coverage sources (e.g., unit + component + integration)
  - Bug: `baseCounts` was captured once before the inner loop, so each iteration used original values instead of accumulated values
  - Example: Component tests `[4, 10]` + Integration tests `[0, 65]` should merge to `[4, 65]`, but incorrectly produced `[0, 65]`
  - This caused branch coverage to appear lower than actual when combining coverage from multiple test types
  - The bug was hidden when only merging 2 sources (e.g., unit + integration) since a single loop iteration worked correctly

## [0.8.1] - 2024-12-18

### Changed

- **CLI merge gracefully skips missing directories** - The `nextcov merge` command now skips missing coverage directories instead of failing
  - Missing directories are logged as "Skipped (not found)" instead of causing an error
  - Requires at least 2 valid coverage directories to proceed
  - Makes merge commands more robust in CI pipelines where some coverage types may be optional

## [0.8.0] - 2024-12-18

### Changed

- **Merged coverage totals now exactly match E2E** - Removed `fixEmptyBranches` and `fixEmptyFunctions` which were artificially inflating coverage totals
  - Previously, files with 0 branches would get +1 implicit branch added
  - Previously, files with 0 functions would get +1 implicit function added
  - Now merged totals preserve E2E coverage totals exactly (0 diff)
  - E2E coverage is treated as the source of truth for totals

- **Improved source selection for merge** - `selectBestSource` now considers branches and functions, not just statements
  - Previously, files with branches/functions but 0 statements would fall back to Unit coverage (which often had no data)
  - Now correctly selects E2E coverage when it has branches/functions that Unit doesn't have
  - Fixes issue where E2E branches were being lost during merge

### Removed

- **Removed `fixEmptyBranches`** - No longer adds implicit branches to files with 0 branches
- **Removed `fixEmptyFunctions`** - No longer adds implicit functions to files with 0 functions

## [0.7.5] - 2024-12-17

### Improved

- **Removed `@ts-nocheck` from all test files** - Enabled full TypeScript type checking across 11 test files (4,801 lines)
- **Fixed all ESLint errors** - Resolved 23 errors and 6 warnings
  - Removed unused imports in test files
  - Fixed empty interface in `v8-server.ts` (changed to type alias)
  - Fixed `let` to `const` in `sourcemap-loader.ts`
  - Fixed explicit `any` types with proper interfaces
- **Added cache size limits** - Prevents unbounded memory growth in long-running processes
  - `fileExistsCache` in converter (max 10,000 entries)
  - `sourceCache` in sourcemap-loader (max 500 entries)
  - `sourceMapCache` in dev-mode-extractor (max 1,000 entries)
  - Caches automatically evict oldest 20% when limit is reached

## [0.7.4] - 2024-12-17

### Fixed

- **Refined JSX callback filtering** - Fixed over-aggressive filtering in 0.7.3
  - Now only filters callbacks with JSX bodies (e.g., `=> <Component>` or `=> (<div>...</div>)`)
  - Keeps non-JSX callbacks like `.filter((c) => c !== value)` and `.reduce((sum, r) => sum + r, 0)` that have proper source mappings
  - Added JSX syntax detection: checks for `=>` followed by `<` or `(` with JSX on next line
  - More accurate function counts, better alignment with Vitest's ast-v8-to-istanbul behavior
  - Prevents false positives where non-JSX array method callbacks were incorrectly removed

## [0.7.3] - 2024-12-17

### Fixed

- **JSX array method callback filtering** - Fixed function count mismatches between Vitest and nextcov for JSX files
  - Vitest's ast-v8-to-istanbul filters arrow functions in `.map()`, `.filter()`, `.reduce()`, etc. whose bodies are JSX elements (e.g., `items.map((item) => <Component />)`)
  - These callbacks have no source mappings for their function bodies after JSX transformation to `_jsxDEV()` calls
  - nextcov's browser/E2E coverage previously included these functions, causing merge conflicts
  - New `filterJsxArrayMethodCallbacks()` method identifies and removes these callbacks by:
    - Checking if the function is on a line containing `.map(`, `.filter(`, `.reduce()`, `.forEach()`, `.find()`, `.some()`, or `.every()`
    - Also checking the previous line (for multi-line arrow functions)
    - Only filtering anonymous arrow functions in `.tsx`/`.jsx` files
  - This ensures clean merging of Vitest unit tests and nextcov E2E coverage with consistent function counts

## [0.7.2] - 2024-12-17

### Fixed

- **Arrow function export coverage** - Fixed incorrect function coverage percentages for arrow function exports
  - V8 CDP creates duplicate function entries for `export const Foo = () => {...}` patterns:
    - One entry for the arrow function body (with execution counts)
    - One entry for the export binding/assignment (typically with 0 executions)
  - This caused coverage to show 66.67% (4/6 functions) instead of 100% (3/3 functions)
  - New `removeDuplicateFunctionEntries()` method groups functions by declaration position and removes duplicates with lower execution counts
  - The fix keeps the arrow function body entry and discards the export binding entry

## [0.7.1] - 2024-12-16

### Changed

- **Refactored CDP utilities** - Extracted common CDP code into `cdp-utils.ts`
  - `connectToCdp()` - Connect to CDP without starting coverage (for NODE_V8_COVERAGE mode)
  - `connectAndStartCoverage()` - Connect and start JS coverage collection (for dev mode)
  - `collectCoverage()` - Generic helper for stop/filter/transform/cleanup pattern
  - `attachSourceContent()` - Attach source content to coverage entries
  - `isClientConnected()` - Type-safe client connection check
  - Both `dev-server.ts` and `v8-server.ts` now use shared utilities

- **Improved error handling** - All empty catch blocks now use named error parameters (`_error`)
  - Enables ESLint's `caughtErrorsIgnorePattern` rule to track intentionally ignored errors
  - Prevents future regressions with empty catches

- **Optimized performance timers** - `createTimer()` now returns a no-op function when timing is disabled
  - Avoids `performance.now()` overhead when logging/timing is off

- **Consistent logging** - Replaced `console.warn` with `warn()` from logger.ts for consistent output

- **Cleaner resource cleanup** - Added `safeClose()` helper for idiomatic resource cleanup in finally blocks

- **Extract magic numbers** - Added new constants to `constants.ts`:
  - `SOURCE_MAP_RANGE_THRESHOLD` (200KB) - Threshold for enabling source map range optimization
  - `SOURCE_MAP_PADDING_BEFORE` (1000 bytes) - Padding before source code range
  - `SOURCE_MAP_PADDING_AFTER` (5000 bytes) - Padding after source code range

### Added

- **`safeJsonParse()` utility** - Helper function for safe JSON parsing with error logging
- **`formatError()` utility** - Helper to format error objects consistently for logging
- **Stricter ESLint rules** for production code:
  - `@typescript-eslint/no-explicit-any` now warns (was off)
  - Separate rule sets for production and test code

### Removed

- **Removed legacy `server.ts`** - Redundant with `v8-server.ts` which uses NODE_V8_COVERAGE approach
  - Removed `connectToCDP()` export (was never used internally)
  - Removed `ServerCoverageCollector` class
- **Removed `worker-pool.test.ts`** - Test caused Vitest worker crashes on Windows

## [0.7.0] - 2024-12-15

### Added

- **Worker thread parallelization** - Large bundles (>100KB) are now processed in parallel using Node.js worker threads
  - Automatically spawns workers based on CPU cores (min 2, max 8)
  - New `ast-worker.ts` and `worker-pool.ts` modules for CPU-intensive AST processing
  - Multiple large bundles process concurrently instead of sequentially

- **Source map range optimization** - Skip processing AST nodes outside the source code range
  - `computeSrcCodeRange()` analyzes source maps to find byte ranges where actual src code exists
  - `ignoreNode` callback returns `'ignore-this-and-nested-nodes'` for nodes outside the range
  - For typical Next.js bundles, this skips 40-96% of the file (bundled dependencies)

### Performance

- **~66% faster** for projects with large bundles containing middleware and Server Actions
  - Example: 387KB middleware bundle reduced from ~4s to ~0.7s (only 14KB of 387KB maps to src)
  - Example: 446KB page bundle reduced from ~4s to ~2.3s (183KB of 446KB maps to src)
  - Two large bundles now process in ~2.4s parallel vs ~7s sequential

### Changed

- Heavy entries (>100KB source) now use `convertEntryWithWorker()` instead of main thread
- Light entries (<100KB) continue to use main thread batch processing for efficiency

## [0.6.3] - 2024-12-15

### Added

- **V8 coverage merge optimization** - Merge duplicate V8 coverage entries by URL before conversion
  - Uses SUM strategy to accumulate execution counts across test runs
  - Normalizes URLs by stripping query parameters (`?v=xxxxx`) for dev mode cache-busted chunks
  - Reduces ~400 entries → ~60 unique entries in dev mode, ~178 → ~33 in production
  - ~12% faster conversion, more accurate coverage
- **Performance timing config** - New `timing: true` option to show only performance metrics without verbose debug output
- **`createTimer()` utility** - Simple timer for measuring performance of coverage operations

### Changed

- **Replaced `acorn` with Vite's `parseAstAsync`** - Better TSX/JSX support and tree-shaking
- **Regex patterns use dynamic construction** - Source map regex patterns in `constants.ts` are now built dynamically to avoid Vite's source map scanner detecting them as actual source maps (Windows Vite bug)

### Removed

- **Removed `acorn` dependency** - Replaced with Vite's built-in parser

## [0.6.2] - 2024-12-13

### Changed

- **Unified CDP library** - Replaced `chrome-remote-interface` with monocart's built-in `CDPClient` for dev mode coverage collection
  - Dev mode now uses `startJSCoverage()` / `stopJSCoverage()` API which automatically handles script source collection
  - Simplified `DevModeServerCollector` implementation (~130 lines removed)
  - One less dependency to maintain

### Removed

- **Removed `chrome-remote-interface` dependency** - All CDP operations now use `monocart-coverage-reports` CDPClient
- **Removed `ScriptInfo` type export** - No longer tracked separately in the new implementation

## [0.6.1] - 2024-12-13

### Fixed

- **Production E2E coverage showing 0%** - Fixed multiple issues that caused production mode coverage to fail while dev mode worked:
  - Fixed `WEBPACK_PREFIX_PATTERN` regex to handle `webpack:///` URLs with empty app names (changed `[^/]+` to `[^/]*`)
  - Added rejection of sources that normalize to empty paths (e.g., `webpack://_N_E/?c9ce` query-only URLs)
  - Fixed Windows path case sensitivity issue - source maps use `C:\Users\...` but `process.cwd()` returns `c:\Users\...`

### Changed

- **Improved source map debugging** - Renamed `isValidSource()` to `getSourceRejectionReason()` which returns the specific reason a source was rejected, making debugging much easier
- **Added debug logging** - `astV8ToIstanbul` errors and source map sanitization now log detailed information when `log: true` is set

## [0.6.0] - 2024-12-13

### Fixed

- **Silent error suppression** - Added logging to catch blocks that were silently swallowing errors, making debugging easier
- **CDP resource leaks** - Added try-finally patterns to ensure CDP client connections are always closed, even when errors occur
- **Type safety** - Created `DevModeV8ScriptCoverage` interface instead of using `any` type for dev mode entries
- **Input validation** - Added URL validation in converter to skip entries with invalid URLs gracefully

### Changed

- **Centralized constants** - Extracted hardcoded patterns and magic values to `constants.ts` for maintainability:
  - Webpack URL patterns (`WEBPACK_URL_PATTERNS`, `isWebpackUrl()`, `normalizeWebpackSourcePath()`)
  - Source map patterns (`INLINE_SOURCE_MAP_PATTERN`, `SOURCE_MAP_LOOKBACK_LIMIT`, etc.)
  - Next.js path constants (`NEXT_STATIC_PATH`, `NEXT_STATIC_CHUNKS_PATH`, `SERVER_SUBDIRS`)
  - Implicit coverage defaults (`DEFAULT_IMPLICIT_LOCATION`, `IMPLICIT_BRANCH_TYPE`)
  - Helper functions (`containsSourceRoot()`, `getServerPatterns()`, `isLocalFileUrl()`, `isNodeModulesUrl()`)
- **Reduced code duplication** - Extracted shared `buildLookups()`, `locationKey()`, and `lineKey()` utilities in merger
- **Use config defaults** - Dev server collector now uses `DEFAULT_DEV_MODE_OPTIONS` and `DEFAULT_NEXTCOV_CONFIG` instead of hardcoded values
- **Added `resetCoverageState()` export** - Allows resetting module-level state for test isolation
- **Refactored `finalizeCoverage()`** - Split dev mode and production mode into separate code paths for clearer logic
- **Progress logging** - Client coverage reader now logs how many files are being processed
- **Improved conversion logging** - Replaced unhelpful "null result" debug messages with clearer output showing converted vs skipped entries count

### Removed

- **Dead code cleanup** - Removed unused `filterNextJsAppCode()` method from V8CoverageReader (was only tested, never used in production)

### Tests

- **Improved fixture.ts coverage** - Added 9 new tests covering `startServerCoverage()`, dev mode flow, error handling, and state reset (coverage increased from 49.6% to 95.27%)
- **Updated dev-mode-extractor tests** - Tests now use centralized `normalizeWebpackSourcePath()` from constants.ts

## [0.5.4] - 2024-12-13

### Fixed

- **CLI not running when invoked via npm bin symlink** - When running via `npx nextcov` or `./node_modules/.bin/nextcov`, the `isMainModule` check failed because `process.argv[1]` is the symlink path (`/nextcov`) not the actual file path (`/cli.js`). Added `/nextcov` to the path matching.
- **Use `process.exitCode` instead of `process.exit()`** - Allow Node to exit naturally after all I/O operations complete, avoiding potential stdout buffering issues

## [0.5.3] - 2024-12-13

### Fixed

- **No CLI output in CI environments** - Flush stdout before process exit to fix output buffering on Linux/GitHub Actions (incomplete fix)

## [0.5.2] - 2024-12-13

### Fixed

- **CLI not running on Linux/CI** - Use `fileURLToPath` for cross-platform path comparison instead of string manipulation

## [0.5.1] - 2024-12-13

### Fixed

- **CLI not running on Linux/CI** - Fixed `import.meta.url` path comparison for Linux environments where file URLs use `file://` format (incomplete fix)

## [0.5.0] - 2024-12-12

### Added

- **CLI for coverage merging** - New `npx nextcov merge` command to merge multiple coverage reports
  - Merge multiple coverage directories: `npx nextcov merge coverage/unit coverage/e2e -o coverage/merged`
  - Customizable reporters: `--reporters html,lcov,json,text-summary`
  - Uses smart merge strategy that handles mismatched statement maps between Vitest and E2E coverage

### Changed

- Refactored CLI to export testable functions (`parseMergeArgs`, `validateInputDirectories`, `executeMerge`)
- CLI test coverage improved from 35% to 71%

## [0.4.2] - 2024-12-12

### Fixed

- **0% coverage on dev mode cold starts** - Webpack scripts weren't compiled yet when coverage collection started
- Event-driven webpack script detection using CDP `scriptParsed` events
- Automatic warmup request during `globalSetup`
- Automatic inheritance of `baseURL` from Playwright config
- Proper handling of nested `defineConfig` exports

## [0.4.1] - 2024-12-12

### Added

- `log` configuration option for controlling verbose output (defaults to silent)

## [0.4.0] - 2024-12-12

### Added

- **Auto-detection for dev/production mode** - No need for separate configurations
- `startServerCoverage(config)` returns `true` for dev mode, `false` for production

## [0.3.0] - 2024-12-11

### Added

- **V8 native coverage support** - Uses Node.js built-in `NODE_V8_COVERAGE` for server-side coverage

### Breaking Changes

- Now requires `NODE_OPTIONS='--inspect=9230'` when starting the Next.js server

## [0.2.3] - 2024-12-10

### Fixed

- Function declaration coverage tracking in Next.js 15
- Export statement coverage in Turbopack environments

## [0.2.2] - 2024-12-10

### Added

- Next.js 15 support

### Fixed

- Custom `buildDir` and `outputDir` options now work correctly

## [0.2.1] - 2024-12-09

### Changed

- Reorganized dependencies
- Reduced package size

## [0.2.0] - 2024-12-09

### Added

- **Development mode support** - Collect coverage from `next dev` without production builds
- Inline source map extraction for dev mode

## [0.1.0] - 2024-12-09

### Added

- Initial release
- V8-to-Istanbul conversion
- Client and server coverage collection
- Playwright integration
- Multiple reporter formats (HTML, LCOV, JSON, text-summary)
