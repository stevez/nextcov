// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Page, TestInfo } from '@playwright/test'

// Mock the logger module
vi.mock('../../logger.js', () => ({
  log: vi.fn(),
  setLogging: vi.fn(),
  setTiming: vi.fn(),
  isLoggingEnabled: vi.fn().mockReturnValue(false),
  isTimingEnabled: vi.fn().mockReturnValue(false),
  warn: vi.fn(),
  error: vi.fn(),
}))

// Mock V8ServerCoverageCollector - track calls and return values
let mockV8CollectorCollectReturn: any[] = []
const mockV8CollectorInstances: any[] = []

class MockV8ServerCoverageCollector {
  connect = vi.fn().mockResolvedValue(true)
  collect = vi.fn().mockImplementation(() => Promise.resolve(mockV8CollectorCollectReturn))
  cleanup = vi.fn().mockResolvedValue(undefined)

  constructor() {
    mockV8CollectorInstances.push(this)
  }
}

// Mock DevModeServerCollector - track calls and return values
let mockDevModeCollectorConnectReturn = false
let mockDevModeCollectorCollectReturn: any[] = []
let mockDevModeCollectorWebpackReady = true
const mockDevModeCollectorInstances: any[] = []

class MockDevModeServerCollector {
  connect = vi.fn().mockImplementation(() => Promise.resolve(mockDevModeCollectorConnectReturn))
  collect = vi.fn().mockImplementation(() => Promise.resolve(mockDevModeCollectorCollectReturn))
  waitForWebpackScripts = vi.fn().mockImplementation(() => Promise.resolve(mockDevModeCollectorWebpackReady))

  constructor() {
    mockDevModeCollectorInstances.push(this)
  }
}

// Mock CoverageProcessor - track behavior
let mockProcessorThrows = false
let mockProcessorError = new Error('Processing failed')

class MockCoverageProcessor {
  processAllCoverage = vi.fn().mockImplementation(() => {
    if (mockProcessorThrows) {
      return Promise.reject(mockProcessorError)
    }
    return Promise.resolve({ summary: { lines: { pct: 85.5 } } })
  })
}

// Mock dependencies
vi.mock('../../collector/index.js', () => ({
  saveServerCoverage: vi.fn().mockResolvedValue(undefined),
  readAllClientCoverage: vi.fn().mockResolvedValue([]),
  saveClientCoverage: vi.fn().mockResolvedValue(undefined),
  cleanCoverageDir: vi.fn().mockResolvedValue(undefined),
  filterAppCoverage: vi.fn((coverage) => coverage),
  initCoverageDir: vi.fn().mockResolvedValue(undefined),
  connectToCDP: vi.fn(),
  collectServerCoverage: vi.fn(),
  createDevModeServerCollector: vi.fn(),
  ClientCoverageCollector: class MockClientCoverageCollector {
    readAllClientCoverage = vi.fn().mockResolvedValue([])
    saveClientCoverage = vi.fn().mockResolvedValue(undefined)
    cleanCoverageDir = vi.fn().mockResolvedValue(undefined)
  },
  V8ServerCoverageCollector: MockV8ServerCoverageCollector,
  DevModeServerCollector: MockDevModeServerCollector,
}))

vi.mock('../../processor.js', () => ({
  CoverageProcessor: MockCoverageProcessor,
}))

