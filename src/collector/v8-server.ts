/**
 * V8 Server Coverage Collector
 *
 * Collects server-side V8 coverage using NODE_V8_COVERAGE environment variable
 * combined with CDP to trigger v8.takeCoverage() remotely.
 *
 * This approach captures ALL server-side coverage including:
 * - Module-level code (imports, top-level expressions)
 * - Startup code that runs before CDP connects
 * - Server actions and API routes
 *
 * Usage:
 * 1. Start Next.js with: NODE_V8_COVERAGE=./coverage/v8 node --inspect=9230 ...
 * 2. Run tests
 * 3. Call collector.collect() which triggers v8.takeCoverage() via CDP
 * 4. Coverage is read from NODE_V8_COVERAGE directory
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CDPClient } from 'monocart-coverage-reports'
import { DEFAULT_NEXTCOV_CONFIG, normalizePath } from '../config.js'
import { getServerPatterns, isLocalFileUrl, isNodeModulesUrl, containsSourceRoot } from '../constants.js'
import { log } from '../logger.js'

export interface V8ServerCoverageEntry {
  url: string
  source?: string
  functions: Array<{
    functionName: string
    ranges: Array<{ startOffset: number; endOffset: number; count: number }>
    isBlockCoverage: boolean
  }>
}

export interface V8ServerCollectorConfig {
  /** CDP port to connect to (default: 9230) */
  cdpPort: number
  /** V8 coverage directory (default: from NODE_V8_COVERAGE env or './coverage/v8') */
  v8CoverageDir?: string
  /** Next.js build directory (default: '.next') */
  buildDir?: string
  /** Source root for filtering (default: 'src') */
  sourceRoot?: string
}

/**
 * V8 Server Coverage Collector
 *
 * Uses NODE_V8_COVERAGE + CDP trigger approach for complete server coverage.
 */
export class V8ServerCoverageCollector {
  private config: Required<V8ServerCollectorConfig>
  private cdpClient: Awaited<ReturnType<typeof CDPClient>> | null = null

  constructor(config?: Partial<V8ServerCollectorConfig>) {
    // Get v8 coverage dir from env or config
    const v8CoverageDir =
      config?.v8CoverageDir ||
      process.env.NODE_V8_COVERAGE ||
      './coverage/v8'

    this.config = {
      cdpPort: config?.cdpPort ?? DEFAULT_NEXTCOV_CONFIG.cdpPort,
      v8CoverageDir,
      buildDir: config?.buildDir ?? DEFAULT_NEXTCOV_CONFIG.buildDir,
      sourceRoot: config?.sourceRoot ?? 'src',
    }
  }

  /**
   * Connect to the Node.js inspector via CDP
   * Note: We don't start coverage here - NODE_V8_COVERAGE handles that automatically
   */
  async connect(): Promise<boolean> {
    try {
      log(`  Connecting to CDP at port ${this.config.cdpPort}...`)
      this.cdpClient = await CDPClient({ port: this.config.cdpPort })
      log('  ✓ Connected to CDP')
      return true
    } catch (error) {
      log(`  ⚠️ Failed to connect to CDP: ${error}`)
      return false
    }
  }

  /**
   * Trigger v8.takeCoverage() via CDP to write coverage to NODE_V8_COVERAGE directory
   * Returns the coverage directory path
   */
  async triggerCoverageWrite(): Promise<string | null> {
    if (!this.cdpClient) {
      log('  ⚠️ CDP not connected')
      return null
    }

    try {
      // Use CDP to execute v8.takeCoverage() in the remote process
      // This is what monocart's writeCoverage() does internally
      const dir = await this.cdpClient.writeCoverage()
      log(`  ✓ Triggered v8.takeCoverage(), coverage dir: ${dir}`)
      return dir || this.config.v8CoverageDir
    } catch (error) {
      log(`  ⚠️ Failed to trigger coverage write: ${error}`)
      return null
    }
  }

  /**
   * Read coverage files from the V8 coverage directory
   */
  private readCoverageFiles(coverageDir: string): V8ServerCoverageEntry[] {
    if (!existsSync(coverageDir)) {
      log(`  ⚠️ Coverage directory not found: ${coverageDir}`)
      return []
    }

    const files = readdirSync(coverageDir)
    const coverageFiles = files.filter(
      (f) => f.startsWith('coverage-') && f.endsWith('.json')
    )

    if (coverageFiles.length === 0) {
      log(`  ⚠️ No coverage files found in ${coverageDir}`)
      return []
    }

    log(`  Found ${coverageFiles.length} coverage file(s)`)

    const allEntries: V8ServerCoverageEntry[] = []

    for (const file of coverageFiles) {
      try {
        const filePath = join(coverageDir, file)
        const content = readFileSync(filePath, 'utf-8')
        const json = JSON.parse(content)
        const result = json.result as V8ServerCoverageEntry[]

        if (result && Array.isArray(result)) {
          allEntries.push(...result)
        }
      } catch (error) {
        log(`  ⚠️ Failed to read ${file}: ${error}`)
      }
    }

    return allEntries
  }

