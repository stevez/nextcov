// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import {
  ClientCoverageCollector,
  createClientCollector,
  type PlaywrightCoverageEntry,
} from '../client.js'

describe('ClientCoverageCollector', () => {
  let collector: ClientCoverageCollector
  let testCacheDir: string

  beforeEach(async () => {
    testCacheDir = join(tmpdir(), `client-coverage-test-${Date.now()}`)
    collector = new ClientCoverageCollector({ cacheDir: testCacheDir })
  })

  afterEach(async () => {
    try {
      await fs.rm(testCacheDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('constructor', () => {
    it('should use default cache dir if not provided', () => {
      const defaultCollector = new ClientCoverageCollector()
      expect(defaultCollector['config'].cacheDir).toContain('coverage')
    })

    it('should use custom cache dir if provided', () => {
      expect(collector['config'].cacheDir).toBe(testCacheDir)
    })
  })

  describe('initCoverageDir', () => {
    it('should create cache directory if it does not exist', () => {
      expect(existsSync(testCacheDir)).toBe(false)

      collector.initCoverageDir()

      expect(existsSync(testCacheDir)).toBe(true)
    })

    it('should not throw if directory already exists', () => {
      collector.initCoverageDir()
      expect(() => collector.initCoverageDir()).not.toThrow()
    })
  })

  describe('saveClientCoverage', () => {
    it('should save coverage to file', async () => {
      const coverage: PlaywrightCoverageEntry[] = [
        {
          url: 'http://localhost:3000/_next/static/chunks/app/page.js',
          functions: [],
        },
      ]

      await collector.saveClientCoverage('test-1', coverage)

      const files = await fs.readdir(testCacheDir)
      expect(files.length).toBe(1)
      expect(files[0]).toMatch(/^client-test-1-\d+\.json$/)
    })

    it('should save coverage with correct content', async () => {
      const coverage: PlaywrightCoverageEntry[] = [
        {
          url: 'http://localhost:3000/_next/static/chunks/app/page.js',
          functions: [
            {
              functionName: 'test',
              ranges: [{ startOffset: 0, endOffset: 10, count: 1 }],
              isBlockCoverage: true,
            },
          ],
        },
      ]

      await collector.saveClientCoverage('test-2', coverage)

      const files = await fs.readdir(testCacheDir)
      const content = await fs.readFile(join(testCacheDir, files[0]), 'utf-8')
      const data = JSON.parse(content)

      expect(data.result).toHaveLength(1)
      expect(data.result[0].url).toBe('http://localhost:3000/_next/static/chunks/app/page.js')
    })
  })

  describe('readAllClientCoverage', () => {
    it('should return empty array when cache dir does not exist', async () => {
      const result = await collector.readAllClientCoverage()
      expect(result).toEqual([])
    })

    it('should read all client coverage files', async () => {
      const coverage1: PlaywrightCoverageEntry[] = [
        { url: 'http://localhost:3000/a.js', functions: [] },
      ]
      const coverage2: PlaywrightCoverageEntry[] = [
        { url: 'http://localhost:3000/b.js', functions: [] },
      ]

      await collector.saveClientCoverage('test-1', coverage1)
      await collector.saveClientCoverage('test-2', coverage2)

      const result = await collector.readAllClientCoverage()

      expect(result.length).toBe(2)
    })

    it('should skip invalid files', async () => {
      collector.initCoverageDir()

      // Write invalid file
      await fs.writeFile(join(testCacheDir, 'client-invalid-123.json'), 'not json')

      // Write valid file
      await collector.saveClientCoverage('test-1', [
        { url: 'http://localhost:3000/a.js', functions: [] },
      ])

      const result = await collector.readAllClientCoverage()

      expect(result.length).toBe(1)
    })

    it('should skip files without result array', async () => {
      collector.initCoverageDir()

      await fs.writeFile(
        join(testCacheDir, 'client-no-result-123.json'),
        JSON.stringify({ data: 'test' })
      )

      await collector.saveClientCoverage('test-1', [
        { url: 'http://localhost:3000/a.js', functions: [] },
      ])

      const result = await collector.readAllClientCoverage()

      expect(result.length).toBe(1)
    })
  })

  describe('cleanCoverageDir', () => {
    it('should remove cache directory', async () => {
      collector.initCoverageDir()
      expect(existsSync(testCacheDir)).toBe(true)

      await collector.cleanCoverageDir()

      expect(existsSync(testCacheDir)).toBe(false)
    })

    it('should not throw when directory does not exist', async () => {
      expect(existsSync(testCacheDir)).toBe(false)
      await expect(collector.cleanCoverageDir()).resolves.not.toThrow()
    })
  })

  describe('filterAppCoverage', () => {
    it('should exclude node_modules', () => {
      const coverage: PlaywrightCoverageEntry[] = [
        { url: 'http://localhost:3000/node_modules/react/index.js', functions: [] },
      ]

      const result = collector.filterAppCoverage(coverage)

      expect(result).toHaveLength(0)
    })

    it('should include Next.js chunks', () => {
      const coverage: PlaywrightCoverageEntry[] = [
        { url: 'http://localhost:3000/_next/static/chunks/app/page.js', functions: [] },
      ]

      const result = collector.filterAppCoverage(coverage)

      expect(result).toHaveLength(1)
    })

    it('should exclude vendor chunks (numeric prefixes)', () => {
      const coverage: PlaywrightCoverageEntry[] = [
        { url: 'http://localhost:3000/_next/static/chunks/878-abc123.js', functions: [] },
      ]

      const result = collector.filterAppCoverage(coverage)

      expect(result).toHaveLength(0)
    })

    it('should exclude non-Next.js URLs', () => {
      const coverage: PlaywrightCoverageEntry[] = [
        { url: 'http://localhost:3000/other/path.js', functions: [] },
      ]

      const result = collector.filterAppCoverage(coverage)

      expect(result).toHaveLength(0)
    })

    it('should handle empty URL', () => {
      const coverage: PlaywrightCoverageEntry[] = [
        { url: '', functions: [] },
      ]

      const result = collector.filterAppCoverage(coverage)

      expect(result).toHaveLength(0)
    })

    it('should handle Windows-style paths', () => {
      const coverage: PlaywrightCoverageEntry[] = [
        { url: 'http://localhost:3000/_next\\static\\chunks\\app\\page.js', functions: [] },
      ]

      const result = collector.filterAppCoverage(coverage)

      expect(result).toHaveLength(1)
    })
  })
})

describe('createClientCollector', () => {
  it('should create a collector with default config', () => {
    const collector = createClientCollector()
    expect(collector).toBeInstanceOf(ClientCoverageCollector)
  })

  it('should create a collector with custom config', () => {
    const collector = createClientCollector({ cacheDir: '/custom/cache' })
    expect(collector['config'].cacheDir).toBe('/custom/cache')
  })
})
