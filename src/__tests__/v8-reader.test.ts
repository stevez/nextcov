import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { V8CoverageReader } from '../v8-reader.js'
import type { V8Coverage, V8ScriptCoverage } from '../types.js'

describe('V8CoverageReader', () => {
  let reader: V8CoverageReader

  beforeEach(() => {
    reader = new V8CoverageReader()
  })

  describe('constructor', () => {
    it('should use default exclude patterns', () => {
      const defaultReader = new V8CoverageReader()
      expect(defaultReader['excludePatterns']).toContain('/node_modules/')
      expect(defaultReader['excludePatterns']).toContain('node:')
    })

    it('should accept custom exclude patterns', () => {
      const customPatterns = ['/custom/', /test-pattern/]
      const customReader = new V8CoverageReader(customPatterns)
      expect(customReader['excludePatterns']).toEqual(customPatterns)
    })
  })

  describe('readFromPlaywright', () => {
    it('should convert Playwright coverage format to V8 coverage', () => {
      const playwrightCoverage = [
        {
          url: 'http://localhost:3000/main.js',
          source: 'console.log("hello")',
          functions: [{ functionName: '', ranges: [{ startOffset: 0, endOffset: 20, count: 1 }] }],
        },
        {
          url: 'http://localhost:3000/utils.js',
          functions: [{ functionName: 'add', ranges: [{ startOffset: 0, endOffset: 50, count: 2 }] }],
        },
      ]

      const result = reader.readFromPlaywright(playwrightCoverage)

      expect(result.result).toHaveLength(2)
      expect(result.result[0].scriptId).toBe('0')
      expect(result.result[0].url).toBe('http://localhost:3000/main.js')
      expect(result.result[0].source).toBe('console.log("hello")')
      expect(result.result[1].scriptId).toBe('1')
      expect(result.result[1].url).toBe('http://localhost:3000/utils.js')
      expect(result.result[1].source).toBeUndefined()
    })

    it('should handle empty coverage array', () => {
      const result = reader.readFromPlaywright([])
      expect(result.result).toHaveLength(0)
    })
  })

  describe('filterEntries', () => {
    it('should filter out node_modules', () => {
      const coverage: V8Coverage = {
        result: [
          { scriptId: '1', url: '/project/node_modules/lodash/index.js', functions: [] },
          { scriptId: '2', url: '/project/src/index.ts', functions: [] },
        ],
      }

      const filtered = reader.filterEntries(coverage)

      expect(filtered.result).toHaveLength(1)
      expect(filtered.result[0].url).toBe('/project/src/index.ts')
    })

    it('should filter out node: built-ins', () => {
      const coverage: V8Coverage = {
        result: [
          { scriptId: '1', url: 'node:fs', functions: [] },
          { scriptId: '2', url: 'node:path', functions: [] },
          { scriptId: '3', url: '/project/src/utils.ts', functions: [] },
        ],
      }

      const filtered = reader.filterEntries(coverage)

      expect(filtered.result).toHaveLength(1)
      expect(filtered.result[0].url).toBe('/project/src/utils.ts')
    })

    it('should filter out __vitest__ and __playwright__', () => {
      const coverage: V8Coverage = {
        result: [
          { scriptId: '1', url: '/__vitest__/runner.js', functions: [] },
          { scriptId: '2', url: '/__playwright__/test.js', functions: [] },
          { scriptId: '3', url: '/project/src/app.ts', functions: [] },
        ],
      }

      const filtered = reader.filterEntries(coverage)

      expect(filtered.result).toHaveLength(1)
      expect(filtered.result[0].url).toBe('/project/src/app.ts')
    })

    it('should apply custom filter function', () => {
      const coverage: V8Coverage = {
        result: [
          { scriptId: '1', url: '/project/src/a.ts', functions: [] },
          { scriptId: '2', url: '/project/src/b.ts', functions: [] },
          { scriptId: '3', url: '/project/src/c.ts', functions: [] },
        ],
      }

      const customFilter = (entry: V8ScriptCoverage) => entry.url.includes('a.ts')
      const filtered = reader.filterEntries(coverage, customFilter)

      expect(filtered.result).toHaveLength(1)
      expect(filtered.result[0].url).toBe('/project/src/a.ts')
    })

    it('should filter using regex patterns', () => {
      const customReader = new V8CoverageReader([/\.test\.ts$/])
      const coverage: V8Coverage = {
        result: [
          { scriptId: '1', url: '/project/src/utils.test.ts', functions: [] },
          { scriptId: '2', url: '/project/src/utils.ts', functions: [] },
        ],
      }

      const filtered = customReader.filterEntries(coverage)

      expect(filtered.result).toHaveLength(1)
      expect(filtered.result[0].url).toBe('/project/src/utils.ts')
    })

    it('should preserve source-map-cache in filtered result', () => {
      const coverage: V8Coverage = {
        result: [{ scriptId: '1', url: '/project/src/index.ts', functions: [] }],
        'source-map-cache': {
          '/project/src/index.ts': {
            lineLengths: [10, 20],
            data: { version: 3, sources: [], mappings: '', names: [] },
          },
        },
      }

      const filtered = reader.filterEntries(coverage)

      expect(filtered['source-map-cache']).toEqual(coverage['source-map-cache'])
    })
  })

  describe('merge', () => {
    it('should return empty coverage when no inputs', () => {
      const result = reader.merge()
      expect(result.result).toHaveLength(0)
    })

    it('should return same coverage when only one input', () => {
      const coverage: V8Coverage = {
        result: [{ scriptId: '1', url: '/test.js', functions: [] }],
      }

      const result = reader.merge(coverage)

      expect(result).toEqual(coverage)
    })

    it('should merge multiple coverage objects', () => {
      const coverage1: V8Coverage = {
        result: [{ scriptId: '1', url: '/a.js', functions: [] }],
      }
      const coverage2: V8Coverage = {
        result: [{ scriptId: '2', url: '/b.js', functions: [] }],
      }

      const result = reader.merge(coverage1, coverage2)

      expect(result.result.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('getSourceUrls', () => {
    it('should return unique URLs', () => {
      const coverage: V8Coverage = {
        result: [
          { scriptId: '1', url: '/a.js', functions: [] },
          { scriptId: '2', url: '/b.js', functions: [] },
          { scriptId: '3', url: '/a.js', functions: [] },
        ],
      }

      const urls = reader.getSourceUrls(coverage)

      expect(urls).toHaveLength(2)
      expect(urls).toContain('/a.js')
      expect(urls).toContain('/b.js')
    })

    it('should handle empty coverage', () => {
      const coverage: V8Coverage = { result: [] }
      const urls = reader.getSourceUrls(coverage)
      expect(urls).toHaveLength(0)
    })
  })

  describe('getStats', () => {
    it('should return coverage statistics', () => {
      const coverage: V8Coverage = {
        result: [
          { scriptId: '1', url: '/a.js', functions: [] },
          { scriptId: '2', url: '/b.js', functions: [] },
        ],
      }

      const stats = reader.getStats(coverage)

      expect(stats.total).toBe(2)
      expect(stats.filtered).toBe(2)
      expect(stats.urls).toHaveLength(2)
    })
  })

  describe('readFromDirectory', () => {
    let testDir: string

    beforeEach(async () => {
      testDir = join(tmpdir(), `v8-coverage-test-${Date.now()}`)
      await fs.mkdir(testDir, { recursive: true })
    })

    afterEach(async () => {
      try {
        await fs.rm(testDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    it('should return empty result when no coverage files', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const result = await reader.readFromDirectory(testDir)

      expect(result.result).toHaveLength(0)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No coverage files found'))

      warnSpy.mockRestore()
    })

    it('should read and merge coverage files', async () => {
      const coverage1: V8Coverage = {
        result: [{ scriptId: '1', url: '/a.js', functions: [] }],
      }
      const coverage2: V8Coverage = {
        result: [{ scriptId: '2', url: '/b.js', functions: [] }],
      }

      await fs.writeFile(
        join(testDir, 'coverage-1.json'),
        JSON.stringify(coverage1)
      )
      await fs.writeFile(
        join(testDir, 'coverage-2.json'),
        JSON.stringify(coverage2)
      )

      const result = await reader.readFromDirectory(testDir)

      expect(result.result.length).toBeGreaterThanOrEqual(1)
    })

    it('should preserve source-map-cache from file that has it', async () => {
      // The source-map-cache is only preserved if the first file doesn't have one
      // and a subsequent file does, or if the first file has one
      const coverage1: V8Coverage = {
        result: [{ scriptId: '1', url: '/a.js', functions: [] }],
      }
      const coverage2: V8Coverage = {
        result: [{ scriptId: '2', url: '/b.js', functions: [] }],
        'source-map-cache': {
          '/b.js': {
            lineLengths: [10],
            data: { version: 3, sources: [], mappings: '', names: [] },
          },
        },
      }

      // Write coverage-2 first (files are sorted alphabetically)
      await fs.writeFile(
        join(testDir, 'coverage-1.json'),
        JSON.stringify(coverage1)
      )
      await fs.writeFile(
        join(testDir, 'coverage-2.json'),
        JSON.stringify(coverage2)
      )

      const result = await reader.readFromDirectory(testDir)

      // The result should have the source-map-cache from coverage2
      expect(result['source-map-cache']).toBeDefined()
    })

    it('should ignore non-coverage files', async () => {
      const coverage: V8Coverage = {
        result: [{ scriptId: '1', url: '/a.js', functions: [] }],
      }

      await fs.writeFile(
        join(testDir, 'coverage-1.json'),
        JSON.stringify(coverage)
      )
      await fs.writeFile(
        join(testDir, 'other-file.json'),
        JSON.stringify({ data: 'test' })
      )
      await fs.writeFile(
        join(testDir, 'coverage.txt'),
        'not json'
      )

      const result = await reader.readFromDirectory(testDir)

      expect(result.result.length).toBeGreaterThanOrEqual(1)
    })
  })
})
