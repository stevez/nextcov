import { describe, it, expect, beforeEach } from 'vitest'
import libCoverage from 'istanbul-lib-coverage'
import type { CoverageMap } from 'istanbul-lib-coverage'
import { CoverageMerger, createMerger, mergeCoverageMaps } from '../merger.js'

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
                locations: [
                  { start: { line: i + 1, column: 0 }, end: { line: i + 1, column: 5 } },
                  { start: { line: i + 1, column: 5 }, end: { line: i + 1, column: 10 } },
                ],
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
      const coverage = result.fileCoverageFor('/test.ts').toJSON()

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
      const coverage = result.fileCoverageFor('/test.ts').toJSON()

      // Should have added implicit branch
      expect(Object.keys(coverage.branchMap).length).toBeGreaterThan(0)
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
      const coverage = result.fileCoverageFor('/test.ts').toJSON()

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
      const coverage = result.fileCoverageFor('/test.ts').toJSON()

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
      const coverage = result.fileCoverageFor('/test.ts').toJSON()

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
  it('should fix empty branches', async () => {
    const merger = new CoverageMerger({ applyFixes: true })
    const map = createTestCoverageMap({
      '/test.ts': { statements: { '0': 1 }, functions: { '0': 1 } },
    })

    const result = await merger.merge(map)
    const coverage = result.fileCoverageFor('/test.ts').toJSON()

    // Should have added implicit branch
    expect(Object.keys(coverage.branchMap).length).toBeGreaterThan(0)
    expect(coverage.b['0']).toBeDefined()
  })

  it('should fix empty functions', async () => {
    const merger = new CoverageMerger({ applyFixes: true })
    const map = createTestCoverageMap({
      '/test.ts': { statements: { '0': 1 } },
    })

    const result = await merger.merge(map)
    const coverage = result.fileCoverageFor('/test.ts').toJSON()

    // Should have added implicit function
    expect(Object.keys(coverage.fnMap).length).toBeGreaterThan(0)
  })

  it('should mark implicit branch as covered when statement was covered', async () => {
    const merger = new CoverageMerger({ applyFixes: true })
    const map = createTestCoverageMap({
      '/test.ts': { statements: { '0': 1 } },
    })

    const result = await merger.merge(map)
    const coverage = result.fileCoverageFor('/test.ts').toJSON()

    // Implicit branch should be marked as covered since statement was covered
    expect(coverage.b['0'][0]).toBeGreaterThan(0)
  })

  it('should mark implicit branch as uncovered when no statements covered', async () => {
    const merger = new CoverageMerger({ applyFixes: true })
    const map = createTestCoverageMap({
      '/test.ts': { statements: { '0': 0 } },
    })

    const result = await merger.merge(map)
    const coverage = result.fileCoverageFor('/test.ts').toJSON()

    // Implicit branch should be uncovered
    expect(coverage.b['0'][0]).toBe(0)
  })
})

describe('CoverageMerger - structure preference', () => {
  it('should use more-items structure preference by default', async () => {
    const merger = new CoverageMerger({ applyFixes: false })
    const map1 = createTestCoverageMap({
      '/test.ts': { statements: { '0': 1 } },
    })
    const map2 = createTestCoverageMap({
      '/test.ts': { statements: { '0': 0, '1': 1, '2': 1 } },
    })

    const result = await merger.merge(map1, map2)
    const coverage = result.fileCoverageFor('/test.ts').toJSON()

    // Should have 3 statements (more items wins)
    expect(Object.keys(coverage.statementMap).length).toBe(3)
  })
})
