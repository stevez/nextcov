import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import libCoverage from 'istanbul-lib-coverage'
import { CoverageProcessor, stripC8IgnoreLines } from '../core/processor.js'

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

  describe('rebaseOntoSourceStructure', () => {
    let rebaseTestDir: string
    let rebaseProcessor: CoverageProcessor

    beforeEach(async () => {
      rebaseTestDir = join(tmpdir(), `rebase-test-${Date.now()}`)
      await fs.mkdir(join(rebaseTestDir, 'src'), { recursive: true })

      rebaseProcessor = new CoverageProcessor(rebaseTestDir, {
        outputDir: join(rebaseTestDir, 'coverage'),
        sourceRoot: './src',
        include: ['src/**/*.ts'],
        reporters: ['json'],
      })
    })

    afterEach(async () => {
      try {
        await fs.rm(rebaseTestDir, { recursive: true, force: true })
      } catch { /* ignore */ }
    })

    it('skips rebase when sourceRoot is not configured', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const noSourceProcessor = new CoverageProcessor(rebaseTestDir, {
        outputDir: join(rebaseTestDir, 'coverage'),
        reporters: ['json'],
      })

      const addUncoveredSpy = vi.spyOn(noSourceProcessor['converter'], 'addUncoveredFiles')

      const emptyMap = libCoverage.createCoverageMap({})
      vi.spyOn(noSourceProcessor['reporter'], 'mergeCoverageMaps').mockResolvedValue(emptyMap)
      vi.spyOn(noSourceProcessor['reporter'], 'generateReports').mockResolvedValue({
        statements: { total: 0, covered: 0, pct: 100 },
        branches: { total: 0, covered: 0, pct: 100 },
        functions: { total: 0, covered: 0, pct: 100 },
        lines: { total: 0, covered: 0, pct: 100 },
      })

      await noSourceProcessor.processAllCoverage()

      expect(addUncoveredSpy).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('adds uncovered source files with zero hit counts', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      // Source file that E2E never loaded
      await fs.writeFile(
        join(rebaseTestDir, 'src', 'util.ts'),
        'export function add(a: number, b: number) { return a + b }\n'
      )

      // Empty E2E coverage map — browser never loaded util.ts
      const emptyE2e = libCoverage.createCoverageMap({})
      // mockResolvedValueOnce: only the first call (injecting E2E) is mocked;
      // the second call inside rebaseOntoSourceStructure uses the real merge.
      vi.spyOn(rebaseProcessor['reporter'], 'mergeCoverageMaps').mockResolvedValueOnce(emptyE2e)
      vi.spyOn(rebaseProcessor['reporter'], 'generateReports').mockResolvedValue({
        statements: { total: 1, covered: 0, pct: 0 },
        branches: { total: 0, covered: 0, pct: 100 },
        functions: { total: 1, covered: 0, pct: 0 },
        lines: { total: 1, covered: 0, pct: 0 },
      })

      const result = await rebaseProcessor.processAllCoverage()

      // util.ts should appear with zero counts (correct denominator)
      const files = result.coverageMap.files()
      const utilFile = files.find(f => f.includes('util.ts'))
      expect(utilFile).toBeDefined()

      const fc = result.coverageMap.fileCoverageFor(utilFile!).toJSON() as {
        statementMap: Record<string, unknown>
        s: Record<string, number>
      }
      expect(Object.keys(fc.statementMap).length).toBeGreaterThan(0)
      expect(Object.values(fc.s).every(v => v === 0)).toBe(true)
      consoleSpy.mockRestore()
    })

    it('rebases coarse E2E coverage onto richer esbuild structure', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const srcFile = join(rebaseTestDir, 'src', 'service.ts')
      await fs.writeFile(srcFile, [
        'export function double(n: number) { return n * 2 }',
        'export function triple(n: number) { return n * 3 }',
        'export function square(n: number) { return n * n }',
      ].join('\n'))

      // Coarse E2E coverage: Turbopack collapsed everything into 1 statement.
      // Real Turbopack output has null end.column (coarser nodes), which is how
      // isBabelQuality() distinguishes it from esbuild/Vitest-quality maps.
      const coarseMap = libCoverage.createCoverageMap({
        [srcFile]: {
          path: srcFile,
          statementMap: {
            '0': { start: { line: 1, column: 0 }, end: { line: 1, column: null } },
          },
          fnMap: {},
          branchMap: {},
          s: { '0': 7 },
          f: {},
          b: {},
        } as never,
      })

      vi.spyOn(rebaseProcessor['reporter'], 'mergeCoverageMaps').mockResolvedValueOnce(coarseMap)
      vi.spyOn(rebaseProcessor['reporter'], 'generateReports').mockResolvedValue({
        statements: { total: 3, covered: 1, pct: 33 },
        branches: { total: 0, covered: 0, pct: 100 },
        functions: { total: 3, covered: 1, pct: 33 },
        lines: { total: 3, covered: 1, pct: 33 },
      })

      const result = await rebaseProcessor.processAllCoverage()

      const files = result.coverageMap.files()
      const serviceFile = files.find(f => f.includes('service.ts'))
      expect(serviceFile).toBeDefined()

      const fc = result.coverageMap.fileCoverageFor(serviceFile!).toJSON() as {
        statementMap: Record<string, unknown>
        s: Record<string, number>
      }

      // Rebased map must have MORE statements than the coarse 1-statement input
      expect(Object.keys(fc.statementMap).length).toBeGreaterThan(1)
      consoleSpy.mockRestore()
    })

    it('preserves hit counts after rebase', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const srcFile = join(rebaseTestDir, 'src', 'math.ts')
      await fs.writeFile(srcFile, 'export const PI = 3.14\nexport const E = 2.71\n')

      // E2E coverage with a hit on line 1 — null end.column reflects real Turbopack output
      const e2eMap = libCoverage.createCoverageMap({
        [srcFile]: {
          path: srcFile,
          statementMap: {
            '0': { start: { line: 1, column: 0 }, end: { line: 1, column: null } },
          },
          fnMap: {},
          branchMap: {},
          s: { '0': 3 },
          f: {},
          b: {},
        } as never,
      })

      vi.spyOn(rebaseProcessor['reporter'], 'mergeCoverageMaps').mockResolvedValueOnce(e2eMap)
      vi.spyOn(rebaseProcessor['reporter'], 'generateReports').mockResolvedValue({
        statements: { total: 2, covered: 1, pct: 50 },
        branches: { total: 0, covered: 0, pct: 100 },
        functions: { total: 0, covered: 0, pct: 100 },
        lines: { total: 2, covered: 1, pct: 50 },
      })

      const result = await rebaseProcessor.processAllCoverage()

      const files = result.coverageMap.files()
      const mathFile = files.find(f => f.includes('math.ts'))
      expect(mathFile).toBeDefined()

      const fc = result.coverageMap.fileCoverageFor(mathFile!).toJSON() as {
        s: Record<string, number>
      }

      // At least one statement must have a non-zero hit count (the E2E hit preserved)
      const totalHits = Object.values(fc.s).reduce((sum, v) => sum + v, 0)
      expect(totalHits).toBeGreaterThan(0)
      consoleSpy.mockRestore()
    })
  })
})

