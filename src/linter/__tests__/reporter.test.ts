/**
 * Reporter Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { printConfigReport, getExitCode } from '../reporter.js'
import type { ConfigScanResult } from '../config-scanner.js'

describe('printConfigReport', () => {
  let consoleLogSpy: any

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
  })

  describe('console output', () => {
    it('should print success message when no issues found', () => {
      const result: ConfigScanResult = {
        issues: [],
        errors: 0,
        warnings: 0,
        infos: 0,
      }

      printConfigReport(result)

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('No configuration issues found!')
      )
    })

    it('should print error issues', () => {
      const result: ConfigScanResult = {
        issues: [
          {
            type: 'babel-detected',
            severity: 'error',
            message: 'Babel detected - may transpile modern syntax and break V8 coverage',
            files: ['babel.config.js'],
          },
        ],
        errors: 1,
        warnings: 0,
        infos: 0,
      }

      printConfigReport(result)

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Babel detected')
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('babel.config.js')
      )
    })

    it('should print warning issues', () => {
      const result: ConfigScanResult = {
        issues: [
          {
            type: 'jest-detected',
            severity: 'warning',
            message: 'Jest detected - consider using Vitest',
            files: ['jest.config.js'],
          },
        ],
        errors: 0,
        warnings: 1,
        infos: 0,
      }

      printConfigReport(result)

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Jest detected')
      )
    })

    it('should print info issues', () => {
      const result: ConfigScanResult = {
        issues: [
          {
            type: 'vitest-not-found',
            severity: 'info',
            message: 'Vitest not found - recommended for unit test coverage',
          },
        ],
        errors: 0,
        warnings: 0,
        infos: 1,
      }

      printConfigReport(result)

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Vitest not found')
      )
    })

    it('should print multiple issues', () => {
      const result: ConfigScanResult = {
        issues: [
          {
            type: 'babel-detected',
            severity: 'error',
            message: 'Babel detected',
            files: ['babel.config.js'],
          },
          {
            type: 'jest-detected',
            severity: 'warning',
            message: 'Jest detected',
            files: ['jest.config.js'],
          },
        ],
        errors: 1,
        warnings: 1,
        infos: 0,
      }

      printConfigReport(result)

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Babel detected'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Jest detected'))
    })
  })

  describe('JSON output', () => {
    it('should output JSON format when json option is true', () => {
      const result: ConfigScanResult = {
        issues: [
          {
            type: 'babel-detected',
            severity: 'error',
            message: 'Babel detected',
            files: ['babel.config.js'],
          },
        ],
        errors: 1,
        warnings: 0,
        infos: 0,
      }

      printConfigReport(result, { json: true })

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
      const result: ConfigScanResult = {
        issues: [],
        errors: 0,
        warnings: 0,
        infos: 0,
      }

      printConfigReport(result, { json: true })

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
    })
  })
})

describe('getExitCode', () => {
  it('should return 0 when no config errors', () => {
    const result: ConfigScanResult = {
      issues: [],
      errors: 0,
      warnings: 0,
      infos: 0,
    }

    expect(getExitCode(result)).toBe(0)
  })

  it('should return 1 when config errors found', () => {
    const result: ConfigScanResult = {
      issues: [
        {
          type: 'babel-detected',
          severity: 'error',
          message: 'Babel detected',
        },
      ],
      errors: 1,
      warnings: 0,
      infos: 0,
    }

    expect(getExitCode(result)).toBe(1)
  })

  it('should return 0 when only warnings (no errors)', () => {
    const result: ConfigScanResult = {
      issues: [
        {
          type: 'jest-detected',
          severity: 'warning',
          message: 'Jest detected',
        },
      ],
      errors: 0,
      warnings: 1,
      infos: 0,
    }

    expect(getExitCode(result)).toBe(0)
  })

  it('should return 0 when result is null', () => {
    expect(getExitCode(null)).toBe(0)
  })
})
