/**
 * Client Coverage Collector for Playwright E2E Tests
 *
 * Collects client-side V8 coverage during tests and stores it for later processing.
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { DEFAULT_NEXTCOV_CONFIG, normalizePath } from '../config.js'

export interface PlaywrightCoverageEntry {
  url: string
  source?: string
  functions: Array<{
    functionName: string
    ranges: Array<{
      startOffset: number
      endOffset: number
      count: number
    }>
    isBlockCoverage: boolean
  }>
}

export interface ClientCollectorConfig {
  /** Directory to store collected coverage */
  cacheDir: string
}

/**
 * Client Coverage Collector
 */
export class ClientCoverageCollector {
  private config: ClientCollectorConfig

  constructor(config?: Partial<ClientCollectorConfig>) {
    this.config = {
      cacheDir: config?.cacheDir ?? DEFAULT_NEXTCOV_CONFIG.cacheDir,
    }
  }

  /**
   * Initialize coverage directory
   */
  initCoverageDir(): void {
    if (!existsSync(this.config.cacheDir)) {
      mkdirSync(this.config.cacheDir, { recursive: true })
    }
  }

  /**
   * Save client coverage from a test
   */
  async saveClientCoverage(
    testId: string,
    coverage: PlaywrightCoverageEntry[]
  ): Promise<void> {
    this.initCoverageDir()

    const filePath = join(this.config.cacheDir, `client-${testId}-${Date.now()}.json`)
    await fs.writeFile(filePath, JSON.stringify({ result: coverage }, null, 2))
  }

  /**
   * Read all client coverage files
   */
  async readAllClientCoverage(): Promise<PlaywrightCoverageEntry[]> {
    if (!existsSync(this.config.cacheDir)) {
      return []
    }

    const files = await fs.readdir(this.config.cacheDir)
    const coverageFiles = files.filter((f) => f.startsWith('client-') && f.endsWith('.json'))

    const allCoverage: PlaywrightCoverageEntry[] = []

    for (const file of coverageFiles) {
      try {
        const content = await fs.readFile(join(this.config.cacheDir, file), 'utf-8')
        const data = JSON.parse(content)
        if (data.result && Array.isArray(data.result)) {
          allCoverage.push(...data.result)
        }
      } catch {
        // Skip invalid files
      }
    }

    return allCoverage
  }

  /**
   * Clean up coverage directory
   */
  async cleanCoverageDir(): Promise<void> {
    if (existsSync(this.config.cacheDir)) {
      await fs.rm(this.config.cacheDir, { recursive: true })
    }
  }

  /**
   * Filter coverage to Next.js app code only
   */
  filterAppCoverage(coverage: PlaywrightCoverageEntry[]): PlaywrightCoverageEntry[] {
    return coverage.filter((entry) => {
      const url = entry.url || ''

      // Normalize for cross-platform matching
      const normalizedUrl = normalizePath(url)

      // Exclude node_modules
      if (normalizedUrl.includes('/node_modules/')) return false

      // Include Next.js chunks
      if (normalizedUrl.includes('/_next/static/chunks/')) {
        // Exclude vendor chunks (numeric prefixes like 878-xxx.js)
        const filename = normalizedUrl.split('/').pop() || ''
        if (/^\d+/.test(filename)) return false
        return true
      }

      return false
    })
  }
}

// Convenience functions for backwards compatibility

let defaultCollector: ClientCoverageCollector | null = null
let defaultCollectorConfig: Partial<ClientCollectorConfig> | undefined = undefined

/**
 * Set the config for the default collector
 * Call this before using any convenience functions to override defaults
 */
export function setDefaultCollectorConfig(config: Partial<ClientCollectorConfig>): void {
  defaultCollectorConfig = config
  // Reset collector so it gets recreated with new config
  defaultCollector = null
}

function getDefaultCollector(): ClientCoverageCollector {
  if (!defaultCollector) {
    defaultCollector = new ClientCoverageCollector(defaultCollectorConfig)
  }
  return defaultCollector
}

export function initCoverageDir(): void {
  getDefaultCollector().initCoverageDir()
}

export async function saveClientCoverage(
  testId: string,
  coverage: PlaywrightCoverageEntry[]
): Promise<void> {
  return getDefaultCollector().saveClientCoverage(testId, coverage)
}

export async function readAllClientCoverage(): Promise<PlaywrightCoverageEntry[]> {
  return getDefaultCollector().readAllClientCoverage()
}

export async function cleanCoverageDir(): Promise<void> {
  return getDefaultCollector().cleanCoverageDir()
}

export function filterAppCoverage(coverage: PlaywrightCoverageEntry[]): PlaywrightCoverageEntry[] {
  return getDefaultCollector().filterAppCoverage(coverage)
}

/**
 * Create a client coverage collector with custom config
 */
export function createClientCollector(config?: Partial<ClientCollectorConfig>): ClientCoverageCollector {
  return new ClientCoverageCollector(config)
}
