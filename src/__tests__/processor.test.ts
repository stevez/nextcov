import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import libCoverage from 'istanbul-lib-coverage'
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