  /**
   * Filter coverage entries to only include relevant server files
   */
  private filterEntries(entries: V8ServerCoverageEntry[]): V8ServerCoverageEntry[] {
    const buildDir = normalizePath(this.config.buildDir)
    // Remove leading ./ from sourceRoot for matching
    const sourceRoot = normalizePath(this.config.sourceRoot).replace(/^\.\//, '')

    // Production build patterns
    const serverPatterns = getServerPatterns(buildDir)

    // Debug: log URL patterns to understand coverage data
    const allFileUrls = entries.filter((e) => e.url?.startsWith('file:'))
    const nonNodeModuleUrls = allFileUrls.filter((e) => !e.url.includes('node_modules'))
    log(`  Debug: Total entries=${entries.length}, file:URLs=${allFileUrls.length}, non-node_modules=${nonNodeModuleUrls.length}`)
    log(`  Debug: sourceRoot="${sourceRoot}", pattern="/${sourceRoot}/"`)

    if (nonNodeModuleUrls.length > 0) {
      log(`  Debug: Sample non-node_modules URLs:`)
      nonNodeModuleUrls.slice(0, 10).forEach((e) => log(`    ${e.url}`))
    } else if (allFileUrls.length > 0) {
      log(`  Debug: All file URLs are in node_modules. Sample:`)
      allFileUrls.slice(0, 3).forEach((e) => log(`    ${e.url}`))
    }

    return entries.filter((entry) => {
      const url = entry.url || ''

      // Only local file URLs (not Node builtins or remote)
      if (!isLocalFileUrl(url)) return false

      // Exclude third-party dependencies
      if (isNodeModulesUrl(url)) return false

      // Normalize URL for pattern matching
      const normalizedUrl = normalizePath(url)

      // Production mode: Include files matching any server pattern
      if (serverPatterns.some(pattern => normalizedUrl.includes(pattern))) return true

      // Dev mode: Include source files from sourceRoot
      // In dev mode, Next.js serves original source files directly
      if (sourceRoot && containsSourceRoot(normalizedUrl, sourceRoot)) return true

      return false
    }).filter((entry) => {
      // Exclude manifest files
      return !entry.url.includes('manifest.js')
    })
  }

  /**
   * Attach source content to coverage entries
   */
  private attachSourceContent(entries: V8ServerCoverageEntry[]): void {
    for (const entry of entries) {
      try {
        const filePath = fileURLToPath(entry.url)
        if (existsSync(filePath)) {
          entry.source = readFileSync(filePath, 'utf-8')
        }
      } catch (error) {
        log(`  Skipping file ${entry.url}: ${error instanceof Error ? error.message : 'unknown error'}`)
      }
    }
  }

  /**
   * Collect server-side coverage
   *
   * 1. Triggers v8.takeCoverage() via CDP
   * 2. Reads coverage from NODE_V8_COVERAGE directory
   * 3. Filters to relevant server files
   * 4. Attaches source content
   */
  async collect(): Promise<V8ServerCoverageEntry[]> {
    let coverageDir: string | null = null

    try {
      // Step 1: Trigger coverage write via CDP
      coverageDir = await this.triggerCoverageWrite()
    } finally {
      // Always close CDP connection to prevent resource leaks
      if (this.cdpClient) {
        try {
          await this.cdpClient.close()
        } catch {
          // Ignore close errors
        }
        this.cdpClient = null
      }
    }

    // Use configured dir if trigger didn't return one
    const dir = coverageDir || this.config.v8CoverageDir

    // Step 2: Read coverage files
    const allEntries = this.readCoverageFiles(dir)

    if (allEntries.length === 0) {
      return []
    }

    log(`  Read ${allEntries.length} total coverage entries`)

    // Step 3: Filter to relevant files
    const filtered = this.filterEntries(allEntries)

    log(`  Filtered to ${filtered.length} server coverage entries`)

    // Step 4: Attach source content
    this.attachSourceContent(filtered)

    log(`  ✓ Collected ${filtered.length} server coverage entries`)

    return filtered
  }

  /**
   * Save server coverage to file for later processing
   */
  async save(coverage: V8ServerCoverageEntry[], cacheDir: string): Promise<void> {
    if (coverage.length === 0) return

    await fs.mkdir(cacheDir, { recursive: true })
    const filePath = join(cacheDir, `server-v8-${Date.now()}.json`)
    await fs.writeFile(filePath, JSON.stringify({ result: coverage }, null, 2))
    log(`  ✓ Server coverage saved to ${filePath}`)
  }

  /**
   * Clean up the V8 coverage directory
   * Should be called after coverage has been processed
   */
  async cleanup(): Promise<void> {
    const coverageDir = this.config.v8CoverageDir
    if (!existsSync(coverageDir)) {
      return
    }

    try {
      await fs.rm(coverageDir, { recursive: true, force: true })
      log(`  ✓ Cleaned up V8 coverage directory: ${coverageDir}`)
    } catch (error) {
      log(`  ⚠️ Failed to clean up V8 coverage directory: ${error}`)
    }
  }

  /**
   * Get the V8 coverage directory path
   */
  getV8CoverageDir(): string {
    return this.config.v8CoverageDir
  }
}

// Convenience functions

let defaultCollector: V8ServerCoverageCollector | null = null

/**
 * Create a V8 server coverage collector
 */
export function createV8ServerCollector(
  config?: Partial<V8ServerCollectorConfig>
): V8ServerCoverageCollector {
  return new V8ServerCoverageCollector(config)
}

/**
 * Start V8 server coverage collection
 * Call this in global-setup
 */
export async function startV8ServerCoverage(
  config?: Partial<V8ServerCollectorConfig>
): Promise<boolean> {
  defaultCollector = new V8ServerCoverageCollector(config)
  return defaultCollector.connect()
}

/**
 * Stop and collect V8 server coverage
 * Call this in global-teardown
 */
export async function stopV8ServerCoverage(): Promise<V8ServerCoverageEntry[]> {
  if (!defaultCollector) {
    log('  ⚠️ No active V8 server coverage collection')
    return []
  }

  const entries = await defaultCollector.collect()
  defaultCollector = null
  return entries
}
