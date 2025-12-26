/**
 * Nextcov Configuration
 *
 * Central configuration for nextcov library.
 * Config can be defined in playwright.config.ts under the 'nextcov' property.
 */

import { join, resolve, sep } from 'node:path'
import { existsSync } from 'node:fs'
import type { Watermarks, ReporterType } from './types.js'

/**
 * Default include patterns for source files
 */
export const DEFAULT_INCLUDE_PATTERNS = ['src/**/*.{ts,tsx,js,jsx}']

/**
 * Default exclude patterns for source files
 */
export const DEFAULT_EXCLUDE_PATTERNS = [
  'src/**/__tests__/**',
  'src/**/*.test.{ts,tsx}',
  'src/**/*.spec.{ts,tsx}',
  'src/**/*.browser.test.{ts,tsx}',
  'src/**/types/**',
  'src/**/*.css',
]

/**
 * Default reporters for coverage output
 */
export const DEFAULT_REPORTERS: ReporterType[] = ['html', 'lcov', 'json', 'text-summary']

/**
 * Default watermarks for coverage thresholds
 */
export const DEFAULT_WATERMARKS: Watermarks = {
  statements: [50, 80],
  functions: [50, 80],
  branches: [50, 80],
  lines: [50, 80],
}

/**
 * Default coverage output filename
 */
export const COVERAGE_FINAL_JSON = 'coverage-final.json'

/**
 * Nextcov configuration options
 */
export interface NextcovConfig {
  /** CDP port for server-side coverage collection (default: 9230 or CDP_PORT env) */
  cdpPort?: number

  /**
   * Next.js build output directory (default: '.next').
   * Only used in production mode to locate external source map files.
   * Dev mode uses inline source maps extracted via CDP, so this setting is ignored.
   */
  buildDir?: string

  /** Output directory for E2E coverage reports (default: 'coverage/e2e') */
  outputDir?: string

  /**
   * V8 coverage directory where NODE_V8_COVERAGE writes coverage files.
   * This should match the value of NODE_V8_COVERAGE env var.
   * (default: from NODE_V8_COVERAGE env or '.v8-coverage')
   */
  v8CoverageDir?: string

  /**
   * Collect server-side coverage (default: true).
   * When false, startServerCoverage() becomes a no-op and finalizeCoverage()
   * skips server coverage collection. Use this for static sites, SPAs, or
   * deployed environments where no Node.js server with inspector is available.
   */
  collectServer?: boolean

  /**
   * Collect client-side coverage (default: true).
   * When false, client coverage from Playwright is not collected.
   */
  collectClient?: boolean

  /** Source files root relative to project root (default: './src') */
  sourceRoot?: string

  /** Glob patterns for files to include in coverage */
  include?: string[]

  /** Glob patterns for files to exclude from coverage */
  exclude?: string[]

  /** Reporter types for coverage output */
  reporters?: ReporterType[]

  /**
   * Dev mode configuration.
   * When enabled, nextcov extracts inline source maps from webpack's eval-source-map format.
   * Set to true to auto-detect, or provide config object for manual control.
   */
  devMode?: boolean | DevModeOptions

  /**
   * Enable logging (default: false)
   * When true, shows detailed progress logs during coverage collection.
   */
  log?: boolean

  /**
   * Enable timing logs (default: false)
   * When true, shows only performance timing information without verbose debug output.
   * This is useful for profiling coverage processing without the noise of debug logs.
   */
  timing?: boolean

  /**
   * CDP connection timeout in milliseconds (default: 30000).
   * Increase this value for slow CI environments where CDP connections may take longer.
   */
  cdpTimeout?: number
}

/**
 * Dev mode specific options
 */
export interface DevModeOptions {
  /** Enable dev mode (default: auto-detect via NODE_ENV) */
  enabled?: boolean
  /** Base URL of the dev server (default: http://localhost:3000) */
  baseUrl?: string
  /** CDP port for dev mode server (default: cdpPort + 1, e.g., 9231 for worker process) */
  devCdpPort?: number
}

/**
 * Resolved dev mode options
 */
export interface ResolvedDevModeOptions {
  enabled: boolean
  baseUrl: string
  devCdpPort: number
}

/**
 * Resolved configuration with all defaults applied
 */
export interface ResolvedNextcovConfig {
  cdpPort: number
  buildDir: string
  cacheDir: string
  outputDir: string
  v8CoverageDir: string
  collectServer: boolean
  collectClient: boolean
  sourceRoot: string
  include: string[]
  exclude: string[]
  reporters: ReporterType[]
  devMode: ResolvedDevModeOptions
  log: boolean
  timing: boolean
  cdpTimeout: number
}

