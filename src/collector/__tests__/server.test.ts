// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import {
  ServerCoverageCollector,
  createServerCollector,
  type V8CoverageEntry,
} from '../server.js'
import { createMockCoverageClient } from './test-utils.js'

// Mock the logger module
vi.mock('../../logger.js', () => ({
  log: vi.fn(),
  setLogging: vi.fn(),
  isLoggingEnabled: vi.fn().mockReturnValue(false),
  warn: vi.fn(),
  error: vi.fn(),
}))

// Mock monocart-coverage-reports CDPClient
vi.mock('monocart-coverage-reports', () => ({
  CDPClient: vi.fn(),
}))

describe('ServerCoverageCollector', () => {
  let collector: ServerCoverageCollector
  let testCacheDir: string

  beforeEach(async () => {
    testCacheDir = join(tmpdir(), `server-coverage-test-${Date.now()}`)
    collector = new ServerCoverageCollector({ cacheDir: testCacheDir })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    try {
      await fs.rm(testCacheDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('constructor', () => {
    it('should use default CDP port if not provided', () => {
      const defaultCollector = new ServerCoverageCollector()
      expect(defaultCollector['config'].cdpPort).toBe(9230)
    })

    it('should use custom CDP port if provided', () => {
      const customCollector = new ServerCoverageCollector({ cdpPort: 9999 })
      expect(customCollector['config'].cdpPort).toBe(9999)
    })

    it('should use default cache dir if not provided', () => {
      const defaultCollector = new ServerCoverageCollector()
      expect(defaultCollector['config'].cacheDir).toContain('coverage')
    })

    it('should use custom cache dir if provided', () => {
      expect(collector['config'].cacheDir).toBe(testCacheDir)
    })

    it('should use default build dir if not provided', () => {
      const defaultCollector = new ServerCoverageCollector()
      expect(defaultCollector['config'].buildDir).toBe('.next')
    })

    it('should use custom build dir if provided', () => {
      const customCollector = new ServerCoverageCollector({ buildDir: '.next-custom' })
      expect(customCollector['config'].buildDir).toBe('.next-custom')
    })
  })

  describe('connect', () => {
    it('should return false when CDP connection fails', async () => {
      const { log } = await import('../../logger.js')
      const { CDPClient } = await import('monocart-coverage-reports')
      vi.mocked(CDPClient).mockRejectedValue(new Error('Connection failed'))

      const result = await collector.connect()

      expect(result).toBe(false)
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Failed to connect'))
    })

    it('should return true when CDP connection succeeds', async () => {
      const mockClient = createMockCoverageClient()
      const { CDPClient } = await import('monocart-coverage-reports')
      vi.mocked(CDPClient).mockResolvedValue(mockClient)

      const result = await collector.connect()

      expect(result).toBe(true)
      expect(mockClient.startJSCoverage).toHaveBeenCalled()
    })
  })

  describe('collect', () => {
    it('should return empty array when not connected', async () => {
      const { log } = await import('../../logger.js')

      const result = await collector.collect()

      expect(result).toEqual([])
      expect(log).toHaveBeenCalledWith(expect.stringContaining('CDP not connected'))
    })

    it('should return empty array when no coverage data', async () => {
      const mockClient = createMockCoverageClient()
      const { CDPClient } = await import('monocart-coverage-reports')
      vi.mocked(CDPClient).mockResolvedValue(mockClient)

      await collector.connect()
      const result = await collector.collect()

      expect(result).toEqual([])
    })

    it('should filter server coverage entries', async () => {
      const mockCoverage: V8CoverageEntry[] = [
        { url: 'file:///project/.next/server/app/page.js', functions: [] },
        { url: 'file:///project/.next/server/chunks/123.js', functions: [] },
        { url: 'file:///project/node_modules/react.js', functions: [] },
        { url: 'http://localhost:3000/client.js', functions: [] },
      ]
      const mockClient = createMockCoverageClient({
        stopJSCoverage: vi.fn().mockResolvedValue(mockCoverage),
      })
      const { CDPClient } = await import('monocart-coverage-reports')
      vi.mocked(CDPClient).mockResolvedValue(mockClient)

      await collector.connect()
      const result = await collector.collect()

      // Should filter out node_modules and non-file URLs
      expect(result.length).toBeLessThanOrEqual(2)
    })

    it('should handle collection errors gracefully', async () => {
      const { log } = await import('../../logger.js')
      const mockClient = createMockCoverageClient({
        stopJSCoverage: vi.fn().mockRejectedValue(new Error('Collection failed')),
      })
      const { CDPClient } = await import('monocart-coverage-reports')
      vi.mocked(CDPClient).mockResolvedValue(mockClient)

      await collector.connect()
      const result = await collector.collect()

      expect(result).toEqual([])
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Failed to collect'))
    })
  })

  describe('save', () => {
    it('should not save when coverage is empty', async () => {
      await collector.save([])

      expect(existsSync(testCacheDir)).toBe(false)
    })

    it('should save coverage to file', async () => {
      const coverage: V8CoverageEntry[] = [
        { url: 'file:///project/.next/server/app/page.js', functions: [] },
      ]

      await collector.save(coverage)

      expect(existsSync(testCacheDir)).toBe(true)
      const files = await fs.readdir(testCacheDir)
      expect(files.length).toBe(1)
      expect(files[0]).toMatch(/^server-\d+\.json$/)
    })

    it('should save coverage with correct content', async () => {
      const coverage: V8CoverageEntry[] = [
        {
          url: 'file:///project/.next/server/app/page.js',
          functions: [
            {
              functionName: 'test',
              ranges: [{ startOffset: 0, endOffset: 10, count: 1 }],
              isBlockCoverage: true,
            },
          ],
        },
      ]

      await collector.save(coverage)

      const files = await fs.readdir(testCacheDir)
      const content = await fs.readFile(join(testCacheDir, files[0]), 'utf-8')
      const data = JSON.parse(content)

      expect(data.result).toHaveLength(1)
      expect(data.result[0].url).toBe('file:///project/.next/server/app/page.js')
    })
  })
})

describe('createServerCollector', () => {
  it('should create a collector with default config', () => {
    const collector = createServerCollector()
    expect(collector).toBeInstanceOf(ServerCoverageCollector)
  })

  it('should create a collector with custom config', () => {
    const collector = createServerCollector({
      cdpPort: 9999,
      cacheDir: '/custom/cache',
      buildDir: '.next-custom',
    })
    expect(collector['config'].cdpPort).toBe(9999)
    expect(collector['config'].cacheDir).toBe('/custom/cache')
    expect(collector['config'].buildDir).toBe('.next-custom')
  })
})
