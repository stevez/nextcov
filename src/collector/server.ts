/**
 * Server Coverage Collector
 *
 * Collects server-side V8 coverage via Chrome DevTools Protocol (CDP)
 * using monocart-coverage-reports CDPClient.
 */

import { existsSync, readFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CDPClient } from 'monocart-coverage-reports'
import { DEFAULT_NEXTCOV_CONFIG, normalizePath } from '../config.js'
import { getServerPatterns, isLocalFileUrl, isNodeModulesUrl } from '../constants.js'
import { log } from '../logger.js'

export interface V8CoverageEntry {
  url: string
  source?: string
  functions: Array<{
    functionName: string
    ranges: Array<{ startOffset: number; endOffset: number; count: number }>
    isBlockCoverage: boolean
  }>
}

export interface ServerCollectorConfig {
  /** CDP port to connect to (default: 9230) */
  cdpPort: number
  /** Directory to store collected coverage */
  cacheDir: string
  /** Next.js build directory (default: '.next') */
  buildDir?: string
}

/**
 * Server Coverage Collector
 */
export class ServerCoverageCollector {
  private config: Required<ServerCollectorConfig>
  private cdpClient: Awaited<ReturnType<typeof CDPClient>> | null = null

  constructor(config?: Partial<ServerCollectorConfig>) {
    this.config = {
      cdpPort: config?.cdpPort ?? DEFAULT_NEXTCOV_CONFIG.cdpPort,
      cacheDir: config?.cacheDir ?? DEFAULT_NEXTCOV_CONFIG.cacheDir,
      buildDir: config?.buildDir ?? DEFAULT_NEXTCOV_CONFIG.buildDir,
    }
  }

  /**
   * Connect to the Node.js inspector via CDP and start coverage collection
   */
  async connect(): Promise<boolean> {
    try {
      log(`  Connecting to CDP at port ${this.config.cdpPort}...`)
      this.cdpClient = await CDPClient({ port: this.config.cdpPort })
      log('  ✓ Connected to CDP')

      // Start JS coverage collection via CDP
      if (this.cdpClient) {
        await this.cdpClient.startJSCoverage()
        log('  ✓ Started JS coverage collection')
      }
      return true
    } catch (error) {
      log(`  ⚠️ Failed to connect to CDP: ${error}`)
      return false
    }
  }

  /**
   * Collect server-side coverage
   */
  async collect(): Promise<V8CoverageEntry[]> {
    if (!this.cdpClient) {
      log('  ⚠️ CDP not connected, no server coverage to collect')
      return []
    }

    try {
      // Stop coverage and get the data directly via CDP
      const coverageData = await this.cdpClient.stopJSCoverage()

      if (!coverageData || coverageData.length === 0) {
        log('  ⚠️ No coverage data returned')
        return []
      }

      // Build dir patterns for filtering (normalized for cross-platform)
      const buildDir = normalizePath(this.config.buildDir)
      const serverPatterns = getServerPatterns(buildDir)

      // Filter to only relevant server files
      let coverageList = (coverageData as V8CoverageEntry[]).filter((entry) => {
        const url = entry.url || ''
        // Only local file URLs (not Node builtins or remote)
        if (!isLocalFileUrl(url)) return false
        // Exclude third-party dependencies
        if (isNodeModulesUrl(url)) return false

        // Normalize URL for pattern matching
        const normalizedUrl = normalizePath(url)

        // Include files matching any server pattern
        return serverPatterns.some(pattern => normalizedUrl.includes(pattern))
      })

      // Exclude manifest files
      coverageList = coverageList.filter((entry) => !entry.url.includes('manifest.js'))

      // Attach source content
      for (const entry of coverageList) {
        try {
          const filePath = fileURLToPath(entry.url)
          if (existsSync(filePath)) {
            entry.source = readFileSync(filePath, 'utf-8')
          }
        } catch (error) {
          log(`  Skipping file ${entry.url}: ${error instanceof Error ? error.message : 'unknown error'}`)
        }
      }

      log(`  ✓ Collected ${coverageList.length} server coverage entries`)
      return coverageList
    } catch (error) {
      log(`  ⚠️ Failed to collect server coverage: ${error}`)
      return []
    } finally {
      // Always close CDP client to prevent resource leaks
      if (this.cdpClient) {
        try {
          await this.cdpClient.close()
        } catch {
          // Ignore close errors
        }
        this.cdpClient = null
      }
    }
  }

  /**
   * Save server coverage to file for later processing
   */
  async save(coverage: V8CoverageEntry[]): Promise<void> {
    if (coverage.length === 0) return

    await fs.mkdir(this.config.cacheDir, { recursive: true })
    const filePath = join(this.config.cacheDir, `server-${Date.now()}.json`)
    await fs.writeFile(filePath, JSON.stringify({ result: coverage }, null, 2))
    log(`  ✓ Server coverage saved`)
  }
}

// Convenience functions for backwards compatibility

let defaultCollector: ServerCoverageCollector | null = null

function getDefaultCollector(): ServerCoverageCollector {
  if (!defaultCollector) {
    defaultCollector = new ServerCoverageCollector()
  }
  return defaultCollector
}

export async function connectToCDP(config?: { port?: number }): Promise<boolean> {
  if (config?.port) {
    // Create collector with custom port
    defaultCollector = new ServerCoverageCollector({ cdpPort: config.port })
  }
  return getDefaultCollector().connect()
}

export async function collectServerCoverage(): Promise<V8CoverageEntry[]> {
  return getDefaultCollector().collect()
}

export async function saveServerCoverage(coverage: V8CoverageEntry[]): Promise<void> {
  return getDefaultCollector().save(coverage)
}

/**
 * Create a server coverage collector with custom config
 */
export function createServerCollector(config?: Partial<ServerCollectorConfig>): ServerCoverageCollector {
  return new ServerCoverageCollector(config)
}
