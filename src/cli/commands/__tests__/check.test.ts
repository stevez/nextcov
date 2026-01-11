/**
 * Check Command Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { check } from '../check.js'
import * as configScanner from '@/linter/config-scanner.js'
import * as reporter from '@/linter/reporter.js'

describe('check command', () => {
  let scanConfigSpy: any
  let printConfigReportSpy: any
  let getExitCodeSpy: any
  let consoleErrorSpy: any

  const defaultConfigResult = {
    issues: [],
    errors: 0,
    warnings: 0,
    infos: 0,
  }

  beforeEach(() => {
    scanConfigSpy = vi.spyOn(configScanner, 'scanConfig').mockReturnValue(defaultConfigResult)
    printConfigReportSpy = vi.spyOn(reporter, 'printConfigReport').mockImplementation(() => {})
    getExitCodeSpy = vi.spyOn(reporter, 'getExitCode')
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should run config check and return exit code 0 when no issues found', async () => {
    getExitCodeSpy.mockReturnValue(0)

    const exitCode = await check({})

    expect(scanConfigSpy).toHaveBeenCalledWith({ cwd: process.cwd() })
    expect(printConfigReportSpy).toHaveBeenCalledWith(defaultConfigResult, { verbose: false, json: false })
    expect(getExitCodeSpy).toHaveBeenCalledWith(defaultConfigResult)
    expect(exitCode).toBe(0)
  })

  it('should return exit code 1 when config errors found', async () => {
    const configResultWithErrors = {
      issues: [{ type: 'babel-detected', severity: 'error', message: 'Babel detected' }],
      errors: 1,
      warnings: 0,
      infos: 0,
    }
    scanConfigSpy.mockReturnValue(configResultWithErrors)
    getExitCodeSpy.mockReturnValue(1)

    const exitCode = await check({})

    expect(exitCode).toBe(1)
  })

  it('should pass verbose option to printConfigReport', async () => {
    getExitCodeSpy.mockReturnValue(0)

    await check({ verbose: true })

    expect(printConfigReportSpy).toHaveBeenCalledWith(defaultConfigResult, { verbose: true, json: false })
  })

  it('should pass json option to printConfigReport', async () => {
    getExitCodeSpy.mockReturnValue(0)

    await check({ json: true })

    expect(printConfigReportSpy).toHaveBeenCalledWith(defaultConfigResult, { verbose: false, json: true })
  })

  it('should handle all options together', async () => {
    getExitCodeSpy.mockReturnValue(0)

    await check({ verbose: true, json: true })

    expect(printConfigReportSpy).toHaveBeenCalledWith(defaultConfigResult, { verbose: true, json: true })
  })

  it('should return exit code 2 when scanConfig throws error', async () => {
    scanConfigSpy.mockImplementation(() => {
      throw new Error('Config read error')
    })

    const exitCode = await check({})

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error running check:',
      expect.any(Error)
    )
    expect(exitCode).toBe(2)
  })

  it('should not call printConfigReport when error occurs', async () => {
    scanConfigSpy.mockImplementation(() => {
      throw new Error('Config read error')
    })

    await check({})

    expect(printConfigReportSpy).not.toHaveBeenCalled()
    expect(getExitCodeSpy).not.toHaveBeenCalled()
  })

  it('should use default values for options', async () => {
    getExitCodeSpy.mockReturnValue(0)

    await check({})

    expect(printConfigReportSpy).toHaveBeenCalledWith(defaultConfigResult, { verbose: false, json: false })
  })
})
