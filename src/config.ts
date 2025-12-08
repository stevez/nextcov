/**
 * Nextcov Configuration
 *
 * Central configuration for nextcov library.
 * Config can be defined in playwright.config.ts under the 'nextcov' property.
 */

import { join } from 'node:path'
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

  /** Next.js build output directory (default: '.next') */
  buildDir?: string

  /** Output directory for E2E coverage reports (default: 'coverage/e2e') */
  outputDir?: string

  /** Whether to collect server-side coverage (default: true) */
  collectServer?: boolean

  /** Whether to collect client-side coverage (default: true) */
  collectClient?: boolean

  /** Source files root relative to project root (default: './src') */
  sourceRoot?: string

  /** Glob patterns for files to include in coverage */
  include?: string[]

  /** Glob patterns for files to exclude from coverage */
  exclude?: string[]

  /** Reporter types for coverage output */
  reporters?: ReporterType[]
}

/**
 * Resolved configuration with all defaults applied
 */
export interface ResolvedNextcovConfig {
  cdpPort: number
  buildDir: string
  cacheDir: string
  outputDir: string
  collectServer: boolean
  collectClient: boolean
  sourceRoot: string
  include: string[]
  exclude: string[]
  reporters: ReporterType[]
}

const DEFAULT_OUTPUT_DIR = 'coverage/e2e'

/**
 * Default configuration values
 */
export const DEFAULT_NEXTCOV_CONFIG: ResolvedNextcovConfig = {
  cdpPort: parseInt(process.env.CDP_PORT || '9230', 10),
  buildDir: '.next',
  cacheDir: join(DEFAULT_OUTPUT_DIR, '.cache'),
  outputDir: DEFAULT_OUTPUT_DIR,
  collectServer: true,
  collectClient: true,
  sourceRoot: './src',
  include: DEFAULT_INCLUDE_PATTERNS,
  exclude: DEFAULT_EXCLUDE_PATTERNS,
  reporters: DEFAULT_REPORTERS,
}

/**
 * Resolve nextcov config with defaults
 */
export function resolveNextcovConfig(config?: NextcovConfig): ResolvedNextcovConfig {
  const outputDir = config?.outputDir ?? DEFAULT_NEXTCOV_CONFIG.outputDir
  return {
    cdpPort: config?.cdpPort ?? DEFAULT_NEXTCOV_CONFIG.cdpPort,
    buildDir: config?.buildDir ?? DEFAULT_NEXTCOV_CONFIG.buildDir,
    cacheDir: join(outputDir, '.cache'),
    outputDir,
    collectServer: config?.collectServer ?? DEFAULT_NEXTCOV_CONFIG.collectServer,
    collectClient: config?.collectClient ?? DEFAULT_NEXTCOV_CONFIG.collectClient,
    sourceRoot: config?.sourceRoot ?? DEFAULT_NEXTCOV_CONFIG.sourceRoot,
    include: config?.include ?? DEFAULT_NEXTCOV_CONFIG.include,
    exclude: config?.exclude ?? DEFAULT_NEXTCOV_CONFIG.exclude,
    reporters: config?.reporters ?? DEFAULT_NEXTCOV_CONFIG.reporters,
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
    const config = module.default as { nextcov?: NextcovConfig }

    cachedConfig = resolveNextcovConfig(config?.nextcov)
    cachedConfigPath = searchPath
    return cachedConfig
  } catch {
    // Fall back to defaults if config can't be loaded
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
