/**
 * Config Scanner Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { scanConfig } from '../config-scanner.js'
import { detectConfigIssues } from '../detectors/project-config.js'

// Mock the detector
vi.mock('../detectors/project-config.js', () => ({
  detectConfigIssues: vi.fn(),
}))

describe('scanConfig', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('should return empty result when no issues', () => {
    vi.mocked(detectConfigIssues).mockReturnValue([])

    const result = scanConfig({ cwd: '/test' })

    expect(result.issues).toHaveLength(0)
    expect(result.errors).toBe(0)
    expect(result.warnings).toBe(0)
    expect(result.infos).toBe(0)
  })

  it('should count errors correctly', () => {
    vi.mocked(detectConfigIssues).mockReturnValue([
      { type: 'missing-browserslist', severity: 'error', message: 'Missing browserslist' },
      { type: 'babel-detected', severity: 'error', message: 'Babel detected' },
      { type: 'playwright-not-found', severity: 'error', message: 'Playwright not found' },
    ])

    const result = scanConfig({ cwd: '/test' })

    expect(result.issues).toHaveLength(3)
    expect(result.errors).toBe(3)
    expect(result.warnings).toBe(0)
    expect(result.infos).toBe(0)
  })

  it('should count warnings correctly', () => {
    vi.mocked(detectConfigIssues).mockReturnValue([
      { type: 'jest-detected', severity: 'warning', message: 'Jest detected' },
      { type: 'sourcemaps-not-enabled', severity: 'warning', message: 'Source maps not enabled' },
    ])

    const result = scanConfig({ cwd: '/test' })

    expect(result.issues).toHaveLength(2)
    expect(result.errors).toBe(0)
    expect(result.warnings).toBe(2)
    expect(result.infos).toBe(0)
  })

  it('should count infos correctly', () => {
    vi.mocked(detectConfigIssues).mockReturnValue([
      { type: 'vitest-not-found', severity: 'info', message: 'Vitest not found' },
    ])

    const result = scanConfig({ cwd: '/test' })

    expect(result.issues).toHaveLength(1)
    expect(result.errors).toBe(0)
    expect(result.warnings).toBe(0)
    expect(result.infos).toBe(1)
  })

  it('should count mixed severities correctly', () => {
    vi.mocked(detectConfigIssues).mockReturnValue([
      { type: 'missing-browserslist', severity: 'error', message: 'Missing browserslist' },
      { type: 'babel-detected', severity: 'error', message: 'Babel detected' },
      { type: 'jest-detected', severity: 'warning', message: 'Jest detected' },
      { type: 'vitest-not-found', severity: 'info', message: 'Vitest not found' },
    ])

    const result = scanConfig({ cwd: '/test' })

    expect(result.issues).toHaveLength(4)
    expect(result.errors).toBe(2)
    expect(result.warnings).toBe(1)
    expect(result.infos).toBe(1)
  })

  it('should use process.cwd() as default', () => {
    vi.mocked(detectConfigIssues).mockReturnValue([])

    scanConfig()

    expect(detectConfigIssues).toHaveBeenCalledWith(process.cwd())
  })

  it('should use provided cwd', () => {
    vi.mocked(detectConfigIssues).mockReturnValue([])

    scanConfig({ cwd: '/custom/path' })

    expect(detectConfigIssues).toHaveBeenCalledWith('/custom/path')
  })
})
