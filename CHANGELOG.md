# Changelog

All notable changes to this project will be documented in this file.

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
