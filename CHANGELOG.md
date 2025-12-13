# Changelog

All notable changes to this project will be documented in this file.

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
