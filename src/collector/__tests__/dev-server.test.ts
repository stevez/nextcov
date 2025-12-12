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
}))

// Mock chrome-remote-interface
vi.mock('chrome-remote-interface', () => ({
  default: vi.fn(),
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
    it('should return false when CDP connection fails', async () => {
      const { log } = await import('../../logger.js')
      const CDP = (await import('chrome-remote-interface')).default
      vi.mocked(CDP).mockRejectedValue(new Error('Connection refused'))

      const result = await collector.connect()

      expect(result).toBe(false)
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Failed to connect'))
    })

    it('should return true when CDP connection succeeds', async () => {
      const mockDebugger = {
        enable: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      }
      const mockProfiler = {
        enable: vi.fn().mockResolvedValue(undefined),
        startPreciseCoverage: vi.fn().mockResolvedValue(undefined),
      }
      const mockClient = {
        Debugger: mockDebugger,
        Profiler: mockProfiler,
      }
      const CDP = (await import('chrome-remote-interface')).default
      vi.mocked(CDP).mockResolvedValue(mockClient as any)

      const result = await collector.connect()

      expect(result).toBe(true)
      expect(mockDebugger.enable).toHaveBeenCalled()
      expect(mockProfiler.enable).toHaveBeenCalled()
      expect(mockProfiler.startPreciseCoverage).toHaveBeenCalledWith({
        callCount: true,
        detailed: true,
      })
    })

    it('should listen for scriptParsed events', async () => {
      const mockDebugger = {
        enable: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      }
      const mockProfiler = {
        enable: vi.fn().mockResolvedValue(undefined),
        startPreciseCoverage: vi.fn().mockResolvedValue(undefined),
      }
      const mockClient = {
        Debugger: mockDebugger,
        Profiler: mockProfiler,
      }
      const CDP = (await import('chrome-remote-interface')).default
      vi.mocked(CDP).mockResolvedValue(mockClient as any)

      await collector.connect()

      expect(mockDebugger.on).toHaveBeenCalledWith('scriptParsed', expect.any(Function))
    })
  })

  describe('getProjectScripts', () => {
    it('should return empty array when no scripts', () => {
      const scripts = collector.getProjectScripts()
      expect(scripts).toEqual([])
    })

    it('should filter project scripts', async () => {
      let scriptParsedHandler: (params: { scriptId: string; url: string; sourceMapURL?: string }) => void

      const mockDebugger = {
        enable: vi.fn().mockResolvedValue(undefined),
        on: vi.fn((event: string, handler: typeof scriptParsedHandler) => {
          if (event === 'scriptParsed') {
            scriptParsedHandler = handler
          }
        }),
      }
      const mockProfiler = {
        enable: vi.fn().mockResolvedValue(undefined),
        startPreciseCoverage: vi.fn().mockResolvedValue(undefined),
      }
      const mockClient = {
        Debugger: mockDebugger,
        Profiler: mockProfiler,
      }
      const CDP = (await import('chrome-remote-interface')).default
      vi.mocked(CDP).mockResolvedValue(mockClient as any)

      await collector.connect()

      // Simulate script parsed events
      scriptParsedHandler!({ scriptId: '1', url: 'webpack-internal:///(rsc)/./src/app/page.tsx' })
      scriptParsedHandler!({ scriptId: '2', url: 'webpack-internal:///(app)/./node_modules/react.js' })
      scriptParsedHandler!({ scriptId: '3', url: 'webpack-internal:///(rsc)/./src/lib/utils.ts' })

      const scripts = collector.getProjectScripts()

      // Should only include src scripts, not node_modules
      expect(scripts.length).toBe(2)
      expect(scripts[0].url).toContain('src/app/page.tsx')
      expect(scripts[1].url).toContain('src/lib/utils.ts')
    })
  })

  describe('collect', () => {
    it('should return empty array when not connected', async () => {
      const { log } = await import('../../logger.js')

      const result = await collector.collect()

      expect(result).toEqual([])
      expect(log).toHaveBeenCalledWith(expect.stringContaining('CDP not connected'))
    })

    it('should collect coverage for project scripts', async () => {
      let scriptParsedHandler: (params: { scriptId: string; url: string; sourceMapURL?: string }) => void

      const sourceMap = {
        version: 3,
        file: 'page.tsx',
        sources: ['src/app/page.tsx'],
        sourcesContent: ['export default function Page() {}'],
        mappings: 'AAAA',
        names: [],
      }
      const base64 = Buffer.from(JSON.stringify(sourceMap)).toString('base64')
      const scriptSource = `function Page() {}//# sourceMappingURL=data:application/json,${base64}`

      const mockDebugger = {
        enable: vi.fn().mockResolvedValue(undefined),
        disable: vi.fn().mockResolvedValue(undefined),
        on: vi.fn((event: string, handler: typeof scriptParsedHandler) => {
          if (event === 'scriptParsed') {
            scriptParsedHandler = handler
          }
        }),
        getScriptSource: vi.fn().mockResolvedValue({ scriptSource }),
      }
      const mockProfiler = {
        enable: vi.fn().mockResolvedValue(undefined),
        startPreciseCoverage: vi.fn().mockResolvedValue(undefined),
        takePreciseCoverage: vi.fn().mockResolvedValue({
          result: [
            {
              scriptId: '1',
              functions: [
                {
                  functionName: 'Page',
                  ranges: [{ startOffset: 0, endOffset: 20, count: 1 }],
                  isBlockCoverage: true,
                },
              ],
            },
          ],
        }),
        stopPreciseCoverage: vi.fn().mockResolvedValue(undefined),
      }
      const mockClient = {
        Debugger: mockDebugger,
        Profiler: mockProfiler,
        close: vi.fn().mockResolvedValue(undefined),
      }
      const CDP = (await import('chrome-remote-interface')).default
      vi.mocked(CDP).mockResolvedValue(mockClient as any)

      await collector.connect()
      scriptParsedHandler!({ scriptId: '1', url: 'webpack-internal:///(rsc)/./src/app/page.tsx' })

      const result = await collector.collect()

      expect(result.length).toBe(1)
      expect(result[0].url).toContain('src/app/page.tsx')
      expect(result[0].functions.length).toBe(1)
      expect(result[0].functions[0].functionName).toBe('Page')
      expect(result[0].sourceMapData).toBeDefined()
      expect(result[0].originalPath).toBe('src/app/page.tsx')
    })

    it('should handle collection errors gracefully', async () => {
      const { log } = await import('../../logger.js')

      const mockDebugger = {
        enable: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      }
      const mockProfiler = {
        enable: vi.fn().mockResolvedValue(undefined),
        startPreciseCoverage: vi.fn().mockResolvedValue(undefined),
        takePreciseCoverage: vi.fn().mockRejectedValue(new Error('Collection failed')),
      }
      const mockClient = {
        Debugger: mockDebugger,
        Profiler: mockProfiler,
        close: vi.fn().mockResolvedValue(undefined),
      }
      const CDP = (await import('chrome-remote-interface')).default
      vi.mocked(CDP).mockResolvedValue(mockClient as any)

      await collector.connect()
      const result = await collector.collect()

      expect(result).toEqual([])
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Failed to collect'))
    })

    it('should handle getScriptSource errors for individual scripts', async () => {
      let scriptParsedHandler: (params: { scriptId: string; url: string; sourceMapURL?: string }) => void

      const mockDebugger = {
        enable: vi.fn().mockResolvedValue(undefined),
        disable: vi.fn().mockResolvedValue(undefined),
        on: vi.fn((event: string, handler: typeof scriptParsedHandler) => {
          if (event === 'scriptParsed') {
            scriptParsedHandler = handler
          }
        }),
        getScriptSource: vi.fn().mockRejectedValue(new Error('Script not found')),
      }
      const mockProfiler = {
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
      }
      const mockClient = {
        Debugger: mockDebugger,
        Profiler: mockProfiler,
        close: vi.fn().mockResolvedValue(undefined),
      }
      const CDP = (await import('chrome-remote-interface')).default
      vi.mocked(CDP).mockResolvedValue(mockClient as any)

      await collector.connect()
      scriptParsedHandler!({ scriptId: '1', url: 'webpack-internal:///(rsc)/./src/test.ts' })

      const result = await collector.collect()

      // Script with error should be filtered out
      expect(result.length).toBe(0)
    })
  })

  describe('extractScriptSourceMap', () => {
    it('should return null when not connected', async () => {
      const result = await collector.extractScriptSourceMap('1')
      expect(result).toBeNull()
    })

    it('should return null for non-existent script', async () => {
      const mockDebugger = {
        enable: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      }
      const mockProfiler = {
        enable: vi.fn().mockResolvedValue(undefined),
        startPreciseCoverage: vi.fn().mockResolvedValue(undefined),
      }
      const mockClient = {
        Debugger: mockDebugger,
        Profiler: mockProfiler,
      }
      const CDP = (await import('chrome-remote-interface')).default
      vi.mocked(CDP).mockResolvedValue(mockClient as any)

      await collector.connect()
      const result = await collector.extractScriptSourceMap('non-existent')

      expect(result).toBeNull()
    })
  })

  describe('close', () => {
    it('should close CDP connection', async () => {
      const mockDebugger = {
        enable: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      }
      const mockProfiler = {
        enable: vi.fn().mockResolvedValue(undefined),
        startPreciseCoverage: vi.fn().mockResolvedValue(undefined),
      }
      const mockClient = {
        Debugger: mockDebugger,
        Profiler: mockProfiler,
        close: vi.fn().mockResolvedValue(undefined),
      }
      const CDP = (await import('chrome-remote-interface')).default
      vi.mocked(CDP).mockResolvedValue(mockClient as any)

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
