/**
 * Worker thread for parallel astV8ToIstanbul processing
 *
 * This worker handles CPU-intensive AST processing in a separate thread,
 * allowing the main thread to process multiple large bundles in parallel.
 */
import { parentPort, workerData } from 'node:worker_threads'
import astV8ToIstanbul from 'ast-v8-to-istanbul'
import { parseAstAsync } from 'vite'
import type { Node } from 'estree'

export interface WorkerInput {
  code: string
  sourceMap: {
    sources: string[]
    sourcesContent: (string | null)[]
    mappings: string
    names?: string[]
    version?: number
    file?: string
    sourceRoot?: string
  } | null
  coverageUrl: string
  functions: Array<{
    functionName: string
    isBlockCoverage: boolean
    ranges: Array<{
      startOffset: number
      endOffset: number
      count: number
    }>
  }>
  srcCodeRange: { minOffset: number; maxOffset: number } | null
}

export interface WorkerOutput {
  success: boolean
  coverage?: Record<string, unknown>
  error?: string
  timings?: {
    parse: number
    convert: number
    total: number
  }
}

// Exported for testing
export async function processEntry(input: WorkerInput): Promise<WorkerOutput> {
  const startTotal = performance.now()
  const timings = { parse: 0, convert: 0, total: 0 }

  try {
    // Parse AST
    const startParse = performance.now()
    const ast = await parseAstAsync(input.code)
    timings.parse = performance.now() - startParse

    // Convert using ast-v8-to-istanbul
    const startConvert = performance.now()

    // Transform sourceMap to match expected type (with required names and version)
    const sourceMapForAst = input.sourceMap ? {
      ...input.sourceMap,
      names: input.sourceMap.names || [],
      version: input.sourceMap.version || 3,
    } : undefined

    const istanbulCoverage = await astV8ToIstanbul({
      code: input.code,
      ast,
      sourceMap: sourceMapForAst,
      coverage: {
        url: input.coverageUrl,
        functions: input.functions,
      },
      wrapperLength: 0,
      ignoreClassMethods: [],
      ignoreNode: (node: Node) => {
        // For large bundles, skip nodes outside the src code range
        const nodeAny = node as Node & { start?: number; end?: number }
        if (
          input.srcCodeRange &&
          typeof nodeAny.start === 'number' &&
          typeof nodeAny.end === 'number'
        ) {
          if (
            nodeAny.end < input.srcCodeRange.minOffset ||
            nodeAny.start > input.srcCodeRange.maxOffset
          ) {
            return 'ignore-this-and-nested-nodes'
          }
        }
        return false
      },
    })
    timings.convert = performance.now() - startConvert
    timings.total = performance.now() - startTotal

    return {
      success: true,
      coverage: istanbulCoverage as Record<string, unknown>,
      timings,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      timings: { ...timings, total: performance.now() - startTotal },
    }
  }
}

// Handle messages from main thread
if (parentPort) {
  parentPort.on('message', async (input: WorkerInput) => {
    const result = await processEntry(input)
    parentPort!.postMessage(result)
  })
}

// Also support direct invocation for workerData pattern
if (workerData) {
  processEntry(workerData as WorkerInput).then((result) => {
    if (parentPort) {
      parentPort.postMessage(result)
    }
  })
}