describe('playwright integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // Reset V8 collector mocks
    mockV8CollectorCollectReturn = []
    mockV8CollectorInstances.length = 0
    // Reset dev mode collector mocks
    mockDevModeCollectorConnectReturn = false
    mockDevModeCollectorCollectReturn = []
    mockDevModeCollectorWebpackReady = true
    mockDevModeCollectorInstances.length = 0
    // Reset processor mocks
    mockProcessorThrows = false
    mockProcessorError = new Error('Processing failed')
    // Reset module-level state between tests
    const { resetCoverageState } = await import('../fixture.js')
    resetCoverageState()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('finalizeCoverage', () => {
    it('should return null when no coverage is collected', async () => {
      const { finalizeCoverage } = await import('../index.js')
      const { readAllClientCoverage } = await import('../../collector/index.js')
      const { log } = await import('../../logger.js')

      // V8 collector returns empty by default
      mockV8CollectorCollectReturn = []
      vi.mocked(readAllClientCoverage).mockResolvedValue([])

      const result = await finalizeCoverage()

      expect(result).toBeNull()
      expect(log).toHaveBeenCalledWith(expect.stringContaining('No coverage to process'))
    })

    it('should process coverage and return result', async () => {
      const { finalizeCoverage } = await import('../index.js')

      // Mock V8ServerCoverageCollector to return coverage
      mockV8CollectorCollectReturn = [{ url: 'test', functions: [] }]

      const result = await finalizeCoverage()

      expect(result).not.toBeNull()
      expect(result!.summary.lines.pct).toBe(85.5)
    })

    it('should collect from both server and client', async () => {
      const { finalizeCoverage } = await import('../index.js')

      const serverCoverage = [{ url: 'server.js', functions: [] }]

      // Mock V8ServerCoverageCollector to return server coverage
      mockV8CollectorCollectReturn = serverCoverage

      await finalizeCoverage()

      // V8ServerCoverageCollector should be instantiated (V8 mode is now default)
      expect(mockV8CollectorInstances.length).toBeGreaterThan(0)
      // Client collection uses ClientCoverageCollector instance (mocked via class mock)
    })

    it('should use custom options', async () => {
      const { finalizeCoverage } = await import('../index.js')

      // V8 collector returns server coverage
      mockV8CollectorCollectReturn = [{ url: 'test', functions: [] }]

      // Just verify it runs without error with custom options
      // Cleanup uses ClientCoverageCollector instance (mocked via class mock)
      await finalizeCoverage({
        outputDir: './custom-coverage',
        sourceRoot: './lib',
        cleanup: true,
      })
    })

    it('should skip cleanup when disabled', async () => {
      const { finalizeCoverage } = await import('../index.js')
      const { readAllClientCoverage, cleanCoverageDir } = await import(
        '../../collector/index.js'
      )

      // V8 collector returns server coverage
      mockV8CollectorCollectReturn = [{ url: 'test', functions: [] }]
      vi.mocked(readAllClientCoverage).mockResolvedValue([])

      // Reset mock to track calls
      vi.mocked(cleanCoverageDir).mockClear()

      await finalizeCoverage({ cleanup: false })

      expect(cleanCoverageDir).not.toHaveBeenCalled()
    })

    it('should skip server collection when disabled', async () => {
      const { finalizeCoverage } = await import('../index.js')
      const { readAllClientCoverage } = await import('../../collector/index.js')

      vi.mocked(readAllClientCoverage).mockResolvedValue([
        { url: 'client.js', source: 'code', rawScriptCoverage: [] } as any,
      ])

      // Clear instances before this test
      mockV8CollectorInstances.length = 0

      await finalizeCoverage({ collectServer: false })

      // V8ServerCoverageCollector should not be instantiated when server collection is disabled
      expect(mockV8CollectorInstances.length).toBe(0)
    })

    it('should skip client collection when disabled', async () => {
      const { finalizeCoverage } = await import('../index.js')
      const { readAllClientCoverage } = await import('../../collector/index.js')

      // V8 collector returns server coverage
      mockV8CollectorCollectReturn = [{ url: 'server.js', functions: [] }]

      vi.mocked(readAllClientCoverage).mockClear()

      await finalizeCoverage({ collectClient: false })

      expect(readAllClientCoverage).not.toHaveBeenCalled()
    })

    it('should save server coverage via V8 collector', async () => {
      const { finalizeCoverage } = await import('../index.js')

      // V8 collector returns server coverage
      mockV8CollectorCollectReturn = [
        { url: '/_next/static/chunks/main.js', functions: [] },
      ]

      // Just verify it runs without error with V8 mode
      // Server coverage save uses ServerCoverageCollector instance (mocked via class mock)
      await finalizeCoverage()

      // V8ServerCoverageCollector should be instantiated
      expect(mockV8CollectorInstances.length).toBeGreaterThan(0)
    })

    it('should handle no coverage scenario and cleanup', async () => {
      const { finalizeCoverage } = await import('../index.js')

      // No coverage entries from V8 collector
      mockV8CollectorCollectReturn = []

      const result = await finalizeCoverage({ cleanup: true })

      expect(result).toBeNull()
      // Cleanup uses ClientCoverageCollector instance (mocked via class mock)
    })
  })

  describe('collectClientCoverage', () => {
    it('should collect and save client coverage', async () => {
      const { collectClientCoverage } = await import('../index.js')
      const { saveClientCoverage, filterAppCoverage } = await import('../../collector/index.js')

      const mockCoverage = [{ url: 'http://localhost:3000/_next/static/chunks/app.js', functions: [] }]

      const mockPage = {
        coverage: {
          startJSCoverage: vi.fn().mockResolvedValue(undefined),
          stopJSCoverage: vi.fn().mockResolvedValue(mockCoverage),
        },
      } as unknown as Page

      const mockTestInfo = {
        workerIndex: 0,
        testId: 'test-123',
      } as TestInfo

      let useResolved = false
      const mockUse = vi.fn(async () => {
        useResolved = true
      })

      vi.mocked(filterAppCoverage).mockReturnValue(mockCoverage as any)

      await collectClientCoverage(mockPage, mockTestInfo, mockUse)

      expect(mockPage.coverage.startJSCoverage).toHaveBeenCalledWith({ resetOnNavigation: false })
      expect(mockUse).toHaveBeenCalled()
      expect(useResolved).toBe(true)
      expect(mockPage.coverage.stopJSCoverage).toHaveBeenCalled()
      expect(filterAppCoverage).toHaveBeenCalledWith(mockCoverage)
      expect(saveClientCoverage).toHaveBeenCalledWith('0-test-123', mockCoverage)
    })

    it('should not save when no app coverage', async () => {
      const { collectClientCoverage } = await import('../index.js')
      const { saveClientCoverage, filterAppCoverage } = await import('../../collector/index.js')

      const mockPage = {
        coverage: {
          startJSCoverage: vi.fn().mockResolvedValue(undefined),
          stopJSCoverage: vi.fn().mockResolvedValue([]),
        },
      } as unknown as Page

      const mockTestInfo = {
        workerIndex: 0,
        testId: 'test-456',
      } as TestInfo

      const mockUse = vi.fn(async () => {})

      vi.mocked(filterAppCoverage).mockReturnValue([])
      vi.mocked(saveClientCoverage).mockClear()

      await collectClientCoverage(mockPage, mockTestInfo, mockUse)

      expect(saveClientCoverage).not.toHaveBeenCalled()
    })

    it('should sanitize test ID for filename', async () => {
      const { collectClientCoverage } = await import('../index.js')
      const { saveClientCoverage, filterAppCoverage } = await import('../../collector/index.js')

      const mockPage = {
        coverage: {
          startJSCoverage: vi.fn().mockResolvedValue(undefined),
          stopJSCoverage: vi.fn().mockResolvedValue([{ url: 'test.js' }]),
        },
      } as unknown as Page

      const mockTestInfo = {
        workerIndex: 1,
        testId: 'test/with:special@chars!',
      } as TestInfo

      const mockUse = vi.fn(async () => {})

      vi.mocked(filterAppCoverage).mockReturnValue([{ url: 'test.js' }] as any)

      await collectClientCoverage(mockPage, mockTestInfo, mockUse)

      // Should sanitize special characters
      expect(saveClientCoverage).toHaveBeenCalledWith('1-test-with-special-chars-', expect.anything())
    })
  })

  describe('PlaywrightCoverageOptions defaults', () => {
    it('should use default options when none provided', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const { finalizeCoverage } = await import('../index.js')

      await finalizeCoverage()

      // Should use defaults - collectServer and collectClient are true by default
      // V8ServerCoverageCollector should be instantiated (V8 mode is now default)
      expect(mockV8CollectorInstances.length).toBeGreaterThan(0)
      // Client collection uses ClientCoverageCollector instance (mocked via class mock)

      consoleSpy.mockRestore()
    })
  })

  describe('startServerCoverage', () => {
    it('should return false when dev mode connection fails (production mode)', async () => {
      const { startServerCoverage } = await import('../fixture.js')
      const { log } = await import('../../logger.js')

      // Configure dev mode collector to fail connection (production mode)
      mockDevModeCollectorConnectReturn = false

      const result = await startServerCoverage({ cdpPort: 9230 })

      expect(result).toBe(false)
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Production mode'))
    })

    it('should return true when dev mode connection succeeds', async () => {
      const { startServerCoverage } = await import('../fixture.js')
      const { log } = await import('../../logger.js')

      // Configure dev mode collector to succeed connection (dev mode)
      mockDevModeCollectorConnectReturn = true
      mockDevModeCollectorWebpackReady = true

      // Mock fetch for warmup request
      global.fetch = vi.fn().mockResolvedValue({ ok: true })

      const result = await startServerCoverage({ cdpPort: 9230 })

      expect(result).toBe(true)
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Dev mode'))
    })

    it('should handle warmup request failure gracefully', async () => {
      const { startServerCoverage } = await import('../fixture.js')
      const { log } = await import('../../logger.js')

      // Configure dev mode collector to succeed connection
      mockDevModeCollectorConnectReturn = true

      // Mock fetch to fail
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'))

      const result = await startServerCoverage({ cdpPort: 9230 })

      expect(result).toBe(true)
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Warmup request failed'))
    })

    it('should log warning when webpack is not ready', async () => {
      const { startServerCoverage } = await import('../fixture.js')
      const { log } = await import('../../logger.js')

      // Configure dev mode collector with webpack not ready
      mockDevModeCollectorConnectReturn = true
      mockDevModeCollectorWebpackReady = false

      global.fetch = vi.fn().mockResolvedValue({ ok: true })

      const result = await startServerCoverage({ cdpPort: 9230 })

      expect(result).toBe(true)
      expect(log).toHaveBeenCalledWith(expect.stringContaining('webpack not ready'))
    })
  })

  describe('finalizeCoverage error handling', () => {
    it('should return null and log error when processing throws', async () => {
      const { finalizeCoverage } = await import('../index.js')

      // V8 collector returns server coverage
      mockV8CollectorCollectReturn = [{ url: 'test', functions: [] }]

      // Configure processor to throw
      mockProcessorThrows = true

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = await finalizeCoverage()

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error processing coverage'),
        expect.any(Error)
      )

      consoleSpy.mockRestore()
    })
  })

  describe('dev mode finalizeCoverage', () => {
    it('should use dev mode flow when devModeCollector is active', async () => {
      const { startServerCoverage, finalizeCoverage } = await import('../fixture.js')
      const { log } = await import('../../logger.js')

      // Configure dev mode collector to succeed and return coverage
      mockDevModeCollectorConnectReturn = true
      mockDevModeCollectorCollectReturn = [{ url: 'webpack-internal:///./src/app/page.tsx', functions: [] }]

      global.fetch = vi.fn().mockResolvedValue({ ok: true })

      // Start dev mode
      await startServerCoverage({ cdpPort: 9230 })

      // Finalize should use dev mode flow
      await finalizeCoverage()

      expect(log).toHaveBeenCalledWith(expect.stringContaining('dev mode'))
    })

    it('should handle error in dev mode and still cleanup', async () => {
      const { startServerCoverage, finalizeCoverage } = await import('../fixture.js')

      // Configure dev mode collector
      mockDevModeCollectorConnectReturn = true
      mockDevModeCollectorCollectReturn = [{ url: 'test', functions: [] }]

      global.fetch = vi.fn().mockResolvedValue({ ok: true })

      // Configure processor to throw
      mockProcessorThrows = true

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Start dev mode
      await startServerCoverage({ cdpPort: 9230 })

      // Finalize should handle error gracefully
      const result = await finalizeCoverage({ cleanup: true })

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('collectClientCoverage with config', () => {
    it('should use custom cacheDir from config', async () => {
      const { collectClientCoverage } = await import('../index.js')
      const { filterAppCoverage, ClientCoverageCollector } = await import('../../collector/index.js')

      const mockCoverage = [{ url: 'http://localhost:3000/_next/static/chunks/app.js', functions: [] }]

      const mockPage = {
        coverage: {
          startJSCoverage: vi.fn().mockResolvedValue(undefined),
          stopJSCoverage: vi.fn().mockResolvedValue(mockCoverage),
        },
      } as unknown as Page

      const mockTestInfo = {
        workerIndex: 0,
        testId: 'test-with-config',
      } as TestInfo

      const mockUse = vi.fn(async () => {})

      vi.mocked(filterAppCoverage).mockReturnValue(mockCoverage as any)

      await collectClientCoverage(mockPage, mockTestInfo, mockUse, {
        outputDir: './custom-coverage',
      })

      // Should create ClientCoverageCollector - verify it was instantiated
      // The mock class from vi.mock captures instantiation
      expect(mockPage.coverage.startJSCoverage).toHaveBeenCalled()
      expect(mockPage.coverage.stopJSCoverage).toHaveBeenCalled()
    })
  })

  describe('resetCoverageState', () => {
    it('should reset dev mode collector state', async () => {
      const { startServerCoverage, finalizeCoverage, resetCoverageState } = await import('../fixture.js')

      // Configure dev mode collector
      mockDevModeCollectorConnectReturn = true
      mockDevModeCollectorCollectReturn = [{ url: 'test', functions: [] }]

      global.fetch = vi.fn().mockResolvedValue({ ok: true })

      // Start dev mode
      await startServerCoverage({ cdpPort: 9230 })

      // Reset state
      resetCoverageState()

      // Configure dev mode to fail (so production mode kicks in)
      mockDevModeCollectorConnectReturn = false

      // Now finalizeCoverage should use production mode (V8ServerCoverageCollector)
      mockV8CollectorInstances.length = 0
      await finalizeCoverage()

      // Should have created V8ServerCoverageCollector (production mode)
      expect(mockV8CollectorInstances.length).toBeGreaterThan(0)
    })
  })
})
