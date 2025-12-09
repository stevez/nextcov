// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  startServerCoverageAutoDetect,
  stopServerCoverageAutoDetect,
  collectServerCoverageAutoDetect,
  autoDetectServerCollector,
} from '../auto-detect.js'
import { ServerCoverageCollector } from '../server.js'
import { DevModeServerCollector } from '../dev-server.js'
import { createMockCoverageClient } from './test-utils.js'

// Mock chrome-remote-interface
vi.mock('chrome-remote-interface', () => ({
  default: vi.fn(),
}))

// Mock monocart-coverage-reports CDPClient
vi.mock('monocart-coverage-reports', () => ({
  CDPClient: vi.fn(),
}))

describe('auto-detect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('startServerCoverageAutoDetect', () => {
    it('should detect dev mode when dev port is connectable', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      // Mock CDP for canConnect check
      const CDP = (await import('chrome-remote-interface')).default

      // First call (dev port check) - success
      // Second call (connect) - mock full connection
      let callCount = 0
      vi.mocked(CDP).mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          // canConnect check - return minimal client
          return { close: vi.fn() } as any
        }
        // Actual connection - needs close() for cleanup
        return {
          Debugger: {
            enable: vi.fn().mockResolvedValue(undefined),
            disable: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
          },
          Profiler: {
            enable: vi.fn().mockResolvedValue(undefined),
            startPreciseCoverage: vi.fn().mockResolvedValue(undefined),
            takePreciseCoverage: vi.fn().mockResolvedValue({ result: [] }),
            stopPreciseCoverage: vi.fn().mockResolvedValue(undefined),
          },
          close: vi.fn().mockResolvedValue(undefined),
        } as any
      })

      const result = await startServerCoverageAutoDetect({ cdpPort: 9230 })

      expect(result).not.toBeNull()
      expect(result!.isDevMode).toBe(true)
      expect(result!.port).toBe(9231) // dev port = base + 1

      // Reset for next test
      await stopServerCoverageAutoDetect()
      consoleSpy.mockRestore()
    })

    it('should detect production mode when only base port is connectable', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const CDP = (await import('chrome-remote-interface')).default
      const { CDPClient } = await import('monocart-coverage-reports')

      // Dev port fails, base port succeeds
      vi.mocked(CDP).mockImplementation(async (opts: { port: number }) => {
        if (opts.port === 9231) {
          throw new Error('Connection refused')
        }
        // Base port canConnect check
        return { close: vi.fn() } as any
      })

      // ServerCoverageCollector uses CDPClient
      vi.mocked(CDPClient).mockResolvedValue(createMockCoverageClient())

      const result = await startServerCoverageAutoDetect({ cdpPort: 9230 })

      expect(result).not.toBeNull()
      expect(result!.isDevMode).toBe(false)
      expect(result!.port).toBe(9230)

      await stopServerCoverageAutoDetect()
      consoleSpy.mockRestore()
    })

    it('should return null when no port is connectable', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const CDP = (await import('chrome-remote-interface')).default
      vi.mocked(CDP).mockRejectedValue(new Error('Connection refused'))

      const result = await startServerCoverageAutoDetect({ cdpPort: 9230 })

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Could not connect'))

      consoleSpy.mockRestore()
    })

    it('should use default port when not specified', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const CDP = (await import('chrome-remote-interface')).default
      vi.mocked(CDP).mockRejectedValue(new Error('Connection refused'))

      await startServerCoverageAutoDetect()

      // Should try ports 9231 (dev) and 9230 (base)
      expect(CDP).toHaveBeenCalledWith({ port: 9231 })
      expect(CDP).toHaveBeenCalledWith({ port: 9230 })

      consoleSpy.mockRestore()
    })
  })

  describe('stopServerCoverageAutoDetect', () => {
    it('should return empty entries when no active collector', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      // First ensure no collector is active by calling stop
      // This should just return empty entries without error
      const result = await stopServerCoverageAutoDetect()

      expect(result.entries).toEqual([])
      expect(result.isDevMode).toBe(false)
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No active coverage'))

      consoleSpy.mockRestore()
    })

    it('should collect and return entries from active collector', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      // Start dev mode collection
      const CDP = (await import('chrome-remote-interface')).default

      let callCount = 0
      vi.mocked(CDP).mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          return { close: vi.fn() } as any
        }
        return {
          Debugger: {
            enable: vi.fn().mockResolvedValue(undefined),
            disable: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
            getScriptSource: vi.fn().mockResolvedValue({ scriptSource: 'code' }),
          },
          Profiler: {
            enable: vi.fn().mockResolvedValue(undefined),
            startPreciseCoverage: vi.fn().mockResolvedValue(undefined),
            takePreciseCoverage: vi.fn().mockResolvedValue({ result: [] }),
            stopPreciseCoverage: vi.fn().mockResolvedValue(undefined),
          },
          close: vi.fn().mockResolvedValue(undefined),
        } as any
      })

      await startServerCoverageAutoDetect({ cdpPort: 9230 })
      const result = await stopServerCoverageAutoDetect()

      expect(result.isDevMode).toBe(true)
      expect(Array.isArray(result.entries)).toBe(true)

      consoleSpy.mockRestore()
    })
  })

  describe('collectServerCoverageAutoDetect', () => {
    it('should collect from dev mode when available', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const sourceMap = {
        version: 3,
        file: 'test',
        sources: ['src/test.ts'],
        sourcesContent: ['code'],
        mappings: 'AAAA',
        names: [],
      }
      const base64 = Buffer.from(JSON.stringify(sourceMap)).toString('base64')

      const CDP = (await import('chrome-remote-interface')).default
      // Store the scriptParsed handler so we can call it synchronously
      let scriptParsedHandler: ((params: { scriptId: string; url: string }) => void) | null = null

      let callCount = 0
      vi.mocked(CDP).mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          return { close: vi.fn() } as any
        }
        return {
          Debugger: {
            enable: vi.fn().mockImplementation(async () => {
              // Call handler synchronously after enable
              if (scriptParsedHandler) {
                scriptParsedHandler({ scriptId: '1', url: 'webpack-internal:///(rsc)/./src/test.ts' })
              }
            }),
            disable: vi.fn().mockResolvedValue(undefined),
            on: vi.fn((event: string, handler: (params: { scriptId: string; url: string }) => void) => {
              if (event === 'scriptParsed') {
                scriptParsedHandler = handler
              }
            }),
            getScriptSource: vi.fn().mockResolvedValue({
              scriptSource: `code//# sourceMappingURL=data:application/json,${base64}`,
            }),
          },
          Profiler: {
            enable: vi.fn().mockResolvedValue(undefined),
            startPreciseCoverage: vi.fn().mockResolvedValue(undefined),
            takePreciseCoverage: vi.fn().mockResolvedValue({
              result: [
                {
                  scriptId: '1',
                  functions: [{ functionName: 'test', ranges: [], isBlockCoverage: true }],
                },
              ],
            }),
            stopPreciseCoverage: vi.fn().mockResolvedValue(undefined),
          },
          close: vi.fn().mockResolvedValue(undefined),
        } as any
      })

      const result = await collectServerCoverageAutoDetect({ cdpPort: 9230 })

      expect(result.isDevMode).toBe(true)
      // Should have collected 1 entry
      expect(result.entries.length).toBe(1)

      consoleSpy.mockRestore()
    })

    it('should fall back to production mode when dev mode has no coverage', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const CDP = (await import('chrome-remote-interface')).default
      const { CDPClient } = await import('monocart-coverage-reports')

      // Dev port connects but returns no coverage
      let cdpCallCount = 0
      vi.mocked(CDP).mockImplementation(async (opts: { port: number }) => {
        cdpCallCount++
        if (opts.port === 9231) {
          if (cdpCallCount === 1) {
            return { close: vi.fn() } as any
          }
          // Dev mode collector
          return {
            Debugger: {
              enable: vi.fn().mockResolvedValue(undefined),
              disable: vi.fn().mockResolvedValue(undefined),
              on: vi.fn(),
            },
            Profiler: {
              enable: vi.fn().mockResolvedValue(undefined),
              startPreciseCoverage: vi.fn().mockResolvedValue(undefined),
              takePreciseCoverage: vi.fn().mockResolvedValue({ result: [] }), // No coverage
              stopPreciseCoverage: vi.fn().mockResolvedValue(undefined),
            },
            close: vi.fn().mockResolvedValue(undefined),
          } as any
        }
        // Base port check
        return { close: vi.fn() } as any
      })

      // Production mode collector
      vi.mocked(CDPClient).mockResolvedValue(createMockCoverageClient())

      const result = await collectServerCoverageAutoDetect({ cdpPort: 9230 })

      // Should fall back to production mode
      expect(result.isDevMode).toBe(false)

      consoleSpy.mockRestore()
    })

    it('should return empty when no ports are connectable', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const CDP = (await import('chrome-remote-interface')).default
      vi.mocked(CDP).mockRejectedValue(new Error('Connection refused'))

      const result = await collectServerCoverageAutoDetect({ cdpPort: 9230 })

      expect(result.entries).toEqual([])
      expect(result.isDevMode).toBe(false)

      consoleSpy.mockRestore()
    })
  })

  describe('autoDetectServerCollector (deprecated)', () => {
    it('should return dev mode collector when dev port is connectable', async () => {
      const CDP = (await import('chrome-remote-interface')).default
      vi.mocked(CDP).mockResolvedValue({ close: vi.fn() } as any)

      const result = await autoDetectServerCollector({ cdpPort: 9230 })

      expect(result).not.toBeNull()
      expect(result!.isDevMode).toBe(true)
      expect(result!.port).toBe(9231)
      expect(result!.collector).toBeInstanceOf(DevModeServerCollector)
    })

    it('should return production mode collector when only base port is connectable', async () => {
      const CDP = (await import('chrome-remote-interface')).default
      vi.mocked(CDP).mockImplementation(async (opts: { port: number }) => {
        if (opts.port === 9231) {
          throw new Error('Connection refused')
        }
        return { close: vi.fn() } as any
      })

      const result = await autoDetectServerCollector({ cdpPort: 9230 })

      expect(result).not.toBeNull()
      expect(result!.isDevMode).toBe(false)
      expect(result!.port).toBe(9230)
      expect(result!.collector).toBeInstanceOf(ServerCoverageCollector)
    })

    it('should return null when no ports are connectable', async () => {
      const CDP = (await import('chrome-remote-interface')).default
      vi.mocked(CDP).mockRejectedValue(new Error('Connection refused'))

      const result = await autoDetectServerCollector({ cdpPort: 9230 })

      expect(result).toBeNull()
    })

    it('should use custom config', async () => {
      const CDP = (await import('chrome-remote-interface')).default
      vi.mocked(CDP).mockResolvedValue({ close: vi.fn() } as any)

      const result = await autoDetectServerCollector({
        cdpPort: 9999,
        sourceRoot: 'lib',
        cacheDir: '/custom/cache',
        buildDir: '.next-custom',
      })

      expect(result).not.toBeNull()
      // Dev mode detected on port 10000 (9999 + 1)
      expect(result!.port).toBe(10000)
    })
  })

  describe('config defaults', () => {
    it('should use default sourceRoot', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const CDP = (await import('chrome-remote-interface')).default

      let callCount = 0
      vi.mocked(CDP).mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          return { close: vi.fn() } as any
        }
        return {
          Debugger: {
            enable: vi.fn().mockResolvedValue(undefined),
            disable: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
          },
          Profiler: {
            enable: vi.fn().mockResolvedValue(undefined),
            startPreciseCoverage: vi.fn().mockResolvedValue(undefined),
            takePreciseCoverage: vi.fn().mockResolvedValue({ result: [] }),
            stopPreciseCoverage: vi.fn().mockResolvedValue(undefined),
          },
          close: vi.fn().mockResolvedValue(undefined),
        } as any
      })

      await startServerCoverageAutoDetect()

      // Default sourceRoot should be 'src'
      await stopServerCoverageAutoDetect()
      consoleSpy.mockRestore()
    })

    it('should use default cacheDir for production mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const CDP = (await import('chrome-remote-interface')).default
      const { CDPClient } = await import('monocart-coverage-reports')

      vi.mocked(CDP).mockImplementation(async (opts: { port: number }) => {
        if (opts.port === 9231) {
          throw new Error('Connection refused')
        }
        return { close: vi.fn() } as any
      })

      vi.mocked(CDPClient).mockResolvedValue(createMockCoverageClient())

      await startServerCoverageAutoDetect()

      // Default cacheDir should be used
      await stopServerCoverageAutoDetect()
      consoleSpy.mockRestore()
    })
  })
})