describe('stripC8IgnoreLines', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `strip-c8-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true })
    } catch { /* ignore */ }
  })

  function makeMap(filePath: string, coverageData: object) {
    return libCoverage.createCoverageMap({ [filePath]: coverageData as never })
  }

  it('removes statement on the line after // c8 ignore next (bare form)', async () => {
    const filePath = join(testDir, 'a.ts')
    await fs.writeFile(filePath, [
      'const a = 1',      // line 1
      '// c8 ignore next', // line 2
      'const b = 2',      // line 3 — ignored
      'const c = 3',      // line 4
    ].join('\n'))

    const map = makeMap(filePath, {
      path: filePath,
      statementMap: {
        '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 12 } },
        '1': { start: { line: 3, column: 0 }, end: { line: 3, column: 12 } },
        '2': { start: { line: 4, column: 0 }, end: { line: 4, column: 12 } },
      },
      s: { '0': 1, '1': 5, '2': 3 },
      fnMap: {}, f: {}, branchMap: {}, b: {},
    })

    stripC8IgnoreLines(map)

    const data = map.fileCoverageFor(filePath).toJSON() as {
      statementMap: Record<string, unknown>
      s: Record<string, unknown>
    }
    expect(data.statementMap['0']).toBeDefined()    // line 1 — kept
    expect(data.statementMap['1']).toBeUndefined()  // line 3 — removed
    expect(data.s['1']).toBeUndefined()
    expect(data.statementMap['2']).toBeDefined()    // line 4 — kept
  })

  it('removes statement after // istanbul ignore next', async () => {
    const filePath = join(testDir, 'b.ts')
    await fs.writeFile(filePath, [
      'const a = 1',
      '// istanbul ignore next',
      'const b = 2',
    ].join('\n'))

    const map = makeMap(filePath, {
      path: filePath,
      statementMap: {
        '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 12 } },
        '1': { start: { line: 3, column: 0 }, end: { line: 3, column: 12 } },
      },
      s: { '0': 2, '1': 2 },
      fnMap: {}, f: {}, branchMap: {}, b: {},
    })

    stripC8IgnoreLines(map)

    const data = map.fileCoverageFor(filePath).toJSON() as {
      statementMap: Record<string, unknown>
    }
    expect(data.statementMap['0']).toBeDefined()
    expect(data.statementMap['1']).toBeUndefined()
  })

  it('removes statement after /* c8 ignore next */ (block comment form)', async () => {
    const filePath = join(testDir, 'c.ts')
    await fs.writeFile(filePath, [
      'const a = 1',
      '/* c8 ignore next */',
      'const b = 2',
    ].join('\n'))

    const map = makeMap(filePath, {
      path: filePath,
      statementMap: {
        '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 12 } },
        '1': { start: { line: 3, column: 0 }, end: { line: 3, column: 12 } },
      },
      s: { '0': 1, '1': 1 },
      fnMap: {}, f: {}, branchMap: {}, b: {},
    })

    stripC8IgnoreLines(map)

    const data = map.fileCoverageFor(filePath).toJSON() as {
      statementMap: Record<string, unknown>
    }
    expect(data.statementMap['0']).toBeDefined()
    expect(data.statementMap['1']).toBeUndefined()
  })

  it('removes statements inside /* c8 ignore start */ ... /* c8 ignore stop */ block', async () => {
    const filePath = join(testDir, 'd.ts')
    await fs.writeFile(filePath, [
      'const a = 1',          // line 1
      '/* c8 ignore start */', // line 2 — start comment, NOT ignored
      'const b = 2',          // line 3 — ignored
      'const c = 3',          // line 4 — ignored
      '/* c8 ignore stop */', // line 5 — also ignored (stop line is included)
      'const d = 4',          // line 6 — NOT ignored
    ].join('\n'))

    const map = makeMap(filePath, {
      path: filePath,
      statementMap: {
        '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 12 } },
        '1': { start: { line: 3, column: 0 }, end: { line: 3, column: 12 } },
        '2': { start: { line: 4, column: 0 }, end: { line: 4, column: 12 } },
        '3': { start: { line: 6, column: 0 }, end: { line: 6, column: 12 } },
      },
      s: { '0': 1, '1': 1, '2': 1, '3': 1 },
      fnMap: {}, f: {}, branchMap: {}, b: {},
    })

    stripC8IgnoreLines(map)

    const data = map.fileCoverageFor(filePath).toJSON() as {
      statementMap: Record<string, unknown>
    }
    expect(data.statementMap['0']).toBeDefined()    // line 1 — kept
    expect(data.statementMap['1']).toBeUndefined()  // line 3 — removed
    expect(data.statementMap['2']).toBeUndefined()  // line 4 — removed
    expect(data.statementMap['3']).toBeDefined()    // line 6 — kept
  })

  it('does NOT remove statement on the /* c8 ignore start */ line itself', async () => {
    const filePath = join(testDir, 'e.ts')
    await fs.writeFile(filePath, [
      '/* c8 ignore start */', // line 1 — the start comment itself is NOT ignored
      'const b = 2',           // line 2 — ignored
      '/* c8 ignore stop */',  // line 3 — ignored
    ].join('\n'))

    const map = makeMap(filePath, {
      path: filePath,
      statementMap: {
        '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 22 } },
        '1': { start: { line: 2, column: 0 }, end: { line: 2, column: 12 } },
      },
      s: { '0': 1, '1': 1 },
      fnMap: {}, f: {}, branchMap: {}, b: {},
    })

    stripC8IgnoreLines(map)

    const data = map.fileCoverageFor(filePath).toJSON() as {
      statementMap: Record<string, unknown>
    }
    expect(data.statementMap['0']).toBeDefined()    // start line — kept
    expect(data.statementMap['1']).toBeUndefined()  // line 2 — removed
  })

  it('removes functions on ignored lines', async () => {
    const filePath = join(testDir, 'f.ts')
    await fs.writeFile(filePath, [
      'const a = 1',
      '// c8 ignore next',
      'function ignored() { return 1 }',
      'function kept() { return 2 }',
    ].join('\n'))

    const map = makeMap(filePath, {
      path: filePath,
      statementMap: {
        '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 12 } },
        '1': { start: { line: 3, column: 0 }, end: { line: 3, column: 32 } },
        '2': { start: { line: 4, column: 0 }, end: { line: 4, column: 30 } },
      },
      s: { '0': 1, '1': 0, '2': 1 },
      fnMap: {
        '0': { name: 'ignored', decl: { start: { line: 3 }, end: { line: 3 } }, loc: { start: { line: 3 }, end: { line: 3 } }, line: 3 },
        '1': { name: 'kept',    decl: { start: { line: 4 }, end: { line: 4 } }, loc: { start: { line: 4 }, end: { line: 4 } }, line: 4 },
      },
      f: { '0': 0, '1': 5 },
      branchMap: {}, b: {},
    })

    stripC8IgnoreLines(map)

    const data = map.fileCoverageFor(filePath).toJSON() as {
      fnMap: Record<string, unknown>
      f: Record<string, unknown>
    }
    expect(data.fnMap['0']).toBeUndefined()  // ignored function — removed
    expect(data.f['0']).toBeUndefined()
    expect(data.fnMap['1']).toBeDefined()    // kept function — present
    expect(data.f['1']).toBeDefined()
  })

  it('removes branches on ignored lines', async () => {
    const filePath = join(testDir, 'g.ts')
    await fs.writeFile(filePath, [
      'const a = 1',
      '// c8 ignore next',
      'const b = x ? 1 : 2',
      'const c = y ? 3 : 4',
    ].join('\n'))

    const map = makeMap(filePath, {
      path: filePath,
      statementMap: {
        '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 12 } },
        '1': { start: { line: 3, column: 0 }, end: { line: 3, column: 20 } },
        '2': { start: { line: 4, column: 0 }, end: { line: 4, column: 20 } },
      },
      s: { '0': 1, '1': 1, '2': 1 },
      fnMap: {}, f: {},
      branchMap: {
        '0': { type: 'if', loc: { start: { line: 3 }, end: { line: 3 } }, locations: [{ start: { line: 3 } }, { start: { line: 3 } }] },
        '1': { type: 'if', loc: { start: { line: 4 }, end: { line: 4 } }, locations: [{ start: { line: 4 } }, { start: { line: 4 } }] },
      },
      b: { '0': [1, 1], '1': [1, 1] },
    })

    stripC8IgnoreLines(map)

    const data = map.fileCoverageFor(filePath).toJSON() as {
      branchMap: Record<string, unknown>
      b: Record<string, unknown>
    }
    expect(data.branchMap['0']).toBeUndefined()  // ignored branch — removed
    expect(data.b['0']).toBeUndefined()
    expect(data.branchMap['1']).toBeDefined()    // kept branch — present
    expect(data.b['1']).toBeDefined()
  })

  it('skips gracefully when the source file does not exist', async () => {
    const missingFile = join(testDir, 'does-not-exist.ts')

    const map = makeMap(missingFile, {
      path: missingFile,
      statementMap: {
        '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 12 } },
      },
      s: { '0': 1 },
      fnMap: {}, f: {}, branchMap: {}, b: {},
    })

    // Should not throw
    expect(() => stripC8IgnoreLines(map)).not.toThrow()

    // Coverage data should be untouched since file wasn't readable
    const data = map.fileCoverageFor(missingFile).toJSON() as {
      statementMap: Record<string, unknown>
    }
    expect(data.statementMap['0']).toBeDefined()
  })

  it('handles istanbul variant of block ignore comments', async () => {
    const filePath = join(testDir, 'h.ts')
    await fs.writeFile(filePath, [
      '/* istanbul ignore start */',
      'const a = 1',
      '/* istanbul ignore stop */',
      'const b = 2',
    ].join('\n'))

    const map = makeMap(filePath, {
      path: filePath,
      statementMap: {
        '0': { start: { line: 2, column: 0 }, end: { line: 2, column: 12 } },
        '1': { start: { line: 4, column: 0 }, end: { line: 4, column: 12 } },
      },
      s: { '0': 1, '1': 1 },
      fnMap: {}, f: {}, branchMap: {}, b: {},
    })

    stripC8IgnoreLines(map)

    const data = map.fileCoverageFor(filePath).toJSON() as {
      statementMap: Record<string, unknown>
    }
    expect(data.statementMap['0']).toBeUndefined()  // inside block — removed
    expect(data.statementMap['1']).toBeDefined()    // after stop — kept
  })
})
