/**
 * Type declarations for chrome-remote-interface
 *
 * This is a minimal type definition for the parts we use.
 * Full types are available via @types/chrome-remote-interface if needed.
 */

declare module 'chrome-remote-interface' {
  interface CDPOptions {
    port?: number
    host?: string
  }

  interface DebuggerDomain {
    enable(): Promise<void>
    disable(): Promise<void>
    getScriptSource(params: { scriptId: string }): Promise<{ scriptSource: string }>
    on(
      event: 'scriptParsed',
      handler: (params: {
        scriptId: string
        url: string
        sourceMapURL?: string
        startLine?: number
        startColumn?: number
        endLine?: number
        endColumn?: number
      }) => void
    ): void
  }

  interface ProfilerDomain {
    enable(): Promise<void>
    disable(): Promise<void>
    startPreciseCoverage(params: {
      callCount?: boolean
      detailed?: boolean
    }): Promise<void>
    stopPreciseCoverage(): Promise<void>
    takePreciseCoverage(): Promise<{
      result: Array<{
        scriptId: string
        url: string
        functions: Array<{
          functionName: string
          ranges: Array<{
            startOffset: number
            endOffset: number
            count: number
          }>
          isBlockCoverage: boolean
        }>
      }>
    }>
  }

  interface RuntimeDomain {
    enable(): Promise<void>
    disable(): Promise<void>
  }

  interface CDPClient {
    Debugger: DebuggerDomain
    Profiler: ProfilerDomain
    Runtime: RuntimeDomain
    close(): Promise<void>
  }

  function CDP(options?: CDPOptions): Promise<CDPClient>

  export default CDP
}
