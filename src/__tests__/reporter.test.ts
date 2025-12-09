// @ts-nocheck
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import libCoverage from 'istanbul-lib-coverage'
import type { CoverageMap } from 'istanbul-lib-coverage'
import { IstanbulReporter } from '../reporter.js'

// Helper to create a coverage map with test data
function createTestCoverageMap(files: Record<string, {
  statements?: Record<string, number>
  functions?: Record<string, number>
  branches?: Record<string, number[]>
}>): CoverageMap {
  const data: Record<string, unknown> = {}

  for (const [filePath, coverage] of Object.entries(files)) {
    data[filePath] = {
      path: filePath,
      statementMap: coverage.statements
        ? Object.fromEntries(
            Object.keys(coverage.statements).map((k, i) => [
              k,
              { start: { line: i + 1, column: 0 }, end: { line: i + 1, column: 10 } },
            ])
          )
        : {},
      fnMap: coverage.functions
        ? Object.fromEntries(
            Object.keys(coverage.functions).map((k, i) => [
              k,
              {
                name: `fn${k}`,
                decl: { start: { line: i + 1, column: 0 }, end: { line: i + 1, column: 10 } },
                loc: { start: { line: i + 1, column: 0 }, end: { line: i + 1, column: 10 } },
                line: i + 1,
              },
            ])
          )
        : {},
      branchMap: coverage.branches
        ? Object.fromEntries(
            Object.keys(coverage.branches).map((k, i) => [
              k,
              {
                type: 'if',
                loc: { start: { line: i + 1, column: 0 }, end: { line: i + 1, column: 10 } },
                locations: coverage.branches[k].map((_, j) => ({
                  start: { line: i + 1, column: j * 5 },
                  end: { line: i + 1, column: (j + 1) * 5 },
                })),
              },
            ])
          )
        : {},
      s: coverage.statements || {},
      f: coverage.functions || {},
      b: coverage.branches || {},
    }
  }

  return libCoverage.createCoverageMap(data)
}

