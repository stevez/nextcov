import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CDPClient, type CDPClientInstance } from '../cdp-client.js'

// ─── MockWebSocket ─────────────────────────────────────────────────────────────

let capturedWs: MockWebSocket | null = null

class MockWebSocket extends EventTarget {
  url: string
  sent: Array<{ id: number; method: string; params: unknown }> = []
  private methodResponses = new Map<string, unknown>()

  constructor(url: string) {
    super()
    this.url = url
    capturedWs = this
  }

  /** Register a result for a specific CDP method */
  respondTo(method: string, result: unknown): this {
    this.methodResponses.set(method, result)
    return this
  }

  send(data: string) {
    const msg = JSON.parse(data) as { id: number; method: string; params: unknown }
    this.sent.push(msg)
    // Respond synchronously — WSSession listener is already registered by this point
    const result = this.methodResponses.get(msg.method) ?? null
    this.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ id: msg.id, result }),
    }))
  }

  close() {}

  triggerOpen() {
    this.dispatchEvent(new Event('open'))
  }

  triggerError() {
    this.dispatchEvent(new Event('error'))
  }

  /** Simulate a CDP server-push event (no id) */
  emitEvent(method: string, params: unknown) {
    this.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ method, params }),
    }))
  }

  getSent(method: string) {
    return this.sent.filter((m) => m.method === method)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a connected CDPClientInstance using the direct-url path (no fetch).
 * Synchronously triggers WS open so the returned client is ready to use.
 */
async function connect(): Promise<{ client: CDPClientInstance; ws: MockWebSocket }> {
  const promise = CDPClient({ url: 'ws://mock' })
  const ws = capturedWs!
  ws.triggerOpen()
  const client = await promise
  if (!client) throw new Error('Client was undefined')
  return { client, ws }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  capturedWs = null
  vi.stubGlobal('WebSocket', MockWebSocket)
  vi.stubGlobal('fetch', vi.fn())
})

// ─── CDPClient factory ────────────────────────────────────────────────────────

describe('CDPClient', () => {
  describe('fetch-based target discovery', () => {
    it('returns undefined when fetch throws', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'))
      const client = await CDPClient({ port: 9222 })
      expect(client).toBeUndefined()
    })

    it('returns undefined when targets is not an array', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({ error: 'not an array' }),
      } as unknown as Response)
      const client = await CDPClient({ port: 9222 })
      expect(client).toBeUndefined()
    })

    it('returns undefined when targets array is empty', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve([]),
      } as unknown as Response)
      const client = await CDPClient({ port: 9222 })
      expect(client).toBeUndefined()
    })

    it('returns undefined when no target has a webSocketDebuggerUrl', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve([{ type: 'page' }, { type: 'node' }]),
      } as unknown as Response)
      const client = await CDPClient({ port: 9222 })
      expect(client).toBeUndefined()
    })

    it('uses correct host and port in the fetch URL', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve([]),
      } as unknown as Response)
      await CDPClient({ host: 'myhost', port: 1234 })
      expect(fetch).toHaveBeenCalledWith('http://myhost:1234/json/list')
    })

    it('prefers page target over other types', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve([
          { webSocketDebuggerUrl: 'ws://node-target', type: 'node' },
          { webSocketDebuggerUrl: 'ws://page-target', type: 'page' },
        ]),
      } as unknown as Response)
      const promise = CDPClient({ port: 9222 })
      await Promise.resolve()  // tick: fetch resolves
      await Promise.resolve()  // tick: json() resolves
      capturedWs?.triggerOpen()
      await promise
      expect(capturedWs?.url).toBe('ws://page-target')
    })

    it('falls back to first target with webSocketDebuggerUrl when no page type', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve([
          { webSocketDebuggerUrl: 'ws://node-target', type: 'node' },
        ]),
      } as unknown as Response)
      const promise = CDPClient({ port: 9222 })
      await Promise.resolve()
      await Promise.resolve()
      capturedWs?.triggerOpen()
      await promise
      expect(capturedWs?.url).toBe('ws://node-target')
    })
  })

  describe('direct URL option', () => {
    it('skips fetch and uses provided URL directly', async () => {
      const promise = CDPClient({ url: 'ws://direct' })
      capturedWs!.triggerOpen()
      await promise
      expect(fetch).not.toHaveBeenCalled()
      expect(capturedWs?.url).toBe('ws://direct')
    })

    it('returns a CDPClientInstance on successful connection', async () => {
      const { client } = await connect()
      expect(client).toBeDefined()
      expect(typeof client.startJSCoverage).toBe('function')
      expect(typeof client.stopJSCoverage).toBe('function')
      expect(typeof client.close).toBe('function')
    })

    it('returns undefined when WebSocket emits error', async () => {
      const promise = CDPClient({ url: 'ws://mock' })
      capturedWs!.triggerError()
      const client = await promise
      expect(client).toBeUndefined()
    })

    it('returns undefined when timeout elapses before open', async () => {
      vi.useFakeTimers()
      const promise = CDPClient({ url: 'ws://mock', timeout: 100 })
      vi.advanceTimersByTime(200)
      const client = await promise
      expect(client).toBeUndefined()
      vi.useRealTimers()
    })
  })
})

