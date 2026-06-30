import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'fs'
import { promises as fsPromises, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  parseMergeArgs,
  MERGE_HELP,
  validateInputDirectories,
  executeMerge,
  stripCoverageDirectives,
} from '../cli/commands/merge.js'

// Mock fs module but keep readFileSync for integration tests
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: vi.fn(),
  }
})

// Create mock functions that can be controlled per test
const mockGenerateReports = vi.fn().mockResolvedValue(undefined)
const mockLoadCoverageJson = vi.fn().mockResolvedValue({
  files: () => ['file1.ts'],
  fileCoverageFor: vi.fn(),
})
const mockMerge = vi.fn().mockResolvedValue({
  files: () => ['file1.ts', 'file2.ts'],
  fileCoverageFor: vi.fn(),
})

// Mock reporter and merger modules with class syntax
vi.mock('../core/reporter.js', () => ({
  IstanbulReporter: class MockIstanbulReporter {
    constructor() {}
    generateReports = mockGenerateReports
  },
}))

vi.mock('../merger/index.js', () => ({
  createMerger: () => ({
    loadCoverageJson: mockLoadCoverageJson,
    merge: mockMerge,
  }),
}))

vi.mock('../merger/rebase.js', () => ({
  rebaseCoarserMaps: (maps: unknown[]) => maps,
  countRebasedFiles: () => 0,
}))

