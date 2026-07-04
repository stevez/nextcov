import { vi, type Mock } from 'vitest'
import type { CDPClientInstance } from '../cdp-client.js'

/** Create a mock CDPClientInstance with all required methods */
export function createMockCoverageClient(
  overrides?: Partial<Record<keyof CDPClientInstance, Mock>>
): CDPClientInstance {
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
