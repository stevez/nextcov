/**
 * Check Command Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { check } from '../check.js'
import * as scanner from '@/linter/scanner.js'
import * as configScanner from '@/linter/config-scanner.js'
import * as reporter from '@/linter/reporter.js'
import type { ScanResult } from '@/linter/scanner.js'
import type { JsxIssue } from '@/linter/detectors/jsx-patterns.js'

describe('check command', () => {
  let scanFilesSpy: any
  let scanConfigSpy: any
  let printReportSpy: any
  let printConfigReportSpy: any
  let getCombinedExitCodeSpy: any
  let consoleErrorSpy: any

  const defaultConfigResult = {
    issues: [],
    errors: 0,
    warnings: 0,
    infos: 0,
  }

  beforeEach(() => {
    scanFilesSpy = vi.spyOn(scanner, 'scanFiles')
    scanConfigSpy = vi.spyOn(configScanner, 'scanConfig').mockReturnValue(defaultConfigResult)
    printReportSpy = vi.spyOn(reporter, 'printReport').mockImplementation(() => {})
    printConfigReportSpy = vi.spyOn(reporter, 'printConfigReport').mockImplementation(() => {})
    getCombinedExitCodeSpy = vi.spyOn(reporter, 'getCombinedExitCode')
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
    getCombinedExitCodeSpy.mockReturnValue(0)

    const exitCode = await check(['src'], {})

    expect(scanConfigSpy).toHaveBeenCalledWith({ cwd: process.cwd() })
    expect(scanFilesSpy).toHaveBeenCalledWith({
      paths: ['src'],
      cwd: process.cwd(),
      ignore: [],
    })
    expect(printConfigReportSpy).toHaveBeenCalledWith(defaultConfigResult, { verbose: false, json: false })
    expect(printReportSpy).toHaveBeenCalledWith(result, { verbose: false, json: false })
    expect(getCombinedExitCodeSpy).toHaveBeenCalledWith(result, defaultConfigResult, false)
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
    getCombinedExitCodeSpy.mockReturnValue(1)

    const exitCode = await check(['src'], {})

    expect(exitCode).toBe(1)
  })

  it('should run config-only check when no paths provided', async () => {
    getCombinedExitCodeSpy.mockReturnValue(0)

    await check([], {})

    // Config scan should be called
    expect(scanConfigSpy).toHaveBeenCalledWith({ cwd: process.cwd() })
    expect(printConfigReportSpy).toHaveBeenCalled()
    // Source scan should NOT be called when no paths
    expect(scanFilesSpy).not.toHaveBeenCalled()
    expect(printReportSpy).not.toHaveBeenCalled()
  })

  it('should skip config scan when skipConfig is true', async () => {
    const result: ScanResult = {
      issues: [],
      filesScanned: 5,
      filesWithIssues: 0,
    }

    scanFilesSpy.mockResolvedValue(result)
    getCombinedExitCodeSpy.mockReturnValue(0)

    await check(['src'], { skipConfig: true })

    // Config scan should NOT be called
    expect(scanConfigSpy).not.toHaveBeenCalled()
    expect(printConfigReportSpy).not.toHaveBeenCalled()
    // Source scan should be called
    expect(scanFilesSpy).toHaveBeenCalled()
    expect(printReportSpy).toHaveBeenCalled()
  })

  it('should show message when no paths and skipConfig', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const exitCode = await check([], { skipConfig: true })

    expect(consoleLogSpy).toHaveBeenCalledWith('Nothing to check. Provide paths for source scanning or remove --skip-config.')
    expect(exitCode).toBe(0)
    consoleLogSpy.mockRestore()
  })

  it('should pass verbose option to printReport', async () => {
    const result: ScanResult = {
      issues: [],
      filesScanned: 5,
      filesWithIssues: 0,
    }

    scanFilesSpy.mockResolvedValue(result)
    getCombinedExitCodeSpy.mockReturnValue(0)

    await check(['src'], { verbose: true })

    expect(printReportSpy).toHaveBeenCalledWith(result, { verbose: true, json: false })
    expect(printConfigReportSpy).toHaveBeenCalledWith(defaultConfigResult, { verbose: true, json: false })
  })

  it('should pass json option to printReport', async () => {
    const result: ScanResult = {
      issues: [],
      filesScanned: 5,
      filesWithIssues: 0,
    }

    scanFilesSpy.mockResolvedValue(result)
    getCombinedExitCodeSpy.mockReturnValue(0)

    await check(['src'], { json: true })

    expect(printReportSpy).toHaveBeenCalledWith(result, { verbose: false, json: true })
    expect(printConfigReportSpy).toHaveBeenCalledWith(defaultConfigResult, { verbose: false, json: true })
  })

  it('should pass ignorePatterns option to getCombinedExitCode', async () => {
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
    getCombinedExitCodeSpy.mockReturnValue(0)

    await check(['src'], { ignorePatterns: true })

    expect(getCombinedExitCodeSpy).toHaveBeenCalledWith(result, defaultConfigResult, true)
  })

  it('should pass ignore patterns to scanFiles', async () => {
    const result: ScanResult = {
      issues: [],
      filesScanned: 0,
      filesWithIssues: 0,
    }

    scanFilesSpy.mockResolvedValue(result)
    getCombinedExitCodeSpy.mockReturnValue(0)

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
    getCombinedExitCodeSpy.mockReturnValue(0)

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
    getCombinedExitCodeSpy.mockReturnValue(0)

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
    expect(getCombinedExitCodeSpy).toHaveBeenCalledWith(result, defaultConfigResult, true)
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
    expect(getCombinedExitCodeSpy).not.toHaveBeenCalled()
  })

  it('should use default values for options', async () => {
    const result: ScanResult = {
      issues: [],
      filesScanned: 5,
      filesWithIssues: 0,
    }

    scanFilesSpy.mockResolvedValue(result)
    getCombinedExitCodeSpy.mockReturnValue(0)

    await check(['src'], {})

    expect(printReportSpy).toHaveBeenCalledWith(result, { verbose: false, json: false })
    expect(getCombinedExitCodeSpy).toHaveBeenCalledWith(result, defaultConfigResult, false)
    expect(scanFilesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ignore: [],
      })
    )
  })
})
