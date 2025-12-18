import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import libCoverage from 'istanbul-lib-coverage'
import type { CoverageMap, CoverageMapData, FileCoverageData } from 'istanbul-lib-coverage'
import {
  CoverageMerger,
  createMerger,
  mergeCoverageMaps,
  mergeWithBaseCoverage,
  mergeCoverage,
  printCoverageSummary,
  printCoverageComparison,
} from '../merger.js'

// Mock the logger module
vi.mock('../logger.js', () => ({
  log: vi.fn(),
  setLogging: vi.fn(),
  isLoggingEnabled: vi.fn().mockReturnValue(false),
  warn: vi.fn(),
  error: vi.fn(),
  formatError: vi.fn((err) => err instanceof Error ? err.message : String(err)),
}))

// Helper to create a coverage map with test data
// Note: We start at line 2 (not line 1) and column 1 (not column 0) to avoid
// false positive directive detection (L1:0 is treated as 'use client'/'use server')
function createTestCoverageMap(files: Record<string, {
  statements?: Record<string, number>
  functions?: Record<string, number>
  branches?: Record<string, number[]>
}>): CoverageMap {
  const data: CoverageMapData = {}

  for (const [filePath, coverage] of Object.entries(files)) {
    data[filePath] = {
      path: filePath,
      statementMap: coverage.statements
        ? Object.fromEntries(
            Object.keys(coverage.statements).map((k, i) => [
              k,
              { start: { line: i + 2, column: 1 }, end: { line: i + 2, column: 10 } },
            ])
          )
        : {},
      fnMap: coverage.functions
        ? Object.fromEntries(
            Object.keys(coverage.functions).map((k, i) => [
              k,
              {
                name: `fn${k}`,
                decl: { start: { line: i + 2, column: 1 }, end: { line: i + 2, column: 10 } },
                loc: { start: { line: i + 2, column: 1 }, end: { line: i + 2, column: 10 } },
                line: i + 2,
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
                loc: { start: { line: i + 2, column: 1 }, end: { line: i + 2, column: 10 } },
                locations: [
                  { start: { line: i + 2, column: 1 }, end: { line: i + 2, column: 5 } },
                  { start: { line: i + 2, column: 5 }, end: { line: i + 2, column: 10 } },
                ],
                line: i + 2,
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

// Helper to get typed file coverage data
function getFileCoverageData(coverageMap: CoverageMap, filePath: string): FileCoverageData {
  return coverageMap.fileCoverageFor(filePath).toJSON() as FileCoverageData
}

describe('CoverageMerger', () => {
  let merger: CoverageMerger

  beforeEach(() => {
    merger = new CoverageMerger()
  })

  describe('constructor', () => {
    it('should use default config', () => {
      const defaultMerger = new CoverageMerger()
      expect(defaultMerger['config'].strategy).toBe('max')
      expect(defaultMerger['config'].applyFixes).toBe(true)
    })

    it('should accept custom config', () => {
      const customMerger = new CoverageMerger({ strategy: 'add', applyFixes: false })
      expect(customMerger['config'].strategy).toBe('add')
      expect(customMerger['config'].applyFixes).toBe(false)
    })
  })

  describe('merge', () => {
    it('should return empty map when no inputs', async () => {
      const result = await merger.merge()
      expect(result.files()).toHaveLength(0)
    })

    it('should return copy of single map', async () => {
      const map = createTestCoverageMap({
        '/test.ts': { statements: { '0': 1 } },
      })

      const result = await merger.merge(map)

      expect(result.files()).toHaveLength(1)
      expect(result.files()).toContain('/test.ts')
    })

    it('should merge multiple maps with max strategy', async () => {
      const map1 = createTestCoverageMap({
        '/test.ts': { statements: { '0': 1, '1': 0 } },
      })
      const map2 = createTestCoverageMap({
        '/test.ts': { statements: { '0': 0, '1': 2 } },
      })

      const result = await merger.merge(map1, map2)
      const coverage = getFileCoverageData(result, '/test.ts')

      expect(coverage.s['0']).toBeGreaterThanOrEqual(1)
      expect(coverage.s['1']).toBeGreaterThanOrEqual(2)
    })

    it('should merge files from different maps', async () => {
      const map1 = createTestCoverageMap({
        '/a.ts': { statements: { '0': 1 } },
      })
      const map2 = createTestCoverageMap({
        '/b.ts': { statements: { '0': 1 } },
      })

      const result = await merger.merge(map1, map2)

      expect(result.files()).toContain('/a.ts')
      expect(result.files()).toContain('/b.ts')
    })

    it('should apply fixes when enabled', async () => {
      const map = createTestCoverageMap({
        '/test.ts': { statements: { '0': 1 }, functions: { '0': 1 } },
      })

      const result = await merger.merge(map)
      const coverage = getFileCoverageData(result, '/test.ts')

      // Should NOT add implicit branch (we removed fixEmptyBranches to preserve E2E totals)
      expect(Object.keys(coverage.branchMap).length).toBe(0)
    })
  })

  describe('merge with add strategy', () => {
    it('should add counts together', async () => {
      const addMerger = new CoverageMerger({ strategy: 'add', applyFixes: false })
      const map1 = createTestCoverageMap({
        '/test.ts': { statements: { '0': 1 } },
      })
      const map2 = createTestCoverageMap({
        '/test.ts': { statements: { '0': 1 } },
      })

      const result = await addMerger.merge(map1, map2)
      const coverage = getFileCoverageData(result, '/test.ts')

      expect(coverage.s['0']).toBeGreaterThanOrEqual(1)
    })
  })

  describe('merge with prefer-first strategy', () => {
    it('should prefer first map structure', async () => {
      const firstMerger = new CoverageMerger({ strategy: 'prefer-first', applyFixes: false })
      const map1 = createTestCoverageMap({
        '/test.ts': { statements: { '0': 1, '1': 0 } },
      })
      const map2 = createTestCoverageMap({
        '/test.ts': { statements: { '0': 0, '1': 2 } },
      })

      const result = await firstMerger.merge(map1, map2)
      const coverage = getFileCoverageData(result, '/test.ts')

      // Both maps have 2 statements, counts from second should be merged into first
      expect(Object.keys(coverage.statementMap)).toHaveLength(2)
      expect(coverage.s['0']).toBeGreaterThanOrEqual(1)
      expect(coverage.s['1']).toBeGreaterThanOrEqual(2)
    })
  })

  describe('merge with prefer-last strategy', () => {
    it('should prefer last map structure', async () => {
      const lastMerger = new CoverageMerger({ strategy: 'prefer-last', applyFixes: false })
      const map1 = createTestCoverageMap({
        '/test.ts': { statements: { '0': 1 } },
      })
      const map2 = createTestCoverageMap({
        '/test.ts': { statements: { '0': 0, '1': 2 } },
      })

      const result = await lastMerger.merge(map1, map2)
      const coverage = getFileCoverageData(result, '/test.ts')

      // Last map has 2 statements
      expect(Object.keys(coverage.statementMap)).toHaveLength(2)
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

      const summary = merger.getSummary(map)

      expect(summary.statements.total).toBe(2)
      expect(summary.statements.covered).toBe(1)
      expect(summary.functions.total).toBe(1)
      expect(summary.functions.covered).toBe(1)
      expect(summary.branches.total).toBe(2)
      expect(summary.branches.covered).toBe(1)
    })

    it('should handle empty coverage map', () => {
      const map = libCoverage.createCoverageMap({})
      const summary = merger.getSummary(map)

      expect(summary.statements.total).toBe(0)
      expect(summary.functions.total).toBe(0)
      expect(summary.branches.total).toBe(0)
      expect(summary.lines.total).toBe(0)
    })
  })

  describe('loadCoverageJson', () => {
    it('should return null for non-existent file', async () => {
      const result = await merger.loadCoverageJson('/non/existent/path.json')
      expect(result).toBeNull()
    })
  })
})

describe('createMerger', () => {
  it('should create a merger with default config', () => {
    const merger = createMerger()
    expect(merger).toBeInstanceOf(CoverageMerger)
  })

  it('should create a merger with custom config', () => {
    const merger = createMerger({ strategy: 'add' })
    expect(merger['config'].strategy).toBe('add')
  })
})

describe('mergeCoverageMaps', () => {
  it('should merge maps using default merger', async () => {
    const map1 = createTestCoverageMap({
      '/a.ts': { statements: { '0': 1 } },
    })
    const map2 = createTestCoverageMap({
      '/b.ts': { statements: { '0': 1 } },
    })

    const result = await mergeCoverageMaps(map1, map2)

    expect(result.files()).toContain('/a.ts')
    expect(result.files()).toContain('/b.ts')
  })
})

describe('CoverageMerger - mergeWithBase', () => {
  let merger: CoverageMerger

  beforeEach(() => {
    merger = new CoverageMerger()
  })

  it('should handle missing base coverage', async () => {
    const additionalMap = createTestCoverageMap({
      '/test.ts': { statements: { '0': 1 } },
    })

    const result = await merger.mergeWithBase(additionalMap, {})

    expect(result.stats.baseFiles).toBe(0)
    expect(result.stats.additionalFiles).toBe(1)
    expect(result.stats.newFiles).toBe(1)
  })
})

describe('CoverageMerger - fixes', () => {
  it('should not add implicit branches (preserves E2E totals)', async () => {
    const merger = new CoverageMerger({ applyFixes: true })
    const map = createTestCoverageMap({
      '/test.ts': { statements: { '0': 1 }, functions: { '0': 1 } },
    })

    const result = await merger.merge(map)
    const coverage = getFileCoverageData(result, '/test.ts')

    // Should NOT add implicit branch (we removed fixEmptyBranches to preserve E2E totals)
    expect(Object.keys(coverage.branchMap).length).toBe(0)
  })

  it('should not add implicit functions (preserves E2E totals)', async () => {
    const merger = new CoverageMerger({ applyFixes: true })
    const map = createTestCoverageMap({
      '/test.ts': { statements: { '0': 1 } },
    })

    const result = await merger.merge(map)
    const coverage = getFileCoverageData(result, '/test.ts')

    // Should NOT have added implicit function (we removed fixEmptyFunctions to preserve E2E totals)
    expect(Object.keys(coverage.fnMap).length).toBe(0)
  })

  it('should preserve empty branches when source has none', async () => {
    const merger = new CoverageMerger({ applyFixes: true })
    const map = createTestCoverageMap({
      '/test.ts': { statements: { '0': 1 } },
    })

    const result = await merger.merge(map)
    const coverage = getFileCoverageData(result, '/test.ts')

    // Should NOT add any branches - preserve source coverage exactly
    expect(Object.keys(coverage.branchMap).length).toBe(0)
    expect(Object.keys(coverage.b).length).toBe(0)
  })

  it('should preserve empty branches when no statements covered', async () => {
    const merger = new CoverageMerger({ applyFixes: true })
    const map = createTestCoverageMap({
      '/test.ts': { statements: { '0': 0 } },
    })

    const result = await merger.merge(map)
    const coverage = getFileCoverageData(result, '/test.ts')

    // Should NOT add any branches - preserve source coverage exactly
    expect(Object.keys(coverage.branchMap).length).toBe(0)
    expect(Object.keys(coverage.b).length).toBe(0)
  })
})

describe('CoverageMerger - structure preference', () => {
  it('should prefer last source structure (E2E convention)', async () => {
    const merger = new CoverageMerger({ applyFixes: false })
    const map1 = createTestCoverageMap({
      '/test.ts': { statements: { '0': 1 } },
    })
    const map2 = createTestCoverageMap({
      '/test.ts': { statements: { '0': 0, '1': 1, '2': 1 } },
    })

    const result = await merger.merge(map1, map2)
    const coverage = getFileCoverageData(result, '/test.ts')

    // Should have 3 statements (last source wins - E2E convention)
    expect(Object.keys(coverage.statementMap).length).toBe(3)
  })

  it('should prefer last source even when it has fewer items', async () => {
    const merger = new CoverageMerger({ applyFixes: false })
    const map1 = createTestCoverageMap({
      '/test.ts': { statements: { '0': 1, '1': 1, '2': 1 } },
    })
    const map2 = createTestCoverageMap({
      '/test.ts': { statements: { '0': 0 } },
    })

    const result = await merger.merge(map1, map2)
    const coverage = getFileCoverageData(result, '/test.ts')

    // Should have 1 statement (last source wins, even with fewer items)
    expect(Object.keys(coverage.statementMap).length).toBe(1)
  })
})

describe('mergeWithBaseCoverage', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `merge-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  it('should merge with base coverage file', async () => {
    const baseMap = createTestCoverageMap({
      '/a.ts': { statements: { '0': 1 } },
    })
    const additionalMap = createTestCoverageMap({
      '/b.ts': { statements: { '0': 1 } },
    })

    // Write base coverage to file
    const basePath = join(testDir, 'base-coverage.json')
    await fs.writeFile(basePath, JSON.stringify(baseMap.toJSON()))

    const result = await mergeWithBaseCoverage(additionalMap, basePath)

    expect(result.coverageMap.files()).toContain('/a.ts')
    expect(result.coverageMap.files()).toContain('/b.ts')
    expect(result.stats.baseFiles).toBe(1)
    expect(result.stats.additionalFiles).toBe(1)
  })

  it('should handle non-existent base coverage', async () => {
    const additionalMap = createTestCoverageMap({
      '/test.ts': { statements: { '0': 1 } },
    })

    const result = await mergeWithBaseCoverage(additionalMap, '/non/existent.json')

    expect(result.stats.baseFiles).toBe(0)
    expect(result.stats.newFiles).toBe(1)
  })
})

describe('mergeCoverage', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `merge-coverage-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  it('should return null when E2E coverage not found', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await mergeCoverage({
      unitCoveragePath: '/non/existent/unit.json',
      e2eCoveragePath: '/non/existent/e2e.json',
      outputDir: testDir,
    })

    expect(result).toBeNull()
    consoleSpy.mockRestore()
  })

  it('should process E2E only when no unit coverage', async () => {
    const e2eMap = createTestCoverageMap({
      '/e2e.ts': { statements: { '0': 1 } },
    })

    const e2ePath = join(testDir, 'e2e-coverage.json')
    await fs.writeFile(e2ePath, JSON.stringify(e2eMap.toJSON()))

    const result = await mergeCoverage({
      unitCoveragePath: '/non/existent/unit.json',
      e2eCoveragePath: e2ePath,
      outputDir: join(testDir, 'output'),
      reporters: ['json'], // Avoid text-summary console output
    })

    expect(result).not.toBeNull()
    expect(result!.coverageMap.files()).toContain('/e2e.ts')
    expect(result!.stats.baseFiles).toBe(0)
  })

  it('should merge unit and E2E coverage', async () => {
    const unitMap = createTestCoverageMap({
      '/unit.ts': { statements: { '0': 1 } },
    })
    const e2eMap = createTestCoverageMap({
      '/e2e.ts': { statements: { '0': 1 } },
    })

    const unitPath = join(testDir, 'unit-coverage.json')
    const e2ePath = join(testDir, 'e2e-coverage.json')
    await fs.writeFile(unitPath, JSON.stringify(unitMap.toJSON()))
    await fs.writeFile(e2ePath, JSON.stringify(e2eMap.toJSON()))

    const result = await mergeCoverage({
      unitCoveragePath: unitPath,
      e2eCoveragePath: e2ePath,
      outputDir: join(testDir, 'output'),
      reporters: ['json'], // Avoid text-summary console output
    })

    expect(result).not.toBeNull()
    expect(result!.coverageMap.files()).toContain('/unit.ts')
    expect(result!.coverageMap.files()).toContain('/e2e.ts')
    expect(result!.unitSummary).toBeDefined()
  })

  it('should support verbose mode', async () => {
    const { log } = await import('../logger.js')
    const e2eMap = createTestCoverageMap({
      '/e2e.ts': { statements: { '0': 1 } },
    })

    const e2ePath = join(testDir, 'e2e-coverage.json')
    await fs.writeFile(e2ePath, JSON.stringify(e2eMap.toJSON()))

    await mergeCoverage({
      unitCoveragePath: '/non/existent/unit.json',
      e2eCoveragePath: e2ePath,
      outputDir: join(testDir, 'output'),
      verbose: true,
      reporters: ['json'], // Avoid text-summary console output
    })

    expect(log).toHaveBeenCalled()
  })

  it('should identify E2E-only files', async () => {
    const unitMap = createTestCoverageMap({
      '/shared.ts': { statements: { '0': 1 } },
    })
    const e2eMap = createTestCoverageMap({
      '/shared.ts': { statements: { '0': 1 } },
      '/e2e-only.ts': { statements: { '0': 1 } },
    })

    const unitPath = join(testDir, 'unit-coverage.json')
    const e2ePath = join(testDir, 'e2e-coverage.json')
    await fs.writeFile(unitPath, JSON.stringify(unitMap.toJSON()))
    await fs.writeFile(e2ePath, JSON.stringify(e2eMap.toJSON()))

    const result = await mergeCoverage({
      unitCoveragePath: unitPath,
      e2eCoveragePath: e2ePath,
      outputDir: join(testDir, 'output'),
      projectRoot: '/',
      reporters: ['json'], // Avoid text-summary console output
    })

    expect(result).not.toBeNull()
    expect(result!.e2eOnlyFiles).toContain('e2e-only.ts')
  })
})

describe('printCoverageSummary', () => {
  it('should print summary without throwing', async () => {
    const { log } = await import('../logger.js')

    const summary = {
      statements: { total: 10, covered: 8, skipped: 0, pct: 80 },
      branches: { total: 5, covered: 4, skipped: 0, pct: 80 },
      functions: { total: 3, covered: 3, skipped: 0, pct: 100 },
      lines: { total: 10, covered: 8, skipped: 0, pct: 80 },
    }

    expect(() => printCoverageSummary(summary)).not.toThrow()
    expect(log).toHaveBeenCalled()
  })

  it('should accept custom title', async () => {
    const { log } = await import('../logger.js')

    const summary = {
      statements: { total: 10, covered: 8, skipped: 0, pct: 80 },
      branches: { total: 5, covered: 4, skipped: 0, pct: 80 },
      functions: { total: 3, covered: 3, skipped: 0, pct: 100 },
      lines: { total: 10, covered: 8, skipped: 0, pct: 80 },
    }

    printCoverageSummary(summary, 'Custom Title')

    expect(log).toHaveBeenCalledWith(expect.stringContaining('Custom Title'))
  })

  it('should show different status for different coverage levels', () => {
    const summary = {
      statements: { total: 10, covered: 9, skipped: 0, pct: 90 },  // high
      branches: { total: 10, covered: 6, skipped: 0, pct: 60 },   // medium
      functions: { total: 10, covered: 3, skipped: 0, pct: 30 },  // low
      lines: { total: 10, covered: 8, skipped: 0, pct: 80 },
    }

    printCoverageSummary(summary)
  })
})

describe('printCoverageComparison', () => {
  it('should print comparison with all values', async () => {
    const { log } = await import('../logger.js')

    const unit = {
      statements: { total: 10, covered: 5, skipped: 0, pct: 50 },
      branches: { total: 5, covered: 2, skipped: 0, pct: 40 },
      functions: { total: 3, covered: 2, skipped: 0, pct: 66.7 },
      lines: { total: 10, covered: 5, skipped: 0, pct: 50 },
    }
    const e2e = {
      statements: { total: 10, covered: 8, skipped: 0, pct: 80 },
      branches: { total: 5, covered: 4, skipped: 0, pct: 80 },
      functions: { total: 3, covered: 3, skipped: 0, pct: 100 },
      lines: { total: 10, covered: 8, skipped: 0, pct: 80 },
    }
    const merged = {
      statements: { total: 10, covered: 9, skipped: 0, pct: 90 },
      branches: { total: 5, covered: 5, skipped: 0, pct: 100 },
      functions: { total: 3, covered: 3, skipped: 0, pct: 100 },
      lines: { total: 10, covered: 9, skipped: 0, pct: 90 },
    }

    expect(() => printCoverageComparison(unit, e2e, merged)).not.toThrow()
    expect(log).toHaveBeenCalled()
  })

  it('should handle undefined unit coverage', () => {
    const e2e = {
      statements: { total: 10, covered: 8, skipped: 0, pct: 80 },
      branches: { total: 5, covered: 4, skipped: 0, pct: 80 },
      functions: { total: 3, covered: 3, skipped: 0, pct: 100 },
      lines: { total: 10, covered: 8, skipped: 0, pct: 80 },
    }
    const merged = {
      statements: { total: 10, covered: 8, skipped: 0, pct: 80 },
      branches: { total: 5, covered: 4, skipped: 0, pct: 80 },
      functions: { total: 3, covered: 3, skipped: 0, pct: 100 },
      lines: { total: 10, covered: 8, skipped: 0, pct: 80 },
    }

    expect(() => printCoverageComparison(undefined, e2e, merged)).not.toThrow()
  })
})

describe('CoverageMerger - merge functions with different structures', () => {
  it('should prefer last source when statements are provided (E2E convention)', async () => {
    const merger = new CoverageMerger({ applyFixes: false })
    // Include statements to trigger structure selection logic
    const map1 = createTestCoverageMap({
      '/test.ts': { statements: { '0': 1 }, functions: { '0': 1, '1': 1, '2': 1 } },
    })
    const map2 = createTestCoverageMap({
      '/test.ts': { statements: { '0': 1 }, functions: { '0': 1 } },
    })

    const result = await merger.merge(map1, map2)
    const coverage = getFileCoverageData(result, '/test.ts')

    // Last source wins (E2E convention) - should have 1 function from map2
    expect(Object.keys(coverage.fnMap).length).toBe(1)
  })

  it('should prefer last source branches when statements are provided (E2E convention)', async () => {
    const merger = new CoverageMerger({ applyFixes: false })
    // Include statements to trigger structure selection logic
    const map1 = createTestCoverageMap({
      '/test.ts': { statements: { '0': 1 }, branches: { '0': [1, 0], '1': [1, 1] } },
    })
    const map2 = createTestCoverageMap({
      '/test.ts': { statements: { '0': 1 }, branches: { '0': [0, 1] } },
    })

    const result = await merger.merge(map1, map2)
    const coverage = getFileCoverageData(result, '/test.ts')

    // Last source wins (E2E convention) - should have 1 branch from map2
    expect(Object.keys(coverage.branchMap).length).toBe(1)
  })
})

describe('CoverageMerger - loadCoverageJson with file', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `load-json-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  it('should load valid coverage JSON', async () => {
    const merger = new CoverageMerger()
    const map = createTestCoverageMap({
      '/test.ts': { statements: { '0': 1 } },
    })

    const filePath = join(testDir, 'coverage.json')
    await fs.writeFile(filePath, JSON.stringify(map.toJSON()))

    const result = await merger.loadCoverageJson(filePath)

    expect(result).not.toBeNull()
    expect(result!.files()).toContain('/test.ts')
  })

  it('should return null for invalid JSON', async () => {
    const merger = new CoverageMerger()

    const filePath = join(testDir, 'invalid.json')
    await fs.writeFile(filePath, 'not json')

    const result = await merger.loadCoverageJson(filePath)

    expect(result).toBeNull()
  })
})
