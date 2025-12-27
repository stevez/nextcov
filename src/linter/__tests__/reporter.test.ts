/**
 * Reporter Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { printReport, getExitCode } from '../reporter.js'
import type { ScanResult } from '../scanner.js'
import type { JsxIssue } from '../detectors/jsx-patterns.js'

describe('printReport', () => {
  let consoleLogSpy: any

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
  })

  describe('console output', () => {
    it('should print success message when no issues found', () => {
      const result: ScanResult = {
        issues: [],
        filesScanned: 5,
        filesWithIssues: 0,
      }

      printReport(result)

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('No V8 coverage blind spots found!')
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Scanned 5 files'))
    })

    it('should print issues when found', () => {
      const issues: JsxIssue[] = [
        {
          type: 'jsx-ternary',
          file: 'src/Component.tsx',
          line: 10,
          column: 5,
          code: '{isAdmin ? <Admin /> : <User />}',
        },
      ]

      const result: ScanResult = {
        issues,
        filesScanned: 5,
        filesWithIssues: 1,
      }

      printReport(result)

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('V8 Coverage Blind Spots Found')
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('src/Component.tsx:10:5'))
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('JSX ternary operator (V8 cannot track branch coverage)')
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Found 1 issue in 1 file'))
    })

    it('should print multiple issues', () => {
      const issues: JsxIssue[] = [
        {
          type: 'jsx-ternary',
          file: 'src/ComponentA.tsx',
          line: 10,
          column: 5,
          code: '{isAdmin ? <Admin /> : <User />}',
        },
        {
          type: 'jsx-logical-and',
          file: 'src/ComponentB.tsx',
          line: 15,
          column: 7,
          code: '{user && <Profile />}',
        },
      ]

      const result: ScanResult = {
        issues,
        filesScanned: 10,
        filesWithIssues: 2,
      }

      printReport(result)

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('src/ComponentA.tsx:10:5'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('src/ComponentB.tsx:15:7'))
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 2 issues in 2 files')
      )
    })

    it('should group issues by file', () => {
      const issues: JsxIssue[] = [
        {
          type: 'jsx-ternary',
          file: 'src/Component.tsx',
          line: 10,
          column: 5,
          code: '{isAdmin ? <Admin /> : <User />}',
        },
        {
          type: 'jsx-logical-and',
          file: 'src/Component.tsx',
          line: 20,
          column: 7,
          code: '{user && <Profile />}',
        },
      ]

      const result: ScanResult = {
        issues,
        filesScanned: 5,
        filesWithIssues: 1,
      }

      printReport(result)

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('src/Component.tsx:10:5'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('src/Component.tsx:20:7'))
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 2 issues in 1 file')
      )
    })

    it('should not show code snippets by default', () => {
      const issues: JsxIssue[] = [
        {
          type: 'jsx-ternary',
          file: 'src/Component.tsx',
          line: 10,
          column: 5,
          code: '{isAdmin ? <Admin /> : <User />}',
        },
      ]

      const result: ScanResult = {
        issues,
        filesScanned: 5,
        filesWithIssues: 1,
      }

      printReport(result, { verbose: false })

      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('{isAdmin ? <Admin /> : <User />}')
      )
    })

    it('should show code snippets in verbose mode', () => {
      const issues: JsxIssue[] = [
        {
          type: 'jsx-ternary',
          file: 'src/Component.tsx',
          line: 10,
          column: 5,
          code: '{isAdmin ? <Admin /> : <User />}',
        },
      ]

      const result: ScanResult = {
        issues,
        filesScanned: 5,
        filesWithIssues: 1,
      }

      printReport(result, { verbose: true })

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('{isAdmin ? <Admin /> : <User />}')
      )
    })

    it('should show help text with issues', () => {
      const issues: JsxIssue[] = [
        {
          type: 'jsx-ternary',
          file: 'src/Component.tsx',
          line: 10,
          column: 5,
          code: '{isAdmin ? <Admin /> : <User />}',
        },
      ]

      const result: ScanResult = {
        issues,
        filesScanned: 5,
        filesWithIssues: 1,
      }

      printReport(result)

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('These patterns cannot be tracked by V8 coverage')
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Consider extracting to separate components with if/else')
      )
    })
  })

  describe('JSON output', () => {
    it('should output JSON format when json option is true', () => {
      const issues: JsxIssue[] = [
        {
          type: 'jsx-ternary',
          file: 'src/Component.tsx',
          line: 10,
          column: 5,
          code: '{isAdmin ? <Admin /> : <User />}',
        },
      ]

      const result: ScanResult = {
        issues,
        filesScanned: 5,
        filesWithIssues: 1,
      }

      printReport(result, { json: true })

      const jsonCall = consoleLogSpy.mock.calls.find((call: any[]) => {
        try {
          JSON.parse(call[0])
          return true
        } catch {
          return false
        }
      })

      expect(jsonCall).toBeDefined()
      const output = JSON.parse(jsonCall[0])
      expect(output).toEqual(result)
    })

    it('should output empty issues array in JSON when no issues', () => {
      const result: ScanResult = {
        issues: [],
        filesScanned: 5,
        filesWithIssues: 0,
      }

      printReport(result, { json: true })

      const jsonCall = consoleLogSpy.mock.calls.find((call: any[]) => {
        try {
          JSON.parse(call[0])
          return true
        } catch {
          return false
        }
      })

      expect(jsonCall).toBeDefined()
      const output = JSON.parse(jsonCall[0])
      expect(output.issues).toEqual([])
      expect(output.filesScanned).toBe(5)
    })
  })
})

describe('getExitCode', () => {
  it('should return 0 when no issues found', () => {
    const result: ScanResult = {
      issues: [],
      filesScanned: 5,
      filesWithIssues: 0,
    }

    expect(getExitCode(result, false)).toBe(0)
  })

  it('should return 1 when issues found', () => {
    const result: ScanResult = {
      issues: [
        {
          type: 'jsx-ternary',
          file: 'src/Component.tsx',
          line: 10,
          column: 5,
          code: '{isAdmin ? <Admin /> : <User />}',
        },
      ],
      filesScanned: 5,
      filesWithIssues: 1,
    }

    expect(getExitCode(result, false)).toBe(1)
  })

  it('should return 0 when issues found but ignorePatterns is true', () => {
    const result: ScanResult = {
      issues: [
        {
          type: 'jsx-ternary',
          file: 'src/Component.tsx',
          line: 10,
          column: 5,
          code: '{isAdmin ? <Admin /> : <User />}',
        },
      ],
      filesScanned: 5,
      filesWithIssues: 1,
    }

    expect(getExitCode(result, true)).toBe(0)
  })

  it('should return 0 when no issues and ignorePatterns is true', () => {
    const result: ScanResult = {
      issues: [],
      filesScanned: 5,
      filesWithIssues: 0,
    }

    expect(getExitCode(result, true)).toBe(0)
  })
})