describe('IstanbulReporter', () => {
  let reporter: IstanbulReporter
  let testOutputDir: string

  beforeEach(async () => {
    testOutputDir = join(tmpdir(), `coverage-test-${Date.now()}`)
    reporter = new IstanbulReporter({
      outputDir: testOutputDir,
      projectRoot: '/project',
    })
  })

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testOutputDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('constructor', () => {
    it('should use default watermarks', () => {
      expect(reporter['watermarks']).toBeDefined()
      expect(reporter['watermarks'].statements).toEqual([50, 80])
    })

    it('should use default reporters', () => {
      expect(reporter['reporters']).toContain('html')
      expect(reporter['reporters']).toContain('lcov')
    })

    it('should accept custom watermarks', () => {
      const customReporter = new IstanbulReporter({
        outputDir: testOutputDir,
        watermarks: { statements: [60, 90] },
      })
      expect(customReporter['watermarks'].statements).toEqual([60, 90])
    })

    it('should accept custom reporters', () => {
      const customReporter = new IstanbulReporter({
        outputDir: testOutputDir,
        reporters: ['json', 'text'],
      })
      expect(customReporter['reporters']).toEqual(['json', 'text'])
    })
  })

  describe('getSummary', () => {
    it('should return coverage summary', () => {
      const map = createTestCoverageMap({
        '/test.ts': {
          statements: { '0': 1, '1': 0 },
          functions: { '0': 1 },
          branches: { '0': [1, 0] },
        },
      })

      const summary = reporter.getSummary(map)

      expect(summary.statements.total).toBe(2)
      expect(summary.statements.covered).toBe(1)
      expect(summary.statements.pct).toBe(50)
      expect(summary.functions.total).toBe(1)
      expect(summary.functions.covered).toBe(1)
      expect(summary.functions.pct).toBe(100)
      expect(summary.branches.total).toBe(2)
      expect(summary.branches.covered).toBe(1)
      expect(summary.branches.pct).toBe(50)
    })

    it('should handle 100% coverage', () => {
      const map = createTestCoverageMap({
        '/test.ts': {
          statements: { '0': 1, '1': 1 },
          functions: { '0': 1 },
          branches: { '0': [1, 1] },
        },
      })

      const summary = reporter.getSummary(map)

      expect(summary.statements.pct).toBe(100)
      expect(summary.functions.pct).toBe(100)
      expect(summary.branches.pct).toBe(100)
    })

    it('should handle 0% coverage', () => {
      const map = createTestCoverageMap({
        '/test.ts': {
          statements: { '0': 0, '1': 0 },
          functions: { '0': 0 },
          branches: { '0': [0, 0] },
        },
      })

      const summary = reporter.getSummary(map)

      expect(summary.statements.pct).toBe(0)
      expect(summary.functions.pct).toBe(0)
      expect(summary.branches.pct).toBe(0)
    })
  })

  describe('checkThresholds', () => {
    it('should pass when coverage meets thresholds', () => {
      const map = createTestCoverageMap({
        '/test.ts': {
          statements: { '0': 1, '1': 1 },
        },
      })
      const summary = reporter.getSummary(map)

      const result = reporter.checkThresholds(summary, { statements: 80 })

      expect(result.passed).toBe(true)
      expect(result.failures).toHaveLength(0)
    })

    it('should fail when coverage is below threshold', () => {
      const map = createTestCoverageMap({
        '/test.ts': {
          statements: { '0': 1, '1': 0 },
        },
      })
      const summary = reporter.getSummary(map)

      const result = reporter.checkThresholds(summary, { statements: 80 })

      expect(result.passed).toBe(false)
      expect(result.failures).toHaveLength(1)
      expect(result.failures[0]).toContain('statements')
    })

    it('should check multiple thresholds', () => {
      const map = createTestCoverageMap({
        '/test.ts': {
          statements: { '0': 1 },
          functions: { '0': 0 },
        },
      })
      const summary = reporter.getSummary(map)

      const result = reporter.checkThresholds(summary, {
        statements: 80,
        functions: 50,
      })

      expect(result.passed).toBe(false)
      expect(result.failures.some((f) => f.includes('functions'))).toBe(true)
    })
  })

  describe('generateReports', () => {
    it('should create output directory', async () => {
      const map = createTestCoverageMap({
        '/test.ts': { statements: { '0': 1 } },
      })

      await reporter.generateReports(map)

      const stats = await fs.stat(testOutputDir)
      expect(stats.isDirectory()).toBe(true)
    })

    it('should return coverage summary', async () => {
      const map = createTestCoverageMap({
        '/test.ts': {
          statements: { '0': 1, '1': 0 },
        },
      })

      const summary = await reporter.generateReports(map)

      expect(summary.statements.total).toBe(2)
      expect(summary.statements.covered).toBe(1)
    })
  })

  describe('writeCoverageJson', () => {
    it('should write coverage-final.json', async () => {
      const map = createTestCoverageMap({
        '/test.ts': { statements: { '0': 1 } },
      })

      await fs.mkdir(testOutputDir, { recursive: true })
      const filePath = await reporter.writeCoverageJson(map)

      expect(filePath).toContain('coverage-final.json')
      const content = await fs.readFile(filePath, 'utf-8')
      const data = JSON.parse(content)
      expect(data['/test.ts']).toBeDefined()
    })
  })

  describe('readCoverageJson', () => {
    it('should return null for non-existent file', async () => {
      const result = await reporter.readCoverageJson('/non/existent/path.json')
      expect(result).toBeNull()
    })

    it('should read coverage from JSON file', async () => {
      const map = createTestCoverageMap({
        '/test.ts': { statements: { '0': 1 } },
      })

      await fs.mkdir(testOutputDir, { recursive: true })
      const filePath = await reporter.writeCoverageJson(map)
      const result = await reporter.readCoverageJson(filePath)

      expect(result).not.toBeNull()
      expect(result!.files()).toContain('/test.ts')
    })
  })

  describe('mergeCoverageMaps', () => {
    it('should merge empty maps', async () => {
      const result = await reporter.mergeCoverageMaps()
      expect(result.files()).toHaveLength(0)
    })

    it('should merge single map', async () => {
      const map = createTestCoverageMap({
        '/test.ts': { statements: { '0': 1 } },
      })

      const result = await reporter.mergeCoverageMaps(map)

      expect(result.files()).toContain('/test.ts')
    })

    it('should merge multiple maps', async () => {
      const map1 = createTestCoverageMap({
        '/a.ts': { statements: { '0': 1 } },
      })
      const map2 = createTestCoverageMap({
        '/b.ts': { statements: { '0': 1 } },
      })

      const result = await reporter.mergeCoverageMaps(map1, map2)

      expect(result.files()).toContain('/a.ts')
      expect(result.files()).toContain('/b.ts')
    })
  })

  describe('printSummary', () => {
    it('should not throw when printing summary', () => {
      const map = createTestCoverageMap({
        '/test.ts': {
          statements: { '0': 1, '1': 0 },
          functions: { '0': 1 },
          branches: { '0': [1, 0] },
        },
      })
      const summary = reporter.getSummary(map)

      // Spy on console.log to suppress output
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      expect(() => reporter.printSummary(summary)).not.toThrow()

      consoleSpy.mockRestore()
    })
  })

  describe('formatLine', () => {
    it('should format high coverage with checkmark', () => {
      const line = reporter['formatLine']('Statements', {
        total: 10,
        covered: 9,
        skipped: 0,
        pct: 90,
      })

      expect(line).toContain('90.00%')
      expect(line).toContain('9/10')
      expect(line).toContain('✓ high')
    })

    it('should format medium coverage', () => {
      const line = reporter['formatLine']('Statements', {
        total: 10,
        covered: 6,
        skipped: 0,
        pct: 60,
      })

      expect(line).toContain('◐ medium')
    })

    it('should format low coverage', () => {
      const line = reporter['formatLine']('Statements', {
        total: 10,
        covered: 3,
        skipped: 0,
        pct: 30,
      })

      expect(line).toContain('✗ low')
    })
  })
})
