// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Page, TestInfo } from '@playwright/test'

// Mock dependencies
vi.mock('../../collector/index.js', () => ({
  saveServerCoverage: vi.fn().mockResolvedValue(undefined),
  readAllClientCoverage: vi.fn().mockResolvedValue([]),
  saveClientCoverage: vi.fn().mockResolvedValue(undefined),
  cleanCoverageDir: vi.fn().mockResolvedValue(undefined),
  filterAppCoverage: vi.fn((coverage) => coverage),
  stopServerCoverageAutoDetect: vi.fn().mockResolvedValue({ entries: [], isDevMode: false }),
  initCoverageDir: vi.fn().mockResolvedValue(undefined),
  connectToCDP: vi.fn(),
  collectServerCoverage: vi.fn(),
  createDevModeServerCollector: vi.fn(),
  startServerCoverageAutoDetect: vi.fn(),
}))

vi.mock('../../processor.js', () => ({
  CoverageProcessor: class MockCoverageProcessor {
    processAllCoverage = vi.fn().mockResolvedValue({
      summary: { lines: { pct: 85.5 } },
    })
  },
}))

describe('playwright integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('finalizeCoverage', () => {
    it('should return null when no coverage is collected', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const { finalizeCoverage } = await import('../index.js')
      const { stopServerCoverageAutoDetect, readAllClientCoverage } = await import('../../collector/index.js')

      vi.mocked(stopServerCoverageAutoDetect).mockResolvedValue({ entries: [], isDevMode: false })
      vi.mocked(readAllClientCoverage).mockResolvedValue([])

      const result = await finalizeCoverage()

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No coverage to process'))

      consoleSpy.mockRestore()
    })

    it('should process coverage and return result', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const { finalizeCoverage } = await import('../index.js')
      const { stopServerCoverageAutoDetect, readAllClientCoverage } = await import('../../collector/index.js')

      vi.mocked(stopServerCoverageAutoDetect).mockResolvedValue({
        entries: [{ url: 'test', functions: [] }] as any,
        isDevMode: false,
      })
      vi.mocked(readAllClientCoverage).mockResolvedValue([])

      const result = await finalizeCoverage()

      expect(result).not.toBeNull()
      expect(result!.summary.lines.pct).toBe(85.5)

      consoleSpy.mockRestore()
    })

    it('should collect from both server and client', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const { finalizeCoverage } = await import('../index.js')
      const { stopServerCoverageAutoDetect, readAllClientCoverage } = await import('../../collector/index.js')

      const serverCoverage = [{ url: 'server.js', functions: [] }]
      const clientCoverage = [{ url: 'client.js', source: 'code', rawScriptCoverage: [] }]

      vi.mocked(stopServerCoverageAutoDetect).mockResolvedValue({
        entries: serverCoverage as any,
        isDevMode: false,
      })
      vi.mocked(readAllClientCoverage).mockResolvedValue(clientCoverage as any)

      await finalizeCoverage()

      expect(stopServerCoverageAutoDetect).toHaveBeenCalled()
      expect(readAllClientCoverage).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('should use custom options', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const { finalizeCoverage } = await import('../index.js')
      const { stopServerCoverageAutoDetect, readAllClientCoverage, cleanCoverageDir } = await import(
        '../../collector/index.js'
      )

      vi.mocked(stopServerCoverageAutoDetect).mockResolvedValue({
        entries: [{ url: 'test', functions: [] }] as any,
        isDevMode: false,
      })
      vi.mocked(readAllClientCoverage).mockResolvedValue([])

      await finalizeCoverage({
        outputDir: './custom-coverage',
        sourceRoot: './lib',
        cleanup: true,
      })

      expect(cleanCoverageDir).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('should skip cleanup when disabled', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const { finalizeCoverage } = await import('../index.js')
      const { stopServerCoverageAutoDetect, readAllClientCoverage, cleanCoverageDir } = await import(
        '../../collector/index.js'
      )

      vi.mocked(stopServerCoverageAutoDetect).mockResolvedValue({
        entries: [{ url: 'test', functions: [] }] as any,
        isDevMode: false,
      })
      vi.mocked(readAllClientCoverage).mockResolvedValue([])

      // Reset mock to track calls
      vi.mocked(cleanCoverageDir).mockClear()

      await finalizeCoverage({ cleanup: false })

      expect(cleanCoverageDir).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('should skip server collection when disabled', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const { finalizeCoverage } = await import('../index.js')
      const { stopServerCoverageAutoDetect, readAllClientCoverage } = await import('../../collector/index.js')

      vi.mocked(readAllClientCoverage).mockResolvedValue([
        { url: 'client.js', source: 'code', rawScriptCoverage: [] } as any,
      ])

      vi.mocked(stopServerCoverageAutoDetect).mockClear()

      await finalizeCoverage({ collectServer: false })

      expect(stopServerCoverageAutoDetect).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('should skip client collection when disabled', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const { finalizeCoverage } = await import('../index.js')
      const { stopServerCoverageAutoDetect, readAllClientCoverage } = await import('../../collector/index.js')

      vi.mocked(stopServerCoverageAutoDetect).mockResolvedValue({
        entries: [{ url: 'server.js', functions: [] }] as any,
        isDevMode: false,
      })

      vi.mocked(readAllClientCoverage).mockClear()

      await finalizeCoverage({ collectClient: false })

      expect(readAllClientCoverage).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('should handle dev mode coverage', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const { finalizeCoverage } = await import('../index.js')
      const { stopServerCoverageAutoDetect, saveServerCoverage } = await import('../../collector/index.js')

      // Dev mode - entries have sourceMapData
      vi.mocked(stopServerCoverageAutoDetect).mockResolvedValue({
        entries: [
          {
            url: 'webpack-internal:///(rsc)/./src/app/page.tsx',
            functions: [],
            sourceMapData: { version: 3, sources: [], mappings: '' },
          },
        ] as any,
        isDevMode: true,
      })

      await finalizeCoverage()

      // In dev mode, saveServerCoverage should NOT be called (inline source maps)
      expect(saveServerCoverage).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('should save server coverage in production mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const { finalizeCoverage } = await import('../index.js')
      const { stopServerCoverageAutoDetect, saveServerCoverage, readAllClientCoverage } = await import(
        '../../collector/index.js'
      )

      // Production mode
      vi.mocked(stopServerCoverageAutoDetect).mockResolvedValue({
        entries: [{ url: '/_next/static/chunks/main.js', functions: [] }] as any,
        isDevMode: false,
      })
      vi.mocked(readAllClientCoverage).mockResolvedValue([])

      await finalizeCoverage()

      expect(saveServerCoverage).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

it('should handle no coverage scenario and cleanup', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const { finalizeCoverage } = await import('../index.js')
      const { stopServerCoverageAutoDetect, readAllClientCoverage, cleanCoverageDir } = await import(
        '../../collector/index.js'
      )

      // No coverage entries
      vi.mocked(stopServerCoverageAutoDetect).mockResolvedValue({
        entries: [],
        isDevMode: false,
      })
      vi.mocked(readAllClientCoverage).mockResolvedValue([])

      const result = await finalizeCoverage({ cleanup: true })

      expect(result).toBeNull()
      expect(cleanCoverageDir).toHaveBeenCalled()

      consoleSpy.mockRestore()
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
      const { stopServerCoverageAutoDetect, readAllClientCoverage } = await import('../../collector/index.js')

      vi.mocked(stopServerCoverageAutoDetect).mockResolvedValue({ entries: [], isDevMode: false })
      vi.mocked(readAllClientCoverage).mockResolvedValue([])

      await finalizeCoverage()

      // Should use defaults - collectServer and collectClient are true by default
      expect(stopServerCoverageAutoDetect).toHaveBeenCalled()
      expect(readAllClientCoverage).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })
})
