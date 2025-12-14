/**
 * Dev Mode Server Coverage Collector
 *
 * Collects server-side coverage in dev mode using monocart-coverage-reports CDPClient.
 * In dev mode, server scripts have inline source maps that need to be
 * extracted from the script source.
 *
 * Key difference from production:
 * - Production: External .map files in .next/server/
 * - Dev mode: Inline base64 source maps in webpack-internal:// scripts
 *
 * Note: Server code runs on CDP port 9231 (child worker), not 9230 (parent CLI)
 */

import type { V8CoverageEntry } from './server.js'
import type { SourceMapData } from '../types.js'
import { CDPClient } from 'monocart-coverage-reports'
import { DevModeSourceMapExtractor } from '../dev-mode-extractor.js'
import { DEFAULT_DEV_MODE_OPTIONS, DEFAULT_NEXTCOV_CONFIG } from '../config.js'
import { log } from '../logger.js'

/** Monocart CDPClient type */
type MonocartCDPClient = Awaited<ReturnType<typeof CDPClient>>

/** Coverage entry returned by monocart stopJSCoverage */
interface MonocartCoverageEntry {
  scriptId: string
  url: string
  source: string
  functions: Array<{
    functionName: string
    ranges: Array<{ startOffset: number; endOffset: number; count: number }>
    isBlockCoverage: boolean
  }>
}

export interface DevServerCollectorConfig {
  /** CDP port for the server worker process (default: 9231) */
  cdpPort: number
  /** Source root for filtering project files (default: 'src') */
  sourceRoot: string
}

export interface DevServerCoverageEntry extends V8CoverageEntry {
  /** Extracted source map data */
  sourceMapData?: SourceMapData
  /** Original file path (from source map) */
  originalPath?: string
}

/**
 * Dev Mode Server Coverage Collector
 *
 * Uses monocart-coverage-reports CDPClient to:
 * 1. Connect to CDP and start JS coverage collection
 * 2. Automatically collect script sources via Debugger API
 * 3. Stop coverage and get results with source attached
 * 4. Extract inline base64 source maps from webpack scripts
 */
export class DevModeServerCollector {
  private config: DevServerCollectorConfig
  private client: MonocartCDPClient | null = null
  private extractor: DevModeSourceMapExtractor

  constructor(config?: Partial<DevServerCollectorConfig>) {
    this.config = {
      cdpPort: config?.cdpPort ?? DEFAULT_DEV_MODE_OPTIONS.devCdpPort,
      sourceRoot: config?.sourceRoot ?? DEFAULT_NEXTCOV_CONFIG.sourceRoot.replace(/^\.\//, ''),
    }
    this.extractor = new DevModeSourceMapExtractor({
      sourceRoot: this.config.sourceRoot,
    })
  }

  /**
   * Connect to CDP and start JS coverage collection
   */
  async connect(): Promise<boolean> {
    try {
      log(`  Connecting to CDP (dev mode) at port ${this.config.cdpPort}...`)

      // Use monocart CDPClient - it handles debugger setup and script source collection
      this.client = await CDPClient({ port: this.config.cdpPort })

      if (!this.client) {
        log('  ⚠️ Failed to create CDP client (dev mode)')
        return false
      }

      // Start JS coverage - this enables Debugger and Profiler
      await this.client.startJSCoverage()

      log('  ✓ Connected to CDP (dev mode)')
      log('  ✓ Started JS coverage collection (dev mode)')

      return true
    } catch (error) {
      log(`  ⚠️ Failed to connect to CDP (dev mode): ${error}`)
      log('  Note: In dev mode, server code runs on port 9231 (worker process)')
      return false
    }
  }

  /**
   * Collect coverage and source maps for all project scripts
   */
  async collect(): Promise<DevServerCoverageEntry[]> {
    if (!this.client) {
      log('  ⚠️ CDP not connected (dev mode)')
      return []
    }

    try {
      // Stop coverage and get results - monocart already includes source in each entry
      const coverageEntries = await this.client.stopJSCoverage() as MonocartCoverageEntry[]

      if (!coverageEntries || coverageEntries.length === 0) {
        log('  ⚠️ No coverage entries returned (dev mode)')
        return []
      }

      log(`  Found ${coverageEntries.length} total scripts`)

      // Filter to project scripts only (webpack-internal URLs with src/)
      const projectEntries = coverageEntries.filter((entry) =>
        this.extractor.isProjectScript(entry.url)
      )

      log(`  Found ${projectEntries.length} project scripts in dev mode`)

      // Transform entries and extract source maps
      const entries: DevServerCoverageEntry[] = []

      for (const coverage of projectEntries) {
        const extracted = this.extractor.extractFromScriptSource(coverage.url, coverage.source)

        const entry: DevServerCoverageEntry = {
          url: coverage.url,
          source: coverage.source,
          functions: coverage.functions.map((fn) => ({
            functionName: fn.functionName,
            ranges: fn.ranges.map((r) => ({
              startOffset: r.startOffset,
              endOffset: r.endOffset,
              count: r.count,
            })),
            isBlockCoverage: fn.isBlockCoverage,
          })),
        }

        if (extracted) {
          entry.sourceMapData = this.extractor.toStandardSourceMap(extracted)
          entry.originalPath = extracted.originalPath
        }

        entries.push(entry)
      }

      log(`  ✓ Collected ${entries.length} server coverage entries (dev mode)`)
      return entries
    } catch (error) {
      log(`  ⚠️ Failed to collect server coverage (dev mode): ${error}`)
      return []
    } finally {
      // Always close CDP client to prevent resource leaks
      if (this.client) {
        try {
          await this.client.close()
        } catch {
          // Ignore close errors
        }
        this.client = null
      }
    }
  }

  /**
   * Check if connected and has webpack scripts (dev mode indicator)
   * Note: This is now less useful since we don't track scripts separately,
   * but kept for API compatibility
   */
  isDevModeProcess(): boolean {
    // In the new implementation, we determine this during collect()
    // by checking if any entries have webpack URLs
    return true
  }

  /**
   * Wait for webpack scripts - now a no-op since monocart handles this
   * Kept for API compatibility
   */
  async waitForWebpackScripts(_timeoutMs: number = 10000): Promise<boolean> {
    // Monocart's startJSCoverage already waits for script parsing
    return true
  }

  /**
   * Close the CDP connection
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close()
      this.client = null
    }
  }

  /**
   * Disconnect from CDP (alias for close)
   */
  async disconnect(): Promise<void> {
    return this.close()
  }
}

/**
 * Create a dev mode server collector
 */
export function createDevModeServerCollector(
  config?: Partial<DevServerCollectorConfig>
): DevModeServerCollector {
  return new DevModeServerCollector(config)
}
