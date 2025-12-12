/**
 * Dev Mode Server Coverage Collector
 *
 * Collects server-side coverage in dev mode using CDP Debugger API.
 * In dev mode, server scripts have inline source maps that need to be
 * extracted from the script source via Debugger.getScriptSource().
 *
 * Key difference from production:
 * - Production: External .map files in .next/server/
 * - Dev mode: Inline base64 source maps in webpack-internal:// scripts
 *
 * Note: Server code runs on CDP port 9231 (child worker), not 9230 (parent CLI)
 */

import type { V8CoverageEntry } from './server.js'
import type { SourceMapData } from '../types.js'
import { DevModeSourceMapExtractor, type ExtractedSourceMap } from '../dev-mode-extractor.js'
import { log } from '../logger.js'

// Dynamically import chrome-remote-interface (optional dependency)
type CDPClient = Awaited<ReturnType<typeof import('chrome-remote-interface')['default']>>

export interface DevServerCollectorConfig {
  /** CDP port for the server worker process (default: 9231) */
  cdpPort: number
  /** Source root for filtering project files (default: 'src') */
  sourceRoot: string
}

export interface ScriptInfo {
  scriptId: string
  url: string
  hasSourceMap: boolean
  sourceMapUrl?: string
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
 * Uses CDP Debugger API to:
 * 1. Enable debugger and listen for scriptParsed events
 * 2. Filter for project source scripts (webpack-internal://...src/...)
 * 3. Get script source via Debugger.getScriptSource()
 * 4. Extract inline base64 source maps
 * 5. Collect coverage via Profiler API
 */
export class DevModeServerCollector {
  private config: DevServerCollectorConfig
  private client: CDPClient | null = null
  private scripts: Map<string, ScriptInfo> = new Map()
  private extractor: DevModeSourceMapExtractor
  private CDP: typeof import('chrome-remote-interface')['default'] | null = null

  constructor(config?: Partial<DevServerCollectorConfig>) {
    this.config = {
      cdpPort: config?.cdpPort ?? 9231, // Worker process port
      sourceRoot: config?.sourceRoot ?? 'src',
    }
    this.extractor = new DevModeSourceMapExtractor({
      sourceRoot: this.config.sourceRoot,
    })
  }

  /**
   * Connect to CDP and start collecting scripts
   */
  async connect(): Promise<boolean> {
    try {
      // Dynamically import chrome-remote-interface
      if (!this.CDP) {
        const module = await import('chrome-remote-interface')
        this.CDP = module.default
      }

      log(`  Connecting to CDP (dev mode) at port ${this.config.cdpPort}...`)
      this.client = await this.CDP({ port: this.config.cdpPort })

      // Enable debugger to get script info
      const { Debugger, Profiler } = this.client

      // Listen for script parsed events
      Debugger.on('scriptParsed', (params: {
        scriptId: string
        url: string
        sourceMapURL?: string
      }) => {
        this.scripts.set(params.scriptId, {
          scriptId: params.scriptId,
          url: params.url,
          hasSourceMap: !!params.sourceMapURL,
          sourceMapUrl: params.sourceMapURL,
        })
      })

      await Debugger.enable()
      log('  ✓ Connected to CDP (dev mode)')

      // Start profiler for coverage
      await Profiler.enable()
      await Profiler.startPreciseCoverage({
        callCount: true,
        detailed: true,
      })
      log('  ✓ Started JS coverage collection (dev mode)')

      return true
    } catch (error) {
      log(`  ⚠️ Failed to connect to CDP (dev mode): ${error}`)
      log('  Note: In dev mode, server code runs on port 9231 (worker process)')
      return false
    }
  }

  /**
   * Check if this is a dev mode process by looking for webpack eval scripts.
   * Dev mode uses eval-source-map which creates scripts with URLs like:
   * webpack-internal:///./src/... or webpack://...
   * Production mode doesn't have these.
   */
  isDevModeProcess(): boolean {
    for (const script of this.scripts.values()) {
      if (script.url.includes('webpack-internal://') ||
          script.url.includes('webpack://') ||
          script.url.includes('(app-pages-browser)')) {
        return true
      }
    }
    return false
  }

  /**
   * Get all project scripts (src/ files)
   */
  getProjectScripts(): ScriptInfo[] {
    return Array.from(this.scripts.values()).filter((script) =>
      this.extractor.isProjectScript(script.url)
    )
  }

  /**
   * Extract source map from a script
   */
  async extractScriptSourceMap(scriptId: string): Promise<ExtractedSourceMap | null> {
    if (!this.client) return null

    const script = this.scripts.get(scriptId)
    if (!script) return null

    try {
      const { Debugger } = this.client
      const { scriptSource } = await Debugger.getScriptSource({ scriptId })

      return this.extractor.extractFromScriptSource(script.url, scriptSource)
    } catch {
      return null
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
      const { Profiler, Debugger } = this.client

      // Stop coverage and get results
      const { result: coverageResult } = await Profiler.takePreciseCoverage()
      await Profiler.stopPreciseCoverage()

      // Filter to project scripts
      const projectScripts = this.getProjectScripts()
      log(`  Found ${projectScripts.length} project scripts in dev mode`)

      // Filter to only project scripts with coverage
      const projectCoverage = coverageResult.filter((coverage) => {
        const script = this.scripts.get(coverage.scriptId)
        return script && this.extractor.isProjectScript(script.url)
      })

      // Build coverage entries with source maps - fetch all sources in parallel
      const entryPromises = projectCoverage.map(async (coverage) => {
        const script = this.scripts.get(coverage.scriptId)!

        try {
          const { scriptSource } = await Debugger.getScriptSource({
            scriptId: coverage.scriptId,
          })

          const extracted = this.extractor.extractFromScriptSource(script.url, scriptSource)

          const entry: DevServerCoverageEntry = {
            url: script.url,
            source: scriptSource,
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
        } catch {
          return null
        }
      })

      const results = await Promise.all(entryPromises)
      const entries = results.filter((e): e is DevServerCoverageEntry => e !== null)

      // Cleanup
      await Debugger.disable()
      await this.client.close()
      this.client = null

      log(`  ✓ Collected ${entries.length} server coverage entries (dev mode)`)
      return entries
    } catch (error) {
      log(`  ⚠️ Failed to collect server coverage (dev mode): ${error}`)
      if (this.client) {
        await this.client.close()
        this.client = null
      }
      return []
    }
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
