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

import type { SourceMapData } from '../types.js'
import { DevModeSourceMapExtractor } from '../dev-mode-extractor.js'
import { DEFAULT_DEV_MODE_OPTIONS, DEFAULT_NEXTCOV_CONFIG } from '../config.js'
import { log } from '../logger.js'
import {
  type MonocartCDPClient,
  type BaseCoverageEntry,
  isClientConnected,
  collectCoverage,
  connectAndStartCoverage,
} from './cdp-utils.js'

/** Coverage entry returned by monocart stopJSCoverage */
interface MonocartCoverageEntry extends BaseCoverageEntry {
  scriptId: string
  source: string
}

export interface DevServerCollectorConfig {
  /** CDP port for the server worker process (default: 9231) */
  cdpPort: number
  /** Source root for filtering project files (default: 'src') */
  sourceRoot: string
}

export interface DevServerCoverageEntry extends BaseCoverageEntry {
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
    this.client = await connectAndStartCoverage(this.config.cdpPort, 'dev mode')
    if (!this.client) {
      log('  Note: In dev mode, server code runs on port 9231 (worker process)')
    }
    return this.client !== null
  }

  /**
   * Collect coverage and source maps for all project scripts
   */
  async collect(): Promise<DevServerCoverageEntry[]> {
    if (!isClientConnected(this.client, 'dev mode')) {
      return []
    }

    return collectCoverage<MonocartCoverageEntry, DevServerCoverageEntry>(this.client, {
      mode: 'dev mode',
      filter: (entries) => {
        log(`  Found ${entries.length} total scripts`)
        const filtered = entries.filter((entry) => this.extractor.isProjectScript(entry.url))
        log(`  Found ${filtered.length} project scripts in dev mode`)
        return filtered
      },
      transform: (entries) => this.transformEntries(entries),
      cleanup: () => { this.client = null },
    })
  }

  /**
   * Transform coverage entries and extract source maps
   */
  private transformEntries(entries: MonocartCoverageEntry[]): DevServerCoverageEntry[] {
    return entries.map((coverage) => {
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

      return entry
    })
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
