declare module '@bcoe/v8-coverage' {
  export interface V8Coverage {
    result: V8ScriptCoverage[]
    'source-map-cache'?: Record<string, unknown>
  }

  export interface V8ScriptCoverage {
    scriptId: string
    url: string
    functions: V8FunctionCoverage[]
    source?: string
  }

  export interface V8FunctionCoverage {
    functionName: string
    ranges: V8CoverageRange[]
    isBlockCoverage: boolean
  }

  export interface V8CoverageRange {
    startOffset: number
    endOffset: number
    count: number
  }

  export function mergeProcessCovs(coverages: V8Coverage[]): V8Coverage
  export function mergeScriptCovs(scripts: V8ScriptCoverage[]): V8ScriptCoverage | undefined
}
