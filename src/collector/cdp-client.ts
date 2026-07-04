/**
 * CDP Client
 *
 * Lightweight Chrome DevTools Protocol client for JS coverage collection.
 * Ported from monocart-coverage-reports (MIT) to remove the large dependency.
 *
 * Requires Node.js >= 22 for native WebSocket support.
 */

import { EventEmitter } from 'node:events'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface JSCoverageEntry {
  scriptId: string
  url: string
  source: string
  functions: Array<{
    functionName: string
    ranges: Array<{ startOffset: number; endOffset: number; count: number }>
    isBlockCoverage: boolean
  }>
}

export interface CDPClientInstance {
  startJSCoverage(): Promise<void>
  stopJSCoverage(): Promise<JSCoverageEntry[]>
  writeCoverage(): Promise<string | undefined>
  getIstanbulCoverage(coverageKey?: string): Promise<unknown>
  startCSSCoverage(): Promise<void>
  stopCSSCoverage(): Promise<unknown[]>
  startCoverage(): Promise<void>
  stopCoverage(): Promise<unknown[]>
  close(): Promise<void>
}

// ─── WSSession ───────────────────────────────────────────────────────────────

class WSSession extends EventEmitter {
  private ws: WebSocket | null
  private requestId = 1
  private requestCache = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>()

  constructor(ws: WebSocket) {
    super()
    this.ws = ws

    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data as string) as {
        id?: number
        method?: string
        params?: unknown
        result?: unknown
        sessionId?: string
      }

      if (message.id !== undefined) {
        const request = this.requestCache.get(message.id)
        this.requestCache.delete(message.id)
        if (request) {
          request.resolve(message.result)
        }
        return
      }

