/**
 * In-Process V8 Coverage Collector
 *
 * Collects V8 coverage from the current Node.js process using the
 * inspector API. No CDP connection needed — coverage is collected
 * directly from the same process running the tests.
 *
 * Use case: Playwright mock tests that import and run the code under
 * test in the same process (e.g., VS Code extension mock tests).
 *
 * Usage:
 *   const collector = new InProcessV8Collector({ include: ['src/'] })
 *   await collector.start()
 *   // ... run tests ...
 *   const coverage = await collector.collect()
 *   await collector.stop()
 */

import { Session } from 'node:inspector/promises'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { BaseCoverageEntry } from './cdp-utils.js'
import { log } from '@/utils/logger.js'

export interface InProcessCollectorConfig {
  /** Glob patterns to include (matched against file URLs). Default: all files */
  include?: string[]
  /** Glob patterns to exclude. Default: ['node_modules'] */
  exclude?: string[]
}

export type InProcessCoverageEntry = BaseCoverageEntry

/**
 * Collects V8 coverage from the current Node.js process.
 *
 * Starts precise coverage via the inspector Session API, then
 * takes a snapshot when `collect()` is called. Filters results
 * to only include project source files.
 */
export class InProcessV8Collector {
  private session: Session | null = null
  private config: Required<InProcessCollectorConfig>

  constructor(config?: InProcessCollectorConfig) {
    this.config = {
      include: config?.include ?? [],
      exclude: config?.exclude ?? ['node_modules'],
    }
  }

  /**
   * Start precise V8 coverage collection.
   * Call this before any code under test executes.
   */
  async start(): Promise<void> {
    this.session = new Session()
    this.session.connect()
    await this.session.post('Profiler.enable')
    await this.session.post('Profiler.startPreciseCoverage', {
      callCount: true,
      detailed: true,
    })
    log('📊 In-process V8 coverage started')
  }

  /**
   * Take a coverage snapshot and return filtered entries.
   * Can be called multiple times — each call returns cumulative coverage.
   */
  async collect(): Promise<InProcessCoverageEntry[]> {
    if (!this.session) return []

    const { result } = await this.session.post('Profiler.takePreciseCoverage') as { result: Array<{ scriptId: string; url: string; functions: any[] }> }

    const entries: InProcessCoverageEntry[] = []
    for (const script of result) {
      if (!this._shouldInclude(script.url)) continue

      // Attach source code for source map resolution
      let source: string | undefined
      const filePath = this._urlToPath(script.url)
      if (filePath && existsSync(filePath)) {
        try { source = readFileSync(filePath, 'utf-8') } catch {}
      }

      entries.push({
        url: script.url,
        source,
        functions: script.functions,
      })
    }

    log(`  ✓ Collected ${entries.length} in-process coverage entries`)
    return entries
  }

  /**
   * Stop coverage collection and disconnect the inspector session.
   */
  async stop(): Promise<void> {
    if (!this.session) return
    await this.session.post('Profiler.stopPreciseCoverage')
    await this.session.post('Profiler.disable')
    this.session.disconnect()
    this.session = null
    log('📊 In-process V8 coverage stopped')
  }

  private _shouldInclude(url: string): boolean {
    if (!url || url.startsWith('node:')) return false

    for (const pattern of this.config.exclude) {
      if (url.includes(pattern)) return false
    }

    if (this.config.include.length === 0) return true

    for (const pattern of this.config.include) {
      if (url.includes(pattern)) return true
    }
    return false
  }

  private _urlToPath(url: string): string | null {
    try {
      if (url.startsWith('file://')) return fileURLToPath(url)
      return null
    } catch {
      return null
    }
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createInProcessCollector(config?: InProcessCollectorConfig): InProcessV8Collector {
  return new InProcessV8Collector(config)
}
