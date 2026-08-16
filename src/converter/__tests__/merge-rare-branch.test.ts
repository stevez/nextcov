import { describe, it, expect } from 'vitest'
import { mergeV8CoverageByUrl } from '../merge.js'
import type { V8ScriptCoverage } from '@/types.js'

// ─── helpers ────────────────────────────────────────────────────────────────

interface FnSpec {
  name: string
  startOffset: number
  endOffset: number
  ranges: number[] // block counts, one per V8 range
}

/**
 * Build a V8 script entry from a list of function specs. Each function's
 * `startOffset` acts as its stable identity across entries (same source
 * function, same compiled bundle → same startOffset). The array-position of
 * a function inside `functions[]` is NOT stable in V8's output: it depends
 * on discovery order at test-run time.
 */
function makeEntry(url: string, fns: FnSpec[]): V8ScriptCoverage {
  return {
    scriptId: 'x',
    url,
    source: 'placeholder',
    functions: fns.map((fn) => ({
      functionName: fn.name,
      isBlockCoverage: true,
      ranges: fn.ranges.map((count, i) => ({
        startOffset: fn.startOffset + i,
        endOffset: fn.endOffset + i,
        count,
      })),
    })),
  } as unknown as V8ScriptCoverage
}

/** Look up a function in a merged entry by its startOffset identity. */
function findFn(entry: V8ScriptCoverage, startOffset: number) {
  return entry.functions.find((fn) => fn.ranges[0]?.startOffset === startOffset)
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('mergeV8CoverageByUrl — function identity by startOffset', () => {
  it('does not lose a range that only the rare test emitted', () => {
    // Legacy #80 test: same function shape in both entries, but the rare
    // one emits an extra tail range. The append path must preserve it.
    const url = 'http://localhost/_next/static/chunks/page.js'

    const bulk = makeEntry(url, [
      { name: 'f', startOffset: 100, endOffset: 200, ranges: [155, 155] },
    ])
    const rare = makeEntry(url, [
      { name: 'f', startOffset: 100, endOffset: 200, ranges: [1, 0, 1] },
    ])

    const [merged] = mergeV8CoverageByUrl([bulk, rare])
    const f = findFn(merged, 100)!
    expect(f.ranges.map((r) => r.count)).toEqual([156, 155, 1])
  })

  it('matches functions by startOffset when arrays are ordered differently', () => {
    // The real #80 bug. V8 emits functions in DISCOVERY order — a function
    // that's cold in test A but hot in test B lands at different array
    // indices in each entry. Merging by array index scrambles counts across
    // unrelated source functions.
    //
    // In this test:
    //   - Entry A: [f@100, g@200]  (f discovered first)
    //   - Entry B: [g@200, f@100]  (g discovered first — different test)
    //
    // Correct merge must attribute counts by identity (startOffset), not
    // by array position: f should be [10+1], g should be [20+2].
    const url = 'http://localhost/_next/static/chunks/page.js'

    const testA = makeEntry(url, [
      { name: 'f', startOffset: 100, endOffset: 150, ranges: [10] },
      { name: 'g', startOffset: 200, endOffset: 250, ranges: [20] },
    ])
    const testB = makeEntry(url, [
      { name: 'g', startOffset: 200, endOffset: 250, ranges: [2] },
      { name: 'f', startOffset: 100, endOffset: 150, ranges: [1] },
    ])

    const [merged] = mergeV8CoverageByUrl([testA, testB])
    expect(findFn(merged, 100)!.ranges[0].count).toBe(11)
    expect(findFn(merged, 200)!.ranges[0].count).toBe(22)
  })

  it('adds functions that only appear in later entries', () => {
    // A cold function that was never touched by the first test is absent
    // from that test's V8 output. When a later test that DOES touch it
    // arrives, the merged entry must include that function.
    const url = 'http://localhost/_next/static/chunks/page.js'

    const testA = makeEntry(url, [{ name: 'f', startOffset: 100, endOffset: 150, ranges: [10] }])
    const testB = makeEntry(url, [
      { name: 'f', startOffset: 100, endOffset: 150, ranges: [1] },
      { name: 'coldPath', startOffset: 900, endOffset: 950, ranges: [3] },
    ])

    const [merged] = mergeV8CoverageByUrl([testA, testB])
    expect(findFn(merged, 100)!.ranges[0].count).toBe(11)
    expect(findFn(merged, 900)?.ranges[0].count).toBe(3)
  })
})