const DEFAULT_OUTPUT_DIR = 'coverage/e2e'
const DEFAULT_CDP_PORT = parseInt(process.env.CDP_PORT || '9230', 10)
const DEFAULT_CDP_TIMEOUT = 30000 // 30 seconds

/**
 * Default dev mode options
 */
export const DEFAULT_DEV_MODE_OPTIONS: ResolvedDevModeOptions = {
  enabled: process.env.NODE_ENV === 'development',
  baseUrl: 'http://localhost:3000',
  devCdpPort: DEFAULT_CDP_PORT + 1, // Worker process is on next port (9231)
}

/**
 * Default V8 coverage directory (from NODE_V8_COVERAGE env or fallback)
 */
const DEFAULT_V8_COVERAGE_DIR = process.env.NODE_V8_COVERAGE || '.v8-coverage'

/**
 * Default configuration values
 */
export const DEFAULT_NEXTCOV_CONFIG: ResolvedNextcovConfig = {
  cdpPort: DEFAULT_CDP_PORT,
  buildDir: '.next',
  cacheDir: join(DEFAULT_OUTPUT_DIR, '.cache'),
  outputDir: DEFAULT_OUTPUT_DIR,
  v8CoverageDir: DEFAULT_V8_COVERAGE_DIR,
  collectServer: true,
  collectClient: true,
  sourceRoot: './src',
  include: DEFAULT_INCLUDE_PATTERNS,
  exclude: DEFAULT_EXCLUDE_PATTERNS,
  reporters: DEFAULT_REPORTERS,
  devMode: DEFAULT_DEV_MODE_OPTIONS,
  log: false,
  timing: false,
  cdpTimeout: DEFAULT_CDP_TIMEOUT,
}

/**
 * Resolve dev mode options
 * @param devMode - Dev mode config from nextcov
 * @param cdpPort - CDP port
 * @param playwrightBaseUrl - Optional base URL from Playwright's use.baseURL (used as fallback)
 */
function resolveDevModeOptions(
  devMode: boolean | DevModeOptions | undefined,
  cdpPort: number,
  playwrightBaseUrl?: string
): ResolvedDevModeOptions {
  // Use Playwright's baseURL as fallback, then default
  const defaultBaseUrl = playwrightBaseUrl ?? DEFAULT_DEV_MODE_OPTIONS.baseUrl

  // If devMode is undefined, auto-detect
  if (devMode === undefined) {
    return {
      enabled: process.env.NODE_ENV === 'development',
      baseUrl: defaultBaseUrl,
      devCdpPort: cdpPort + 1,
    }
  }

  // If devMode is a boolean
  if (typeof devMode === 'boolean') {
    return {
      enabled: devMode,
      baseUrl: defaultBaseUrl,
      devCdpPort: cdpPort + 1,
    }
  }

  // If devMode is an object - explicit devMode.baseUrl takes priority
  return {
    enabled: devMode.enabled ?? process.env.NODE_ENV === 'development',
    baseUrl: devMode.baseUrl ?? defaultBaseUrl,
    devCdpPort: devMode.devCdpPort ?? cdpPort + 1,
  }
}

/**
 * Resolve nextcov config with defaults
 * @param config - Nextcov config options
 * @param playwrightBaseUrl - Optional base URL from Playwright's use.baseURL
 */
export function resolveNextcovConfig(config?: NextcovConfig, playwrightBaseUrl?: string): ResolvedNextcovConfig {
  const outputDir = config?.outputDir ?? DEFAULT_NEXTCOV_CONFIG.outputDir
  const cdpPort = config?.cdpPort ?? DEFAULT_NEXTCOV_CONFIG.cdpPort

  return {
    cdpPort,
    buildDir: config?.buildDir ?? DEFAULT_NEXTCOV_CONFIG.buildDir,
    cacheDir: join(outputDir, '.cache'),
    outputDir,
    v8CoverageDir: config?.v8CoverageDir ?? DEFAULT_NEXTCOV_CONFIG.v8CoverageDir,
    collectServer: config?.collectServer ?? DEFAULT_NEXTCOV_CONFIG.collectServer,
    collectClient: config?.collectClient ?? DEFAULT_NEXTCOV_CONFIG.collectClient,
    sourceRoot: config?.sourceRoot ?? DEFAULT_NEXTCOV_CONFIG.sourceRoot,
    include: config?.include ?? DEFAULT_NEXTCOV_CONFIG.include,
    exclude: config?.exclude ?? DEFAULT_NEXTCOV_CONFIG.exclude,
    reporters: config?.reporters ?? DEFAULT_NEXTCOV_CONFIG.reporters,
    devMode: resolveDevModeOptions(config?.devMode, cdpPort, playwrightBaseUrl),
    log: config?.log ?? DEFAULT_NEXTCOV_CONFIG.log,
    timing: config?.timing ?? DEFAULT_NEXTCOV_CONFIG.timing,
    cdpTimeout: config?.cdpTimeout ?? DEFAULT_NEXTCOV_CONFIG.cdpTimeout,
  }
}

