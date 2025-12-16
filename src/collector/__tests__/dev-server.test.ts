// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DevModeServerCollector,
  createDevModeServerCollector,
} from '../dev-server.js'

// Mock the logger module
vi.mock('../../logger.js', () => ({
  log: vi.fn(),
  setLogging: vi.fn(),
  isLoggingEnabled: vi.fn().mockReturnValue(false),
  warn: vi.fn(),
  error: vi.fn(),
  safeClose: vi.fn(),
}))

// Mock monocart-coverage-reports CDPClient
vi.mock('monocart-coverage-reports', () => ({
  CDPClient: vi.fn(),
}))

describe('DevModeServerCollector', () => {
  let collector: DevModeServerCollector

  beforeEach(() => {
    collector = new DevModeServerCollector()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should use default config', () => {
      const col = new DevModeServerCollector()
      expect(col['config'].cdpPort).toBe(9231)
      expect(col['config'].sourceRoot).toBe('src')
    })

    it('should use custom CDP port', () => {
      const col = new DevModeServerCollector({ cdpPort: 9999 })
      expect(col['config'].cdpPort).toBe(9999)
    })

    it('should use custom source root', () => {
      const col = new DevModeServerCollector({ sourceRoot: 'lib' })
      expect(col['config'].sourceRoot).toBe('lib')
    })

    it('should merge partial config with defaults', () => {
      const col = new DevModeServerCollector({ cdpPort: 9232 })
      expect(col['config'].cdpPort).toBe(9232)
      expect(col['config'].sourceRoot).toBe('src')
    })
  })

  describe('connect', () => {
    it('should return false when CDPClient returns null', async () => {
      const { log } = await import('../../logger.js')
      const { CDPClient } = await import('monocart-coverage-reports')
      vi.mocked(CDPClient).mockResolvedValue(null)

      const result = await collector.connect()

      expect(result).toBe(false)
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Failed to create CDP client'))
    })

    it('should return false when CDPClient throws', async () => {
      const { log } = await import('../../logger.js')
      const { CDPClient } = await import('monocart-coverage-reports')
      vi.mocked(CDPClient).mockRejectedValue(new Error('Connection refused'))

      const result = await collector.connect()

      expect(result).toBe(false)
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Failed to connect'))
    })

    it('should return true when CDPClient connects successfully', async () => {
      const mockClient = {
        startJSCoverage: vi.fn().mockResolvedValue(undefined),
        stopJSCoverage: vi.fn().mockResolvedValue([]),
        close: vi.fn().mockResolvedValue(undefined),
      }
      const { CDPClient } = await import('monocart-coverage-reports')
      vi.mocked(CDPClient).mockResolvedValue(mockClient as any)

      const result = await collector.connect()

      expect(result).toBe(true)
      expect(mockClient.startJSCoverage).toHaveBeenCalled()
    })
  })

  describe('collect', () => {
    it('should return empty array when not connected', async () => {
      const { log } = await import('../../logger.js')

      const result = await collector.collect()

      expect(result).toEqual([])
      expect(log).toHaveBeenCalledWith(expect.stringContaining('CDP not connected'))
    })

    it('should return empty array when stopJSCoverage returns null', async () => {
      const { log } = await import('../../logger.js')
      const mockClient = {
        startJSCoverage: vi.fn().mockResolvedValue(undefined),
        stopJSCoverage: vi.fn().mockResolvedValue(null),
        close: vi.fn().mockResolvedValue(undefined),
      }
      const { CDPClient } = await import('monocart-coverage-reports')
      vi.mocked(CDPClient).mockResolvedValue(mockClient as any)

      await collector.connect()
      const result = await collector.collect()

      expect(result).toEqual([])
      expect(log).toHaveBeenCalledWith(expect.stringContaining('No coverage entries returned'))
    })

    it('should collect coverage for project scripts', async () => {
      const sourceMap = {
        version: 3,
        file: 'page.tsx',
        sources: ['src/app/page.tsx'],
        sourcesContent: ['export default function Page() {}'],
        mappings: 'AAAA',
        names: [],
      }
      const base64 = Buffer.from(JSON.stringify(sourceMap)).toString('base64')
      const scriptSource = `function Page() {}//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64}`

      const mockClient = {
        startJSCoverage: vi.fn().mockResolvedValue(undefined),
        stopJSCoverage: vi.fn().mockResolvedValue([
          {
            scriptId: '1',
            url: 'webpack-internal:///(rsc)/./src/app/page.tsx',
            source: scriptSource,
            functions: [
              {
                functionName: 'Page',
                ranges: [{ startOffset: 0, endOffset: 20, count: 1 }],
                isBlockCoverage: true,
              },
            ],
          },
          // Non-project script should be filtered out
          {
            scriptId: '2',
            url: 'node:internal/modules/cjs/loader',
            source: 'module.exports = {}',
            functions: [],
          },
        ]),
        close: vi.fn().mockResolvedValue(undefined),
      }
      const { CDPClient } = await import('monocart-coverage-reports')
      vi.mocked(CDPClient).mockResolvedValue(mockClient as any)

      await collector.connect()
      const result = await collector.collect()

      expect(result.length).toBe(1)
      expect(result[0].url).toContain('src/app/page.tsx')
      expect(result[0].functions.length).toBe(1)
      expect(result[0].functions[0].functionName).toBe('Page')
      expect(result[0].sourceMapData).toBeDefined()
      expect(result[0].originalPath).toBe('src/app/page.tsx')
    })

    it('should handle scripts without source maps', async () => {
      const mockClient = {
        startJSCoverage: vi.fn().mockResolvedValue(undefined),
        stopJSCoverage: vi.fn().mockResolvedValue([
          {
            scriptId: '1',
            url: 'webpack-internal:///(rsc)/./src/app/page.tsx',
            source: 'function Page() {}', // No source map
            functions: [
              {
                functionName: 'Page',
                ranges: [{ startOffset: 0, endOffset: 20, count: 1 }],
                isBlockCoverage: true,
              },
            ],
          },
        ]),
        close: vi.fn().mockResolvedValue(undefined),
      }
      const { CDPClient } = await import('monocart-coverage-reports')
      vi.mocked(CDPClient).mockResolvedValue(mockClient as any)

      await collector.connect()
      const result = await collector.collect()

      expect(result.length).toBe(1)
      expect(result[0].sourceMapData).toBeUndefined()
      expect(result[0].originalPath).toBeUndefined()
    })

    it('should handle collection errors gracefully', async () => {
      const { log } = await import('../../logger.js')

      const mockClient = {
        startJSCoverage: vi.fn().mockResolvedValue(undefined),
        stopJSCoverage: vi.fn().mockRejectedValue(new Error('Collection failed')),
        close: vi.fn().mockResolvedValue(undefined),
      }
      const { CDPClient } = await import('monocart-coverage-reports')
      vi.mocked(CDPClient).mockResolvedValue(mockClient as any)

      await collector.connect()
      const result = await collector.collect()

      expect(result).toEqual([])
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Failed to collect'))
    })

    it('should close client in finally block even on error', async () => {
      const mockClient = {
        startJSCoverage: vi.fn().mockResolvedValue(undefined),
        stopJSCoverage: vi.fn().mockRejectedValue(new Error('Collection failed')),
        close: vi.fn().mockResolvedValue(undefined),
      }
      const { CDPClient } = await import('monocart-coverage-reports')
      vi.mocked(CDPClient).mockResolvedValue(mockClient as any)

      const { safeClose } = await import('../../logger.js')

      await collector.connect()
      await collector.collect()

      // Verify safeClose was called with the client
      expect(safeClose).toHaveBeenCalledWith(mockClient)
      expect(collector['client']).toBeNull()
    })
  })

  describe('isDevModeProcess', () => {
    it('should return true (always assumes dev mode)', () => {
      expect(collector.isDevModeProcess()).toBe(true)
    })
  })

  describe('waitForWebpackScripts', () => {
    it('should return true immediately (no-op in new implementation)', async () => {
      const result = await collector.waitForWebpackScripts()
      expect(result).toBe(true)
    })
  })

  describe('close', () => {
    it('should close CDP connection', async () => {
      const mockClient = {
        startJSCoverage: vi.fn().mockResolvedValue(undefined),
        stopJSCoverage: vi.fn().mockResolvedValue([]),
        close: vi.fn().mockResolvedValue(undefined),
      }
      const { CDPClient } = await import('monocart-coverage-reports')
      vi.mocked(CDPClient).mockResolvedValue(mockClient as any)

      await collector.connect()
      await collector.close()

      expect(mockClient.close).toHaveBeenCalled()
      expect(collector['client']).toBeNull()
    })

    it('should handle close when not connected', async () => {
      // Should not throw
      await collector.close()
      expect(collector['client']).toBeNull()
    })
  })

  describe('disconnect', () => {
    it('should be an alias for close', async () => {
      const mockClient = {
        startJSCoverage: vi.fn().mockResolvedValue(undefined),
        stopJSCoverage: vi.fn().mockResolvedValue([]),
        close: vi.fn().mockResolvedValue(undefined),
      }
      const { CDPClient } = await import('monocart-coverage-reports')
      vi.mocked(CDPClient).mockResolvedValue(mockClient as any)

      await collector.connect()
      await collector.disconnect()

      expect(mockClient.close).toHaveBeenCalled()
      expect(collector['client']).toBeNull()
    })
  })
})

describe('createDevModeServerCollector', () => {
  it('should create collector with default config', () => {
    const col = createDevModeServerCollector()
    expect(col).toBeInstanceOf(DevModeServerCollector)
    expect(col['config'].cdpPort).toBe(9231)
  })

  it('should create collector with custom config', () => {
    const col = createDevModeServerCollector({ cdpPort: 9999, sourceRoot: 'lib' })
    expect(col['config'].cdpPort).toBe(9999)
    expect(col['config'].sourceRoot).toBe('lib')
  })
})