      if (message.method) {
        this.emit(message.method, message.params, message.sessionId)
      }
    })
  }

  send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('Invalid websocket'))
        return
      }
      const id = this.requestId++
      const message = JSON.stringify({ id, method, params: params ?? {} })
      this.requestCache.set(id, { resolve, reject })
      try {
        this.ws.send(message)
      } catch (err) {
        this.requestCache.delete(id)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  detach(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}

// ─── CoverageClient ──────────────────────────────────────────────────────────

class CoverageClient implements CDPClientInstance {
  private session: WSSession | null
  private enabledJS = false
  private scriptSources = new Map<string, string>()
  private jsEventHandlers: {
    'Debugger.scriptParsed': (params: unknown) => void
    'Debugger.paused': () => void
  } | null = null

  constructor(session: WSSession) {
    this.session = session
  }

  async startJSCoverage(): Promise<void> {
    if (!this.session || this.enabledJS) return

    this.enabledJS = true
    this.scriptSources = new Map()

    this.jsEventHandlers = {
      'Debugger.scriptParsed': (params) => {
        const { scriptId } = params as { scriptId: string }
        this.session!.send('Debugger.getScriptSource', { scriptId }).then((res) => {
          const result = res as { scriptSource?: string } | null
          this.scriptSources.set(scriptId, result?.scriptSource ?? '')
        }).catch(() => {
          this.scriptSources.set(scriptId, '')
        })
      },
      'Debugger.paused': () => {
        this.session!.send('Debugger.resume').catch(() => {})
      },
    }

    for (const [event, handler] of Object.entries(this.jsEventHandlers)) {
      this.session.on(event, handler)
    }

    await this.session.send('Debugger.enable')
    await this.session.send('Debugger.setSkipAllPauses', { skip: true })
    await this.session.send('Profiler.enable')
    await this.session.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
  }

  async stopJSCoverage(): Promise<JSCoverageEntry[]> {
    if (!this.session || !this.enabledJS) return []

    const profileResponse = await this.session.send('Profiler.takePreciseCoverage') as {
      result?: Array<{
        scriptId: string
        url: string
        functions: JSCoverageEntry['functions']
      }>
    } | null

    await this.session.send('Profiler.stopPreciseCoverage')
    await this.session.send('Profiler.disable')

    if (this.jsEventHandlers) {
      for (const [event, handler] of Object.entries(this.jsEventHandlers)) {
        this.session.off(event, handler)
      }
      this.jsEventHandlers = null
    }

    const jsCoverage: JSCoverageEntry[] = []

    if (profileResponse?.result) {
      for (const entry of profileResponse.result) {
        jsCoverage.push({
          scriptId: entry.scriptId,
          url: entry.url ?? '',
          source: this.scriptSources.get(entry.scriptId) ?? '',
          functions: entry.functions,
        })
      }
    }

    this.scriptSources.clear()
    this.enabledJS = false

    return jsCoverage
  }

  async startCSSCoverage(): Promise<void> {
    // Not used by nextcov — included to satisfy CDPClientInstance interface
  }

  async stopCSSCoverage(): Promise<unknown[]> {
    return []
  }

  async startCoverage(): Promise<void> {
    await this.startJSCoverage()
  }

  async stopCoverage(): Promise<unknown[]> {
    return this.stopJSCoverage()
  }

  async writeCoverage(): Promise<string | undefined> {
    if (!this.session) return undefined

    await this.session.send('Runtime.enable')

    const res = await this.session.send('Runtime.evaluate', {
      expression: `new Promise((resolve) => {
        require("v8").takeCoverage();
        resolve(process.env.NODE_V8_COVERAGE);
      })`,
      includeCommandLineAPI: true,
      returnByValue: true,
      awaitPromise: true,
    }) as { result?: { value?: string } } | null

    await this.session.send('Runtime.disable')

    return res?.result?.value
  }

  async getIstanbulCoverage(coverageKey = '__coverage__'): Promise<unknown> {
    if (!this.session) return undefined

    await this.session.send('Runtime.enable')

    const res = await this.session.send('Runtime.evaluate', {
      expression: `new Promise((resolve) => {
        const globalTarget = typeof window !== 'undefined' ? window : global;
        resolve(globalTarget['${coverageKey}']);
      })`,
      includeCommandLineAPI: true,
      returnByValue: true,
      awaitPromise: true,
    }) as { result?: { value?: unknown } } | null

    await this.session.send('Runtime.disable')

    return res?.result?.value
  }

  async close(): Promise<void> {
    if (!this.session) return
    this.session.detach()
    this.session = null
  }
}

// ─── CDPClient factory ───────────────────────────────────────────────────────

export interface CDPClientOptions {
  port?: number
  host?: string
  url?: string
  timeout?: number
}

/**
 * Connect to the Chrome DevTools Protocol and return a CoverageClient.
 * Returns undefined if the connection fails (matching monocart's behavior).
 */
export async function CDPClient(options: CDPClientOptions): Promise<CDPClientInstance | undefined> {
  const host = options.host ?? 'localhost'
  const port = options.port ?? 9222
  const timeout = options.timeout ?? 10_000

  let wsUrl: string

  if (options.url) {
    wsUrl = options.url
  } else {
    // Fetch the debugger URL from /json/list
    let targets: Array<{ webSocketDebuggerUrl?: string; type?: string }>
    try {
      const res = await fetch(`http://${host}:${port}/json/list`)
      targets = await res.json() as typeof targets
    } catch {
      return undefined
    }

    if (!Array.isArray(targets) || targets.length === 0) return undefined

    const target =
      targets.find((t) => t.webSocketDebuggerUrl && t.type === 'page') ??
      targets.find((t) => t.webSocketDebuggerUrl)

    if (!target?.webSocketDebuggerUrl) return undefined
    wsUrl = target.webSocketDebuggerUrl
  }

  // Connect via WebSocket (native, available in Node >= 22)
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      resolve(undefined)
    }, timeout)

    let ws: WebSocket
    try {
      ws = new WebSocket(wsUrl)
    } catch {
      clearTimeout(timeoutId)
      resolve(undefined)
      return
    }

    ws.addEventListener('error', () => {
      clearTimeout(timeoutId)
      resolve(undefined)
    })

    ws.addEventListener('open', () => {
      clearTimeout(timeoutId)
      const session = new WSSession(ws)
      resolve(new CoverageClient(session))
    })
  })
}