// Cache for loaded config
let cachedConfig: ResolvedNextcovConfig | null = null
let cachedConfigPath: string | null = null

/**
 * Find playwright config file (supports .ts and .js)
 */
function findPlaywrightConfig(): string {
  const cwd = process.cwd()
  const tsConfig = join(cwd, 'playwright.config.ts')
  const jsConfig = join(cwd, 'playwright.config.js')

  if (existsSync(tsConfig)) return tsConfig
  if (existsSync(jsConfig)) return jsConfig

  // Default to .ts if neither exists
  return tsConfig
}

/**
 * Load nextcov config from playwright.config.ts or playwright.config.js
 *
 * Also extracts Playwright's use.baseURL to use as default for devMode.baseUrl
 *
 * @param configPath - Path to playwright config (optional, will search in cwd for .ts then .js)
 */
export async function loadNextcovConfig(configPath?: string): Promise<ResolvedNextcovConfig> {
  const searchPath = configPath || findPlaywrightConfig()

  // Return cached if same path
  if (cachedConfig && cachedConfigPath === searchPath) {
    return cachedConfig
  }

  try {
    // Dynamic import of the playwright config
    const configUrl = `file://${searchPath.replace(/\\/g, '/')}`
    const module = await import(configUrl)

    // Handle both ESM and CJS module patterns:
    // ESM projects: named exports appear directly on module (module.nextcov)
    // CJS projects: exports may be wrapped in module.default
    const defaultExport = module.default as Record<string, unknown> | undefined

    // For defineConfig result, handle nested default (module.default.default)
    const actualConfig = (defaultExport?.default ?? defaultExport) as Record<string, unknown> | undefined

    // Look for nextcov config in multiple places to handle different module systems:
    // 1. ESM named export: module.nextcov
    // 2. CJS wrapped export: module.default?.nextcov (named exports wrapped in default)
    // 3. As property of defineConfig result: actualConfig?.nextcov
    const nextcovConfig: NextcovConfig | undefined =
      module.nextcov ||
      (defaultExport?.nextcov as NextcovConfig | undefined) ||
      (actualConfig?.nextcov as NextcovConfig | undefined)

    // Extract Playwright's use.baseURL if available
    // This is used as the default for devMode.baseUrl
    const useConfig = actualConfig?.use as { baseURL?: string } | undefined
    const playwrightBaseUrl = useConfig?.baseURL

    cachedConfig = resolveNextcovConfig(nextcovConfig, playwrightBaseUrl)
    cachedConfigPath = searchPath
    return cachedConfig
  } catch {
    // Config file not found or invalid - fall back to defaults
    // This is expected when no playwright.config.ts exists
    cachedConfig = resolveNextcovConfig()
    cachedConfigPath = searchPath
    return cachedConfig
  }
}

/**
 * Clear cached configuration (useful for testing)
 */
export function clearConfigCache(): void {
  cachedConfig = null
  cachedConfigPath = null
}

/**
 * Normalize path separators for cross-platform compatibility
 */
export function normalizePath(filepath: string): string {
  return filepath.replace(/\\/g, '/')
}

/**
 * Check if a path is safely within a base directory (path traversal protection).
 * Prevents directory traversal attacks where user-supplied paths could escape
 * the intended directory boundary.
 *
 * @param filePath - The path to validate (can be relative or absolute)
 * @param baseDir - The base directory that filePath must be within
 * @returns true if filePath resolves to a location within baseDir
 *
 * @example
 * ```typescript
 * isPathWithinBase('/project/src/file.ts', '/project') // true
 * isPathWithinBase('../etc/passwd', '/project') // false
 * isPathWithinBase('/project/../etc/passwd', '/project') // false
 * ```
 */
export function isPathWithinBase(filePath: string, baseDir: string): boolean {
  const resolvedPath = resolve(filePath)
  const resolvedBase = resolve(baseDir)
  // Ensure the resolved path starts with the base directory
  // Add path separator to prevent matching partial directory names
  // e.g., /project-other should not match /project
  return resolvedPath === resolvedBase || resolvedPath.startsWith(resolvedBase + sep)
}
