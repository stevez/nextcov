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
      console.log(`  Connecting to CDP at port ${this.config.cdpPort}...`)
      this.cdpClient = await CDPClient({ port: this.config.cdpPort })
      console.log('  ✓ Connected to CDP')

      // Start JS coverage collection via CDP
      if (this.cdpClient) {
        await this.cdpClient.startJSCoverage()
        console.log('  ✓ Started JS coverage collection')
      }
      return true
    } catch (error) {
      console.log(`  ⚠️ Failed to connect to CDP: ${error}`)
      return false
    }
  }

  /**
   * Collect server-side coverage
   */
  async collect(): Promise<V8CoverageEntry[]> {
    if (!this.cdpClient) {
      console.log('  ⚠️ CDP not connected, no server coverage to collect')
      return []
    }

    try {
      // Stop coverage and get the data directly via CDP
      const coverageData = await this.cdpClient.stopJSCoverage()
      await this.cdpClient.close()
      this.cdpClient = null

      if (!coverageData || coverageData.length === 0) {
        console.log('  ⚠️ No coverage data returned')
        return []
      }

      // Build dir patterns for filtering (normalized for cross-platform)
      const buildDir = normalizePath(this.config.buildDir)
      const serverAppPattern = `${buildDir}/server/app`
      const serverChunksPattern = `${buildDir}/server/chunks`
      const serverSrcPattern = `${buildDir}/server/src`

      // Filter to only relevant server files
      let coverageList = (coverageData as V8CoverageEntry[]).filter((entry) => {
        const url = entry.url || ''
        // Only file URLs
        if (!url.startsWith('file:')) return false
        // Exclude node_modules
        if (url.includes('node_modules')) return false

        // Normalize URL for pattern matching
        const normalizedUrl = normalizePath(url)

        // Include server/app files (server components, API routes)
        if (normalizedUrl.includes(serverAppPattern)) return true
        // Include server/chunks (shared server code)
        if (normalizedUrl.includes(serverChunksPattern)) return true
        // Include server/src (middleware)
        if (normalizedUrl.includes(serverSrcPattern)) return true
        return false
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
        } catch {
          // Skip if file can't be read
        }
      }

      console.log(`  ✓ Collected ${coverageList.length} server coverage entries`)
      return coverageList
    } catch (error) {
      console.log(`  ⚠️ Failed to collect server coverage: ${error}`)
      if (this.cdpClient) {
        await this.cdpClient.close()
        this.cdpClient = null
      }
      return []
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
    console.log(`  ✓ Server coverage saved`)
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