// ─── CoverageClient.startJSCoverage ───────────────────────────────────────────

describe('CoverageClient.startJSCoverage', () => {
  it('sends correct sequence of CDP commands', async () => {
    const { client, ws } = await connect()
    await client.startJSCoverage()

    const methods = ws.sent.map((m) => m.method)
    expect(methods).toContain('Debugger.enable')
    expect(methods).toContain('Debugger.setSkipAllPauses')
    expect(methods).toContain('Profiler.enable')
    expect(methods).toContain('Profiler.startPreciseCoverage')
  })

  it('sends startPreciseCoverage with callCount and detailed flags', async () => {
    const { client, ws } = await connect()
    await client.startJSCoverage()

    const cmd = ws.getSent('Profiler.startPreciseCoverage')[0]
    expect(cmd.params).toMatchObject({ callCount: true, detailed: true })
  })

  it('is idempotent — second call is a no-op', async () => {
    const { client, ws } = await connect()
    await client.startJSCoverage()
    const countAfterFirst = ws.sent.length
    await client.startJSCoverage()
    expect(ws.sent.length).toBe(countAfterFirst)
  })
})

// ─── CoverageClient.stopJSCoverage ────────────────────────────────────────────

describe('CoverageClient.stopJSCoverage', () => {
  it('returns empty array when coverage was not started', async () => {
    const { client } = await connect()
    const entries = await client.stopJSCoverage()
    expect(entries).toEqual([])
  })

  it('returns coverage entries with sources from scriptSources map', async () => {
    const { client, ws } = await connect()

    ws.respondTo('Profiler.takePreciseCoverage', {
      result: [
        {
          scriptId: 'abc',
          url: 'file:///project/src/foo.ts',
          functions: [{ functionName: 'foo', ranges: [{ startOffset: 0, endOffset: 10, count: 1 }], isBlockCoverage: true }],
        },
      ],
    })
    ws.respondTo('Debugger.getScriptSource', { scriptSource: 'function foo() {}' })

    await client.startJSCoverage()
    // Simulate the server notifying us about a parsed script
    ws.emitEvent('Debugger.scriptParsed', { scriptId: 'abc' })
    // Allow the getScriptSource request/response to complete
    await Promise.resolve()
    await Promise.resolve()

    const entries = await client.stopJSCoverage()

    expect(entries).toHaveLength(1)
    expect(entries[0].scriptId).toBe('abc')
    expect(entries[0].url).toBe('file:///project/src/foo.ts')
    expect(entries[0].source).toBe('function foo() {}')
    expect(entries[0].functions).toHaveLength(1)
  })

  it('falls back to empty string when getScriptSource fails', async () => {
    const { client, ws } = await connect()

    ws.respondTo('Profiler.takePreciseCoverage', {
      result: [{ scriptId: 'xyz', url: 'file:///foo.js', functions: [] }],
    })
    // Override send to throw for getScriptSource
    const originalSend = ws.send.bind(ws)
    ws.send = (data: string) => {
      const msg = JSON.parse(data) as { method: string; id: number }
      if (msg.method === 'Debugger.getScriptSource') {
        ws.dispatchEvent(new MessageEvent('message', {
          data: JSON.stringify({ id: msg.id, error: { message: 'Script not found' } }),
        }))
        return
      }
      originalSend(data)
    }

    await client.startJSCoverage()
    ws.emitEvent('Debugger.scriptParsed', { scriptId: 'xyz' })
    await Promise.resolve()
    await Promise.resolve()

    const entries = await client.stopJSCoverage()
    expect(entries[0].source).toBe('')
  })

  it('uses empty string for entries with no matching scriptSource', async () => {
    const { client, ws } = await connect()

    ws.respondTo('Profiler.takePreciseCoverage', {
      result: [{ scriptId: 'unknown', url: 'file:///bar.js', functions: [] }],
    })

    await client.startJSCoverage()
    // No scriptParsed event fired for 'unknown', so no source stored
    const entries = await client.stopJSCoverage()
    expect(entries[0].source).toBe('')
  })

  it('sends Profiler.stopPreciseCoverage and Profiler.disable', async () => {
    const { client, ws } = await connect()
    ws.respondTo('Profiler.takePreciseCoverage', { result: [] })

    await client.startJSCoverage()
    await client.stopJSCoverage()

    expect(ws.getSent('Profiler.stopPreciseCoverage')).toHaveLength(1)
    expect(ws.getSent('Profiler.disable')).toHaveLength(1)
  })

  it('can be started and stopped again after a first cycle', async () => {
    const { client, ws } = await connect()
    ws.respondTo('Profiler.takePreciseCoverage', { result: [] })

    await client.startJSCoverage()
    await client.stopJSCoverage()

    // Second cycle
    ws.sent = []
    await client.startJSCoverage()
    await client.stopJSCoverage()

    expect(ws.getSent('Profiler.startPreciseCoverage')).toHaveLength(1)
    expect(ws.getSent('Profiler.stopPreciseCoverage')).toHaveLength(1)
  })
})

