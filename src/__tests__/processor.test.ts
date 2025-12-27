import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CoverageProcessor } from '../core/processor.js'

const isWindows = process.platform === 'win32'
const projectRoot = isWindows ? 'C:/project' : '/project'

describe('CoverageProcessor', () => {
  let processor: CoverageProcessor
  let testOutputDir: string

  beforeEach(async () => {
    testOutputDir = join(tmpdir(), `processor-test-${Date.now()}`)
    processor = new CoverageProcessor(projectRoot, {
      outputDir: testOutputDir,
      reporters: ['json'], // Avoid text-summary console output during tests
    })
  })

  afterEach(async () => {
    try {
      await fs.rm(testOutputDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('constructor', () => {
    it('should set project root', () => {
      expect(processor['projectRoot']).toBe(projectRoot)
    })

    it('should use default output dir if not provided', () => {
      const defaultProcessor = new CoverageProcessor(projectRoot)
      expect(defaultProcessor['options'].outputDir).toBe('coverage/e2e')
    })

    it('should use custom output dir if provided', () => {
      expect(processor['options'].outputDir).toBe(testOutputDir)
    })

    it('should accept custom reporters', () => {
      const customProcessor = new CoverageProcessor(projectRoot, {
        reporters: ['json', 'text'],
      })
      expect(customProcessor['options'].reporters).toEqual(['json', 'text'])
    })

    it('should accept watermarks', () => {
      const watermarks = { statements: [60, 90] as [number, number] }
      const customProcessor = new CoverageProcessor(projectRoot, {
        watermarks,
      })
      expect(customProcessor['options'].watermarks).toEqual(watermarks)
    })

    it('should accept nextBuildDir', () => {
      const customProcessor = new CoverageProcessor(projectRoot, {
        nextBuildDir: '.next-custom',
      })
      expect(customProcessor['options'].nextBuildDir).toBe('.next-custom')
    })
  })

  describe('processPlaywrightCoverage', () => {
    it('should return empty coverage map for empty coverage', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const result = await processor.processPlaywrightCoverage([])

      expect(result.files()).toHaveLength(0)
      consoleSpy.mockRestore()
    })

    it('should process playwright coverage entries', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const coverage = [
        {
          url: 'http://localhost:3000/_next/static/chunks/app/page.js',
          functions: [],
        },
      ]

      const result = await processor.processPlaywrightCoverage(coverage)

      // Result depends on whether source maps are available
      expect(result).toBeDefined()
      expect(typeof result.files).toBe('function')
      consoleSpy.mockRestore()
    })
  })

  describe('processAllCoverage', () => {
    it('should handle empty coverage', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const result = await processor.processAllCoverage([])

      expect(result.coverageMap).toBeDefined()
      expect(result.summary).toBeDefined()
      consoleSpy.mockRestore()
    })

    it('should handle no coverage provided', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const result = await processor.processAllCoverage()

      expect(result.coverageMap).toBeDefined()
      expect(result.summary).toBeDefined()
      consoleSpy.mockRestore()
    })

    it('should return coverage result with summary', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const result = await processor.processAllCoverage()

      expect(result.summary).toHaveProperty('statements')
      expect(result.summary).toHaveProperty('branches')
      expect(result.summary).toHaveProperty('functions')
      expect(result.summary).toHaveProperty('lines')
      consoleSpy.mockRestore()
    })
  })

  describe('getSummary', () => {
    it('should return null when no coverage exists', async () => {
      const result = await processor.getSummary()

      expect(result).toBeNull()
    })
  })

  describe('addUncoveredFiles', () => {
    it('should add uncovered files when sourceRoot is configured', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const processorWithSource = new CoverageProcessor(projectRoot, {
        outputDir: testOutputDir,
        sourceRoot: './src',
        include: ['src/**/*.ts'],
        reporters: ['json'], // Avoid text-summary console output during tests
      })

      // This tests the addUncoveredFiles path
      const result = await processorWithSource.processAllCoverage()

      expect(result.coverageMap).toBeDefined()
      consoleSpy.mockRestore()
    })
  })
})
