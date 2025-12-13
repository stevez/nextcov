// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync } from 'fs'
import {
  parseMergeArgs,
  HELP,
  MERGE_HELP,
  validateInputDirectories,
  executeMerge,
  type MergeOptions,
  type ParseResult,
  type MergeResult,
} from '../cli.js'

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
}))

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
vi.mock('../reporter.js', () => ({
  IstanbulReporter: class MockIstanbulReporter {
    constructor() {}
    generateReports = mockGenerateReports
  },
}))

vi.mock('../merger.js', () => ({
  createMerger: () => ({
    loadCoverageJson: mockLoadCoverageJson,
    merge: mockMerge,
  }),
}))

describe('CLI', () => {
  describe('HELP constant', () => {
    it('should contain usage information', () => {
      expect(HELP).toContain('nextcov')
      expect(HELP).toContain('Usage:')
      expect(HELP).toContain('Commands:')
      expect(HELP).toContain('merge')
    })

    it('should contain examples', () => {
      expect(HELP).toContain('Examples:')
      expect(HELP).toContain('npx nextcov merge')
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

    it('should return error when a coverage file does not exist', () => {
      vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(false)

      const result = validateInputDirectories(['coverage/unit', 'coverage/missing'])

      expect(result.error).toContain('Coverage file not found')
      expect(result.coverageFiles).toEqual([])
    })

    it('should return error on first missing file', () => {
      vi.mocked(existsSync).mockReturnValue(false)

      const result = validateInputDirectories(['coverage/missing'])

      expect(result.error).toContain('Coverage file not found')
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

    it('should return error when validation fails', async () => {
      vi.mocked(existsSync).mockReturnValue(false)

      const result = await executeMerge({
        inputs: ['coverage/missing'],
        output: './coverage/merged',
        reporters: ['html'],
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Coverage file not found')
    })

    it('should successfully merge coverage files', async () => {
      vi.mocked(existsSync).mockReturnValue(true)

      const result = await executeMerge({
        inputs: ['coverage/unit', 'coverage/e2e'],
        output: './coverage/merged',
        reporters: ['html', 'lcov'],
      })

      expect(result.success).toBe(true)
      expect(result.outputDir).toBeDefined()
    })

    it('should successfully merge single coverage file', async () => {
      vi.mocked(existsSync).mockReturnValue(true)

      const result = await executeMerge({
        inputs: ['coverage/unit'],
        output: './coverage/merged',
        reporters: ['json'],
      })

      expect(result.success).toBe(true)
    })

    it('should return error when loadCoverageJson returns null', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      mockLoadCoverageJson.mockResolvedValueOnce(null)

      const result = await executeMerge({
        inputs: ['coverage/unit'],
        output: './coverage/merged',
        reporters: ['html'],
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Failed to load coverage')
    })

    it('should return error when reporter throws', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      mockGenerateReports.mockRejectedValueOnce(new Error('Report generation failed'))

      const result = await executeMerge({
        inputs: ['coverage/unit'],
        output: './coverage/merged',
        reporters: ['html'],
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Report generation failed')
    })
  })
})