// ─── CoverageClient.close ─────────────────────────────────────────────────────

describe('CoverageClient.close', () => {
  it('calls ws.close() via session detach', async () => {
    const { client, ws } = await connect()
    const closeSpy = vi.spyOn(ws, 'close')
    await client.close()
    expect(closeSpy).toHaveBeenCalled()
  })

  it('is safe to call multiple times', async () => {
    const { client } = await connect()
    await client.close()
    await expect(client.close()).resolves.toBeUndefined()
  })

  it('makes stopJSCoverage return [] after close', async () => {
    const { client } = await connect()
    await client.close()
    const entries = await client.stopJSCoverage()
    expect(entries).toEqual([])
  })
})

// ─── CoverageClient.writeCoverage ─────────────────────────────────────────────

describe('CoverageClient.writeCoverage', () => {
  it('sends Runtime.enable and Runtime.evaluate', async () => {
    const { client, ws } = await connect()
    ws.respondTo('Runtime.evaluate', { result: { value: '/tmp/v8' } })

    await client.writeCoverage()

    expect(ws.getSent('Runtime.enable')).toHaveLength(1)
    expect(ws.getSent('Runtime.evaluate')).toHaveLength(1)
    expect(ws.getSent('Runtime.disable')).toHaveLength(1)
  })

  it('returns the coverage directory from the evaluate result', async () => {
    const { client, ws } = await connect()
    ws.respondTo('Runtime.evaluate', { result: { value: '/tmp/v8-cov' } })

    const dir = await client.writeCoverage()
    expect(dir).toBe('/tmp/v8-cov')
  })

  it('returns undefined after close', async () => {
    const { client } = await connect()
    await client.close()
    const dir = await client.writeCoverage()
    expect(dir).toBeUndefined()
  })
})

// ─── CoverageClient.getIstanbulCoverage ───────────────────────────────────────

describe('CoverageClient.getIstanbulCoverage', () => {
  it('sends Runtime.evaluate and returns the coverage object', async () => {
    const { client, ws } = await connect()
    const mockCoverage = { 'src/foo.ts': { s: { 0: 1 } } }
    ws.respondTo('Runtime.evaluate', { result: { value: mockCoverage } })

    const coverage = await client.getIstanbulCoverage()
    expect(coverage).toEqual(mockCoverage)
  })

  it('uses the default __coverage__ key', async () => {
    const { client, ws } = await connect()
    ws.respondTo('Runtime.evaluate', { result: { value: {} } })

    await client.getIstanbulCoverage()

    const cmd = ws.getSent('Runtime.evaluate')[0]
    expect(JSON.stringify(cmd.params)).toContain('__coverage__')
  })

  it('uses a custom coverage key when provided', async () => {
    const { client, ws } = await connect()
    ws.respondTo('Runtime.evaluate', { result: { value: {} } })

    await client.getIstanbulCoverage('__myCoverage__')

    const cmd = ws.getSent('Runtime.evaluate')[0]
    expect(JSON.stringify(cmd.params)).toContain('__myCoverage__')
  })

  it('returns undefined after close', async () => {
    const { client } = await connect()
    await client.close()
    const coverage = await client.getIstanbulCoverage()
    expect(coverage).toBeUndefined()
  })
})

// ─── CoverageClient.startCoverage / stopCoverage ──────────────────────────────

describe('CoverageClient.startCoverage / stopCoverage', () => {
  it('startCoverage delegates to startJSCoverage', async () => {
    const { client, ws } = await connect()
    await client.startCoverage()
    expect(ws.getSent('Profiler.startPreciseCoverage')).toHaveLength(1)
  })

  it('stopCoverage delegates to stopJSCoverage', async () => {
    const { client, ws } = await connect()
    ws.respondTo('Profiler.takePreciseCoverage', { result: [] })
    await client.startCoverage()
    const entries = await client.stopCoverage()
    expect(Array.isArray(entries)).toBe(true)
  })
})

// ─── CoverageClient.startCSSCoverage / stopCSSCoverage ───────────────────────

describe('CoverageClient.startCSSCoverage / stopCSSCoverage', () => {
  it('startCSSCoverage is a no-op', async () => {
    const { client } = await connect()
    await expect(client.startCSSCoverage()).resolves.toBeUndefined()
  })

  it('stopCSSCoverage returns an empty array', async () => {
    const { client } = await connect()
    await expect(client.stopCSSCoverage()).resolves.toEqual([])
  })
})
