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


/** A byte range in the bundle code */
export interface CodeRange {
  minOffset: number
  maxOffset: number
}

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
  /** @deprecated Use srcCodeRanges instead */
  srcCodeRange: CodeRange | null
  /** Multiple byte ranges containing user source code (for precise filtering) */
  srcCodeRanges?: CodeRange[]
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
  filterStats?: {
    original: number
    filtered: number
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

    // Build the list of code ranges to check against
    // Prefer srcCodeRanges (multiple precise ranges) over srcCodeRange (single min-max)
    const codeRanges: CodeRange[] = input.srcCodeRanges ||
      (input.srcCodeRange ? [input.srcCodeRange] : [])

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
      // Skip nodes outside all source code ranges
      ignoreNode: (node: Node) => {
        const nodeAny = node as Node & { start?: number; end?: number }
        const nodeStart = nodeAny.start
        const nodeEnd = nodeAny.end
        if (
          codeRanges.length > 0 &&
          typeof nodeStart === 'number' &&
          typeof nodeEnd === 'number'
        ) {
          // Check if node overlaps with ANY of the code ranges
          const overlapsWithUserCode = codeRanges.some(range =>
            // Node overlaps if it's not completely outside the range
            !(nodeEnd < range.minOffset || nodeStart > range.maxOffset)
          )
          if (!overlapsWithUserCode) {
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
