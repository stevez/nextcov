import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync } from 'fs'
import {
  parseMergeArgs,
  MERGE_HELP,
  validateInputDirectories,
  executeMerge,
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
