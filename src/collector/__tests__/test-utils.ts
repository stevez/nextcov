import { vi, type Mock } from 'vitest'
import type { CoverageClient } from 'monocart-coverage-reports'

/** Create a mock CoverageClient with all required methods */
export function createMockCoverageClient(
  overrides?: Partial<Record<keyof CoverageClient, Mock>>
): CoverageClient {
  return {
    startJSCoverage: vi.fn().mockResolvedValue(undefined),
    stopJSCoverage: vi.fn().mockResolvedValue([]),
    startCSSCoverage: vi.fn().mockResolvedValue(undefined),
    stopCSSCoverage: vi.fn().mockResolvedValue([]),
    startCoverage: vi.fn().mockResolvedValue(undefined),
    stopCoverage: vi.fn().mockResolvedValue([]),
    writeCoverage: vi.fn().mockResolvedValue(''),
    getIstanbulCoverage: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}