describe('CLI merge command', () => {
  describe('MERGE_HELP constant', () => {
    it('should contain usage information', () => {
      expect(MERGE_HELP).toContain('nextcov merge')
      expect(MERGE_HELP).toContain('Usage:')
      expect(MERGE_HELP).toContain('Options:')
    })

    it('should contain examples', () => {
      expect(MERGE_HELP).toContain('Examples:')
      expect(MERGE_HELP).toContain('npx nextcov merge')
    })
  })

  describe('MERGE_HELP constant', () => {
    it('should contain merge usage information', () => {
      expect(MERGE_HELP).toContain('merge')
      expect(MERGE_HELP).toContain('Coverage directories')
      expect(MERGE_HELP).toContain('--output')
      expect(MERGE_HELP).toContain('--reporters')
    })

    it('should contain examples', () => {
      expect(MERGE_HELP).toContain('Examples:')
      expect(MERGE_HELP).toContain('coverage/unit')
    })
  })

  describe('parseMergeArgs', () => {
    describe('help flags', () => {
      it('should return showHelp for --help', () => {
        const result = parseMergeArgs(['--help'])

        expect(result.showHelp).toBe(true)
        expect(result.error).toBeUndefined()
        expect(result.options).toBeUndefined()
      })

      it('should return showHelp for -h', () => {
        const result = parseMergeArgs(['-h'])

        expect(result.showHelp).toBe(true)
        expect(result.error).toBeUndefined()
      })

      it('should return showHelp when --help is mixed with other args', () => {
        const result = parseMergeArgs(['some/dir', '--help'])

        expect(result.showHelp).toBe(true)
      })
    })

    describe('input directories', () => {
      it('should parse single input directory', () => {
        const result = parseMergeArgs(['coverage/unit'])

        expect(result.options).toBeDefined()
        expect(result.options!.inputs).toEqual(['coverage/unit'])
      })

      it('should parse multiple input directories', () => {
        const result = parseMergeArgs(['coverage/unit', 'coverage/e2e', 'coverage/browser'])

        expect(result.options).toBeDefined()
        expect(result.options!.inputs).toEqual(['coverage/unit', 'coverage/e2e', 'coverage/browser'])
      })

      it('should error when no directories specified', () => {
        const result = parseMergeArgs([])

        expect(result.error).toBe('No coverage directories specified')
        expect(result.showHelp).toBe(true)
        expect(result.options).toBeUndefined()
      })
    })

    describe('output option', () => {
      it('should use default output directory', () => {
        const result = parseMergeArgs(['coverage/unit'])

        expect(result.options!.output).toBe('./coverage/merged')
      })

      it('should parse -o option', () => {
        const result = parseMergeArgs(['coverage/unit', '-o', 'custom/output'])

        expect(result.options!.output).toBe('custom/output')
      })

      it('should parse --output option', () => {
        const result = parseMergeArgs(['coverage/unit', '--output', 'custom/output'])

        expect(result.options!.output).toBe('custom/output')
      })

      it('should error when -o has no value', () => {
        const result = parseMergeArgs(['coverage/unit', '-o'])

        expect(result.error).toBe('Missing value for -o')
        expect(result.options).toBeUndefined()
      })

      it('should error when --output has no value', () => {
        const result = parseMergeArgs(['coverage/unit', '--output'])

        expect(result.error).toBe('Missing value for --output')
        expect(result.options).toBeUndefined()
      })
    })

    describe('reporters option', () => {
      it('should use default reporters', () => {
        const result = parseMergeArgs(['coverage/unit'])

        expect(result.options!.reporters).toEqual(['html', 'lcov', 'json', 'text-summary'])
      })

      it('should parse --reporters option', () => {
        const result = parseMergeArgs(['coverage/unit', '--reporters', 'html,lcov'])

        expect(result.options!.reporters).toEqual(['html', 'lcov'])
      })

      it('should trim whitespace in reporters', () => {
        const result = parseMergeArgs(['coverage/unit', '--reporters', 'html , lcov , json'])

        expect(result.options!.reporters).toEqual(['html', 'lcov', 'json'])
      })

      it('should error when --reporters has no value', () => {
        const result = parseMergeArgs(['coverage/unit', '--reporters'])

        expect(result.error).toBe('Missing value for --reporters')
        expect(result.options).toBeUndefined()
      })
    })

    describe('unknown options', () => {
      it('should error for unknown option', () => {
        const result = parseMergeArgs(['coverage/unit', '--unknown'])

        expect(result.error).toBe('Unknown option: --unknown')
        expect(result.showHelp).toBe(true)
      })

      it('should error for unknown short option', () => {
        const result = parseMergeArgs(['coverage/unit', '-x'])

        expect(result.error).toBe('Unknown option: -x')
        expect(result.showHelp).toBe(true)
      })
    })

    describe('complex argument combinations', () => {
      it('should parse multiple directories with output', () => {
        const result = parseMergeArgs([
          'coverage/unit',
          'coverage/e2e',
          '-o',
          'coverage/all',
        ])

        expect(result.options).toBeDefined()
        expect(result.options!.inputs).toEqual(['coverage/unit', 'coverage/e2e'])
        expect(result.options!.output).toBe('coverage/all')
      })

      it('should parse directories with all options', () => {
        const result = parseMergeArgs([
          'coverage/unit',
          'coverage/e2e',
          '-o',
          'coverage/merged',
          '--reporters',
          'json,html',
        ])

        expect(result.options).toBeDefined()
        expect(result.options!.inputs).toEqual(['coverage/unit', 'coverage/e2e'])
        expect(result.options!.output).toBe('coverage/merged')
        expect(result.options!.reporters).toEqual(['json', 'html'])
      })

      it('should handle options before directories', () => {
        const result = parseMergeArgs([
          '-o',
          'output',
          '--reporters',
          'json',
          'coverage/unit',
          'coverage/e2e',
        ])

        expect(result.options).toBeDefined()
        expect(result.options!.inputs).toEqual(['coverage/unit', 'coverage/e2e'])
        expect(result.options!.output).toBe('output')
        expect(result.options!.reporters).toEqual(['json'])
      })

      it('should handle options between directories', () => {
        const result = parseMergeArgs([
          'coverage/unit',
          '-o',
          'output',
          'coverage/e2e',
        ])

        expect(result.options).toBeDefined()
        expect(result.options!.inputs).toEqual(['coverage/unit', 'coverage/e2e'])
        expect(result.options!.output).toBe('output')
      })
    })
  })

  describe('validateInputDirectories', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should return coverage files when all directories exist', () => {
      vi.mocked(existsSync).mockReturnValue(true)

      const result = validateInputDirectories(['coverage/unit', 'coverage/e2e'])

      expect(result.error).toBeUndefined()
      expect(result.coverageFiles).toHaveLength(2)
      expect(result.coverageFiles[0]).toContain('coverage-final.json')
      expect(result.coverageFiles[1]).toContain('coverage-final.json')
    })

    it('should skip missing directories and track them in skipped array', () => {
      vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(false)

      const result = validateInputDirectories(['coverage/unit', 'coverage/missing'])

      // With only 1 valid directory, we need at least 2 to merge
      expect(result.error).toContain('Need at least 2 coverage directories to merge')
      expect(result.skipped).toContain('coverage/missing')
    })

    it('should return error when all directories are missing', () => {
      vi.mocked(existsSync).mockReturnValue(false)

      const result = validateInputDirectories(['coverage/missing'])

      expect(result.error).toContain('No coverage files found in any of the specified directories')
      expect(result.skipped).toContain('coverage/missing')
    })
  })

  describe('executeMerge', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      // Reset mocks to default successful behavior
      mockGenerateReports.mockResolvedValue(undefined)
      mockLoadCoverageJson.mockResolvedValue({
        files: () => ['file1.ts'],
        fileCoverageFor: vi.fn(),
      })
      mockMerge.mockResolvedValue({
        files: () => ['file1.ts', 'file2.ts'],
        fileCoverageFor: vi.fn(),
      })
    })

    it('should return error when validation fails (all missing)', async () => {
      vi.mocked(existsSync).mockReturnValue(false)

      const result = await executeMerge({
        inputs: ['coverage/missing'],
        output: './coverage/merged',
        reporters: ['html'],
        strip: false,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('No coverage files found in any of the specified directories')
    })

    it('should successfully merge coverage files', async () => {
      vi.mocked(existsSync).mockReturnValue(true)

      const result = await executeMerge({
        inputs: ['coverage/unit', 'coverage/e2e'],
        output: './coverage/merged',
        reporters: ['html', 'lcov'],
        strip: false,
      })

      expect(result.success).toBe(true)
      expect(result.outputDir).toBeDefined()
    })

    it('should return error when only single coverage directory provided', async () => {
      vi.mocked(existsSync).mockReturnValue(true)

      const result = await executeMerge({
        inputs: ['coverage/unit'],
        output: './coverage/merged',
        reporters: ['json'],
        strip: false,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Need at least 2 coverage directories to merge')
    })

    it('should return error when loadCoverageJson returns null', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      mockLoadCoverageJson.mockResolvedValueOnce(null)

      const result = await executeMerge({
        inputs: ['coverage/unit', 'coverage/e2e'],
        output: './coverage/merged',
        reporters: ['html'],
        strip: false,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Failed to load coverage')
    })

    it('should return error when reporter throws', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      mockGenerateReports.mockRejectedValueOnce(new Error('Report generation failed'))

      const result = await executeMerge({
        inputs: ['coverage/unit', 'coverage/e2e'],
        output: './coverage/merged',
        reporters: ['html'],
        strip: false,
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Report generation failed')
    })
  })

  // Skip subprocess tests on Windows - tsx subprocess spawning is unreliable on Windows CI
  const isWindows = process.platform === 'win32'
  const describeUnixOnly = isWindows ? describe.skip : describe

  describeUnixOnly('CLI integration (subprocess)', () => {
    it('should run --help and produce output', async () => {
      const { execSync } = await import('child_process')
      const { fileURLToPath } = await import('url')
      const { dirname, join } = await import('path')

      const currentFile = fileURLToPath(import.meta.url)
      const cliPath = join(dirname(currentFile), '..', 'cli', 'index.ts')

      // Run CLI via tsx to handle TypeScript
      const output = execSync(`npx tsx "${cliPath}" --help`, {
        encoding: 'utf-8',
        cwd: dirname(dirname(currentFile))
      })

      expect(output).toContain('nextcov')
      expect(output).toContain('Usage:')
      expect(output).toContain('merge')
    }, 30000)

    it('should run merge --help and produce output', async () => {
      const { execSync } = await import('child_process')
      const { fileURLToPath } = await import('url')
      const { dirname, join } = await import('path')

      const currentFile = fileURLToPath(import.meta.url)
      const cliPath = join(dirname(currentFile), '..', 'cli', 'index.ts')

      const output = execSync(`npx tsx "${cliPath}" merge --help`, {
        encoding: 'utf-8',
        cwd: dirname(dirname(currentFile))
      })

      expect(output).toContain('npx nextcov merge')
      expect(output).toContain('--output')
      expect(output).toContain('--reporters')
    }, 30000)

    it('should merge actual coverage files and produce output', async () => {
      const { execSync } = await import('child_process')
      const { fileURLToPath } = await import('url')
      const { dirname, join, resolve } = await import('path')
      const { readFileSync, rmSync } = await import('fs')

      const currentFile = fileURLToPath(import.meta.url)
      const projectRoot = resolve(dirname(currentFile), '..', '..')
      const cliPath = join(projectRoot, 'src', 'cli', 'index.ts')

      // Use coverage files from test-fixtures (separate from vitest's coverage output)
      const unitDir = join(projectRoot, 'test-fixtures', 'sample-coverage', 'unit')
      const integrationDir = join(projectRoot, 'test-fixtures', 'sample-coverage', 'integration')
      const outputDir = join(projectRoot, 'test-fixtures', 'sample-coverage', 'test-merged')

      // Clean up previous test output to ensure fresh merge
      try {
        rmSync(outputDir, { recursive: true, force: true })
      } catch {
        // Directory may not exist, ignore
      }

      const output = execSync(
        `npx tsx "${cliPath}" merge "${unitDir}" "${integrationDir}" -o "${outputDir}" --reporters json`,
        {
          encoding: 'utf-8',
          cwd: projectRoot
        }
      )

      expect(output).toContain('nextcov merge')
      expect(output).toContain('Inputs:')
      expect(output).toContain('Loading:')
      expect(output).toContain('Merged coverage report generated')

      // Verify merged output contains expected files
      const mergedFile = join(outputDir, 'coverage-final.json')
      const merged = JSON.parse(readFileSync(mergedFile, 'utf-8'))

      // Check that all 8 files from todo-app are present
      expect(merged['src/api/api.ts']).toBeDefined()
      expect(merged['src/app/layout.tsx']).toBeDefined()
      expect(merged['src/app/page.tsx']).toBeDefined()
      expect(merged['src/app/components/AddTask.tsx']).toBeDefined()
      expect(merged['src/app/components/Icons.tsx']).toBeDefined()
      expect(merged['src/app/components/Modal.tsx']).toBeDefined()
      expect(merged['src/app/components/Task.tsx']).toBeDefined()
      expect(merged['src/app/components/TodoList.tsx']).toBeDefined()

      // Count totals from merged coverage
      let totalStatements = 0
      let coveredStatements = 0
      let totalBranches = 0
      let coveredBranches = 0
      let totalFunctions = 0
      let coveredFunctions = 0
      let totalLines = 0
      let coveredLines = 0

      for (const [, fileCoverage] of Object.entries(merged)) {
        const fc = fileCoverage as {
          s: Record<string, number>
          b: Record<string, number[]>
          f: Record<string, number>
          statementMap: Record<string, { start: { line: number } }>
        }
        // Count statements
        for (const [, count] of Object.entries(fc.s)) {
          totalStatements++
          if (count > 0) coveredStatements++
        }
        // Count branches
        for (const [, counts] of Object.entries(fc.b)) {
          for (const count of counts) {
            totalBranches++
            if (count > 0) coveredBranches++
          }
        }
        // Count functions
        for (const [, count] of Object.entries(fc.f)) {
          totalFunctions++
          if (count > 0) coveredFunctions++
        }
        // Count lines (unique lines from statementMap)
        const lineHits: Record<number, number> = {}
        for (const [stmtId, stmtInfo] of Object.entries(fc.statementMap)) {
          const line = stmtInfo.start.line
          const hits = fc.s[stmtId] || 0
          // Track max hits per line (multiple statements can be on same line)
          if (lineHits[line] === undefined || hits > lineHits[line]) {
            lineHits[line] = hits
          }
        }
        for (const [, hits] of Object.entries(lineHits)) {
          totalLines++
          if (hits > 0) coveredLines++
        }
      }

      // Verify 100% coverage (covered equals total)
      // Note: Exact counts can vary slightly between platforms/Node versions
      // due to differences in source map processing
      expect(coveredStatements).toBe(totalStatements)
      expect(coveredBranches).toBe(totalBranches)
      expect(coveredFunctions).toBe(totalFunctions)
      expect(coveredLines).toBe(totalLines)
      // Sanity check: ensure we have reasonable coverage data
      expect(totalStatements).toBeGreaterThan(80)
      expect(totalBranches).toBeGreaterThan(10)
      expect(totalFunctions).toBeGreaterThan(30)
      expect(totalLines).toBeGreaterThan(70)
    }, 30000)
  })
})

describe('stripCoverageDirectives - c8/istanbul ignore hints', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `strip-directives-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(async () => {
    try {
      await fsPromises.rm(testDir, { recursive: true, force: true })
    } catch { /* ignore */ }
  })

  type CoverageData = {
    statementMap: Record<string, { start: { line: number } }>
    s: Record<string, number>
    fnMap?: Record<string, { loc?: { start?: { line?: number } } }>
    f?: Record<string, number>
    branchMap?: Record<string, { loc?: { start?: { line?: number } } }>
    b?: Record<string, number[]>
  }

  function makeInput(filePath: string, data: CoverageData): Record<string, CoverageData> {
    return { [filePath]: data }
  }

  it('strips statement on line after // c8 ignore next (bare form, regression for fixed regex)', () => {
    const filePath = join(testDir, 'a.ts')
    writeFileSync(filePath, [
      'const a = 1',       // line 1
      '// c8 ignore next', // line 2
      'const b = 2',       // line 3 — ignored
      'const c = 3',       // line 4
    ].join('\n'))

    const input = makeInput(filePath, {
      statementMap: {
        '0': { start: { line: 1 } },
        '1': { start: { line: 3 } }, // should be removed
        '2': { start: { line: 4 } },
      },
      s: { '0': 1, '1': 5, '2': 3 },
    })

    const result = stripCoverageDirectives(input as never)

    expect(input[filePath].statementMap['1']).toBeUndefined()
    expect(input[filePath].s['1']).toBeUndefined()
    expect(input[filePath].statementMap['0']).toBeDefined() // line 1 — kept
    expect(input[filePath].statementMap['2']).toBeDefined() // line 4 — kept
    expect(result.ignoredRemoved).toBe(1)
  })

  it('strips statement after // istanbul ignore next', () => {
    const filePath = join(testDir, 'b.ts')
    writeFileSync(filePath, [
      'const a = 1',
      '// istanbul ignore next',
      'const b = 2',
    ].join('\n'))

    const input = makeInput(filePath, {
      statementMap: {
        '0': { start: { line: 1 } },
        '1': { start: { line: 3 } },
      },
      s: { '0': 1, '1': 1 },
    })

    const result = stripCoverageDirectives(input as never)

    expect(input[filePath].statementMap['1']).toBeUndefined()
    expect(result.ignoredRemoved).toBe(1)
  })

  it('strips statement after /* c8 ignore next */ (block comment form)', () => {
    const filePath = join(testDir, 'c.ts')
    writeFileSync(filePath, [
      'const a = 1',
      '/* c8 ignore next */',
      'const b = 2',
    ].join('\n'))

    const input = makeInput(filePath, {
      statementMap: {
        '0': { start: { line: 1 } },
        '1': { start: { line: 3 } },
      },
      s: { '0': 1, '1': 1 },
    })

    stripCoverageDirectives(input as never)

    expect(input[filePath].statementMap['1']).toBeUndefined()
    expect(input[filePath].statementMap['0']).toBeDefined()
  })

  it('strips statements inside /* c8 ignore start */ ... /* c8 ignore stop */ block', () => {
    const filePath = join(testDir, 'd.ts')
    writeFileSync(filePath, [
      'const a = 1',          // line 1
      '/* c8 ignore start */', // line 2 — start, NOT ignored
      'const b = 2',          // line 3 — ignored
      'const c = 3',          // line 4 — ignored
      '/* c8 ignore stop */', // line 5 — stop (included in ignore range)
      'const d = 4',          // line 6 — NOT ignored
    ].join('\n'))

    const input = makeInput(filePath, {
      statementMap: {
        '0': { start: { line: 1 } },
        '1': { start: { line: 3 } },
        '2': { start: { line: 4 } },
        '3': { start: { line: 6 } },
      },
      s: { '0': 1, '1': 1, '2': 1, '3': 1 },
    })

    const result = stripCoverageDirectives(input as never)

    expect(input[filePath].statementMap['0']).toBeDefined()    // line 1 — kept
    expect(input[filePath].statementMap['1']).toBeUndefined()  // line 3 — removed
    expect(input[filePath].statementMap['2']).toBeUndefined()  // line 4 — removed
    expect(input[filePath].statementMap['3']).toBeDefined()    // line 6 — kept
    expect(result.ignoredRemoved).toBe(2)
  })

  it('does NOT strip statement on the /* c8 ignore start */ line itself', () => {
    const filePath = join(testDir, 'e.ts')
    writeFileSync(filePath, [
      '/* c8 ignore start */', // line 1 — start comment, itself NOT ignored
      'const b = 2',           // line 2 — ignored
      '/* c8 ignore stop */',  // line 3 — stop
    ].join('\n'))

    const input = makeInput(filePath, {
      statementMap: {
        '0': { start: { line: 1 } }, // on the start comment line
        '1': { start: { line: 2 } }, // inside block
      },
      s: { '0': 1, '1': 1 },
    })

    stripCoverageDirectives(input as never)

    expect(input[filePath].statementMap['0']).toBeDefined()    // start line — kept
    expect(input[filePath].statementMap['1']).toBeUndefined()  // inside block — removed
  })

  it('strips functions on ignored lines and increments ignoredRemoved', () => {
    const filePath = join(testDir, 'f.ts')
    writeFileSync(filePath, [
      'const a = 1',
      '// c8 ignore next',
      'function ignored() { return 1 }',
      'function kept() { return 2 }',
    ].join('\n'))

    const input = makeInput(filePath, {
      statementMap: {
        '0': { start: { line: 1 } },
      },
      s: { '0': 1 },
      fnMap: {
        '0': { loc: { start: { line: 3 } } }, // on ignored line
        '1': { loc: { start: { line: 4 } } }, // not ignored
      },
      f: { '0': 0, '1': 5 },
    })

    const result = stripCoverageDirectives(input as never)

    expect(input[filePath].fnMap!['0']).toBeUndefined()  // removed
    expect(input[filePath].f!['0']).toBeUndefined()
    expect(input[filePath].fnMap!['1']).toBeDefined()    // kept
    expect(input[filePath].f!['1']).toBeDefined()
    expect(result.ignoredRemoved).toBeGreaterThanOrEqual(1)
  })

  it('skips gracefully when source file does not exist on disk', () => {
    const missingFile = join(testDir, 'does-not-exist.ts')

    const input = makeInput(missingFile, {
      statementMap: {
        '0': { start: { line: 2 } },
      },
      s: { '0': 1 },
    })

    // Should not throw; unreadable files are skipped
    expect(() => stripCoverageDirectives(input as never)).not.toThrow()
    // Data untouched since file wasn't read
    expect(input[missingFile].statementMap['0']).toBeDefined()
  })

  it('handles /* istanbul ignore start/stop */ block (istanbul variant)', () => {
    const filePath = join(testDir, 'g.ts')
    writeFileSync(filePath, [
      '/* istanbul ignore start */',
      'const a = 1',
      '/* istanbul ignore stop */',
      'const b = 2',
    ].join('\n'))

    const input = makeInput(filePath, {
      statementMap: {
        '0': { start: { line: 2 } }, // inside block
        '1': { start: { line: 4 } }, // after stop
      },
      s: { '0': 1, '1': 1 },
    })

    stripCoverageDirectives(input as never)

    expect(input[filePath].statementMap['0']).toBeUndefined()  // removed
    expect(input[filePath].statementMap['1']).toBeDefined()    // kept
  })

  it('does not affect import or directive removal counts for ignored lines', () => {
    const filePath = join(testDir, 'h.ts')
    writeFileSync(filePath, [
      'import foo from "foo"',   // line 1 — import
      "'use client'",             // line 2 — directive
      '// c8 ignore next',
      'const a = 1',             // line 4 — ignored
    ].join('\n'))

    const input = makeInput(filePath, {
      statementMap: {
        '0': { start: { line: 1 } },
        '1': { start: { line: 2 } },
        '2': { start: { line: 4 } },
      },
      s: { '0': 1, '1': 1, '2': 1 },
    })

    const result = stripCoverageDirectives(input as never)

    expect(result.importsRemoved).toBe(1)
    expect(result.directivesRemoved).toBe(1)
    expect(result.ignoredRemoved).toBe(1)
    expect(Object.keys(input[filePath].statementMap)).toHaveLength(0)
  })
})
