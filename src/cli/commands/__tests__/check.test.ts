/**
 * Check Command Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { check } from '../check.js'
import * as scanner from '@/linter/scanner.js'
import * as reporter from '@/linter/reporter.js'
import type { ScanResult } from '@/linter/scanner.js'
import type { JsxIssue } from '@/linter/detectors/jsx-patterns.js'

describe('check command', () => {
  let scanFilesSpy: any
  let printReportSpy: any
  let getExitCodeSpy: any
  let consoleErrorSpy: any

  beforeEach(() => {
    scanFilesSpy = vi.spyOn(scanner, 'scanFiles')
    printReportSpy = vi.spyOn(reporter, 'printReport').mockImplementation(() => {})
    getExitCodeSpy = vi.spyOn(reporter, 'getExitCode')
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should scan files and return exit code 0 when no issues found', async () => {
    const result: ScanResult = {
      issues: [],
      filesScanned: 5,
      filesWithIssues: 0,
    }

    scanFilesSpy.mockResolvedValue(result)
    getExitCodeSpy.mockReturnValue(0)

    const exitCode = await check(['src'], {})

    expect(scanFilesSpy).toHaveBeenCalledWith({
      paths: ['src'],
      cwd: process.cwd(),
      ignore: [],
    })
    expect(printReportSpy).toHaveBeenCalledWith(result, { verbose: false, json: false })
    expect(getExitCodeSpy).toHaveBeenCalledWith(result, false)
    expect(exitCode).toBe(0)
  })

  it('should scan files and return exit code 1 when issues found', async () => {
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

    scanFilesSpy.mockResolvedValue(result)
    getExitCodeSpy.mockReturnValue(1)

    const exitCode = await check(['src'], {})

    expect(exitCode).toBe(1)
  })

  it('should use current directory when no paths provided', async () => {
    const result: ScanResult = {
      issues: [],
      filesScanned: 0,
      filesWithIssues: 0,
    }

    scanFilesSpy.mockResolvedValue(result)
    getExitCodeSpy.mockReturnValue(0)

    await check([], {})

    expect(scanFilesSpy).toHaveBeenCalledWith({
      paths: ['.'],
      cwd: process.cwd(),
      ignore: [],
    })
  })

  it('should pass verbose option to printReport', async () => {
    const result: ScanResult = {
      issues: [],
      filesScanned: 5,
      filesWithIssues: 0,
    }

    scanFilesSpy.mockResolvedValue(result)
    getExitCodeSpy.mockReturnValue(0)

    await check(['src'], { verbose: true })

    expect(printReportSpy).toHaveBeenCalledWith(result, { verbose: true, json: false })
  })

  it('should pass json option to printReport', async () => {
    const result: ScanResult = {
      issues: [],
      filesScanned: 5,
      filesWithIssues: 0,
    }

    scanFilesSpy.mockResolvedValue(result)
    getExitCodeSpy.mockReturnValue(0)

    await check(['src'], { json: true })

    expect(printReportSpy).toHaveBeenCalledWith(result, { verbose: false, json: true })
  })

  it('should pass ignorePatterns option to getExitCode', async () => {
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

    scanFilesSpy.mockResolvedValue(result)
    getExitCodeSpy.mockReturnValue(0)

    await check(['src'], { ignorePatterns: true })

    expect(getExitCodeSpy).toHaveBeenCalledWith(result, true)
  })

  it('should pass ignore patterns to scanFiles', async () => {
    const result: ScanResult = {
      issues: [],
      filesScanned: 0,
      filesWithIssues: 0,
    }

    scanFilesSpy.mockResolvedValue(result)
    getExitCodeSpy.mockReturnValue(0)

    await check(['src'], { ignore: ['**/*.test.ts', '**/node_modules/**'] })

    expect(scanFilesSpy).toHaveBeenCalledWith({
      paths: ['src'],
      cwd: process.cwd(),
      ignore: ['**/*.test.ts', '**/node_modules/**'],
    })
  })

  it('should scan multiple paths', async () => {
    const result: ScanResult = {
      issues: [],
      filesScanned: 10,
      filesWithIssues: 0,
    }

    scanFilesSpy.mockResolvedValue(result)
    getExitCodeSpy.mockReturnValue(0)

    await check(['src', 'lib', 'components'], {})

    expect(scanFilesSpy).toHaveBeenCalledWith({
      paths: ['src', 'lib', 'components'],
      cwd: process.cwd(),
      ignore: [],
    })
  })

  it('should handle all options together', async () => {
    const result: ScanResult = {
      issues: [],
      filesScanned: 5,
      filesWithIssues: 0,
    }

    scanFilesSpy.mockResolvedValue(result)
    getExitCodeSpy.mockReturnValue(0)

    await check(['src'], {
      verbose: true,
      json: true,
      ignorePatterns: true,
      ignore: ['**/*.test.ts'],
    })

    expect(scanFilesSpy).toHaveBeenCalledWith({
      paths: ['src'],
      cwd: process.cwd(),
      ignore: ['**/*.test.ts'],
    })
    expect(printReportSpy).toHaveBeenCalledWith(result, { verbose: true, json: true })
    expect(getExitCodeSpy).toHaveBeenCalledWith(result, true)
  })

  it('should return exit code 2 when scanFiles throws error', async () => {
    scanFilesSpy.mockRejectedValue(new Error('File read error'))

    const exitCode = await check(['src'], {})

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error running check:',
      expect.any(Error)
    )
    expect(exitCode).toBe(2)
  })

  it('should not call printReport when error occurs', async () => {
    scanFilesSpy.mockRejectedValue(new Error('File read error'))

    await check(['src'], {})

    expect(printReportSpy).not.toHaveBeenCalled()
    expect(getExitCodeSpy).not.toHaveBeenCalled()
  })

  it('should use default values for options', async () => {
    const result: ScanResult = {
      issues: [],
      filesScanned: 5,
      filesWithIssues: 0,
    }

    scanFilesSpy.mockResolvedValue(result)
    getExitCodeSpy.mockReturnValue(0)

    await check(['src'], {})

    expect(printReportSpy).toHaveBeenCalledWith(result, { verbose: false, json: false })
    expect(getExitCodeSpy).toHaveBeenCalledWith(result, false)
    expect(scanFilesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ignore: [],
      })
    )
  })
})
