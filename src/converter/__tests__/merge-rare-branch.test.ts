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

  it('matches INNER ranges by (startOffset, endOffset) when arrays are ordered differently', () => {
    // Inner-range analogue of #80. Within a single function, V8 can emit
    // block-coverage ranges in DIFFERENT orders across tests: the array
    // position of `{150, 160, count=0}` in test A may correspond to
    // `{170, 180, count=3}` in test B, because V8 emits ranges in the
    // order it visits basic blocks (which depends on which basic blocks
    // the test actually executed).
    //
    // Merging inner ranges by ARRAY INDEX therefore scrambles branch
    // counts across unrelated basic blocks in the same function — the
    // exact class of bug the #80 fix addressed at the function level,
    // recursed one level down. Match by `(startOffset, endOffset)`
    // identity instead.
    const url = 'http://localhost/_next/static/chunks/page.js'

    const testA: V8ScriptCoverage = {
      scriptId: 'x',
      url,
      source: 'placeholder',
      functions: [
        {
          functionName: 'f',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 100, endOffset: 200, count: 10 }, // whole fn body
            { startOffset: 150, endOffset: 160, count: 0 },  // block B1: not taken by A
            { startOffset: 170, endOffset: 180, count: 5 },  // block B2: taken by A
          ],
        },
      ],
    } as unknown as V8ScriptCoverage

    const testB: V8ScriptCoverage = {
      scriptId: 'x',
      url,
      source: 'placeholder',
      functions: [
        {
          functionName: 'f',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 100, endOffset: 200, count: 8 },  // whole fn body
            { startOffset: 170, endOffset: 180, count: 3 },  // block B2: swapped position
            { startOffset: 150, endOffset: 160, count: 0 },  // block B1: swapped position
          ],
        },
      ],
    } as unknown as V8ScriptCoverage

    const [merged] = mergeV8CoverageByUrl([testA, testB])
    const rangesByKey = new Map(
      merged.functions[0].ranges.map((r) => [`${r.startOffset}:${r.endOffset}`, r.count]),
    )

    // Under the buggy array-index merge, ranges[1] would have summed to
    // 0+3=3 (misattributed to B1) and ranges[2] to 5+0=5 (misattributed to
    // B2). The identity-based merge attributes counts correctly:
    expect(rangesByKey.get('100:200')).toBe(18) // whole fn: 10 + 8
    expect(rangesByKey.get('150:160')).toBe(0)  // B1: 0 + 0
    expect(rangesByKey.get('170:180')).toBe(8)  // B2: 5 + 3
  })

  it('preserves the if-branch (then-arm) sub-range count from the enclosing range when only one entry emits it', () => {
    // Scenario: a rare test hits the "if" branch that most tests don't
    // emit as a separate sub-range at all. Test A (many tests) reports
    // only the whole-body range with count = 10 — V8 didn't emit an
    // inner range for the if-then block because A never entered that
    // block, so its implicit count for the block is 10 (same as the
    // enclosing range). Test B (one rare test) explicitly emits the
    // if-then sub-range with count = 1 because it DID enter that block.
    //
    // Correct merged count for the if-then block is 10 (from A's
    // enclosing range, since A never explicitly excluded that block)
    // + 1 (from B's explicit sub-range) = 11.
    //
    // A naive merge that just appends B's sub-range as-is would report
    // count = 1 for the if-then block — dropping A's implicit hits and
    // making the branch look under-covered. That was the regression
    // observed downstream (GRIP-UI SmartQueryClient.jsx b8 L293) after
    // the initial identity-only fix.
    const url = 'http://localhost/_next/static/chunks/page.js'

    const testA: V8ScriptCoverage = {
      scriptId: 'x',
      url,
      source: 'placeholder',
      functions: [
        {
          functionName: 'f',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 100, endOffset: 200, count: 10 }, // whole fn body only
          ],
        },
      ],
    } as unknown as V8ScriptCoverage

    const testB: V8ScriptCoverage = {
      scriptId: 'x',
      url,
      source: 'placeholder',
      functions: [
        {
          functionName: 'f',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 100, endOffset: 200, count: 1 },  // whole fn body
            { startOffset: 130, endOffset: 145, count: 1 },  // if-then sub-range: entered
          ],
        },
      ],
    } as unknown as V8ScriptCoverage

    const [merged] = mergeV8CoverageByUrl([testA, testB])
    const rangesByKey = new Map(
      merged.functions[0].ranges.map((r) => [`${r.startOffset}:${r.endOffset}`, r.count]),
    )

    expect(rangesByKey.get('100:200')).toBe(11) // whole fn: 10 + 1
    // if-then sub-range: A's implicit 10 (enclosing range covers it) + B's 1
    expect(rangesByKey.get('130:145')).toBe(11)
  })

  it('preserves the else-branch (else-arm) sub-range count from the accumulator across a new entry that never emits it', () => {
    // Mirror scenario: the accumulator (built from earlier tests) has an
    // explicit else-arm sub-range with count = 0 because those tests
    // exercised the if-then and V8 emitted a zero-count range for the
    // NOT-taken else block. A later test hits neither branch of the if
    // (or is a whole-function invocation without triggering the if at
    // all) and emits ONLY the whole-body range. Its implicit count for
    // the else block equals the whole-fn count.
    //
    // Correct merged count for the else block = accumulator's 0 (from
    // earlier explicit zero-count ranges) + new entry's implicit count
    // for the region = 5.
    //
    // A naive merge that skips ranges the new entry didn't emit leaves
    // the else block at count = 0 forever — hiding real coverage from
    // the whole-body invocations that DID execute the else path
    // implicitly.
    const url = 'http://localhost/_next/static/chunks/page.js'

    // Accumulator: an if-then dominant test that emitted the whole-fn
    // range (count 3) + a zero-count else block.
    const testA: V8ScriptCoverage = {
      scriptId: 'x',
      url,
      source: 'placeholder',
      functions: [
        {
          functionName: 'f',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 100, endOffset: 200, count: 3 },  // whole fn body
            { startOffset: 160, endOffset: 175, count: 0 },  // else block: not taken in A
          ],
        },
      ],
    } as unknown as V8ScriptCoverage

    // New entry: a test that ran the whole fn 5 times but with a code
    // path that happened to hit the else block implicitly — V8 didn't
    // emit an explicit range because the else block's count equals the
    // enclosing range.
    const testB: V8ScriptCoverage = {
      scriptId: 'x',
      url,
      source: 'placeholder',
      functions: [
        {
          functionName: 'f',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 100, endOffset: 200, count: 5 },  // whole fn body only
          ],
        },
      ],
    } as unknown as V8ScriptCoverage

    const [merged] = mergeV8CoverageByUrl([testA, testB])
    const rangesByKey = new Map(
      merged.functions[0].ranges.map((r) => [`${r.startOffset}:${r.endOffset}`, r.count]),
    )

    expect(rangesByKey.get('100:200')).toBe(8) // whole fn: 3 + 5
    // else block: A's 0 (explicit) + B's implicit 5 = 5 (rescued from
    // the whole-body count).
    expect(rangesByKey.get('160:175')).toBe(5)
  })

  it('splits 4x callback hits into 2x then + 2x else across two entries without one overriding the other', () => {
    // Directly mirrors the downstream GRIP-UI symptom (SmartQueryClient.jsx
    // b8 L293): a forEach callback runs 4 times total across two E2E tests.
    // Two iterations take the if-then arm, two take the if-else arm. After
    // merging, istanbul should read `[then=2, else=2]`, NOT `[4, 0]` or
    // `[0, 4]` where one arm wipes out the other.
    //
    // Concretely, model an inner `if (cond) A;` (no explicit else clause).
    // V8 emits an explicit range only for the then block; the else arm is
    // istanbul-derived as `enclosing_count - then_count`.
    //
    // Test A: 2 callback invocations, cond=true both times → V8 emits
    //   {whole=2} only. The then block's implicit count is 2 (== whole).
    //   {outer-else}, {inner-then} — same count as whole → not emitted.
    //   V8 does emit {outer-else block=0} because it differs from whole.
    //
    // Test B: 2 callback invocations, cond=false both times → V8 emits
    //   {whole=2}, {outer-else=0}, AND {inner-then=0} (differs from whole).
    //
    // Correct merged view of the inner-if then block:
    //   A took inner-then twice (implicit from whole=2).
    //   B took inner-then zero times (explicit 0).
    //   Total = 2 + 0 = 2.
    //
    // Correct merged view of the inner-if else arm (istanbul-derived):
    //   enclosing = outer-then = 4 (both tests always took outer-then)
    //   inner-then = 2
    //   inner-else = enclosing - inner-then = 4 - 2 = 2.
    //
    // The naive identity-only merge (before this fix) would leave the
    // inner-then sub-range at B's explicit 0 — dropping A's implicit 2 —
    // and istanbul would then report [0, 4] instead of [2, 2].
    const url = 'http://localhost/_next/static/chunks/page.js'

    // Byte layout for the forEach callback:
    //   [100, 200] whole callback body
    //   [130, 145] inner-then block (inside outer-then, which is implicit
    //                                because outer-then count === whole)
    //   [180, 195] outer-else block (sibling of outer-then, disjoint from
    //                                inner-then)
    const testA: V8ScriptCoverage = {
      scriptId: 'x',
      url,
      source: 'placeholder',
      functions: [
        {
          functionName: 'cb',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 100, endOffset: 200, count: 2 }, // whole callback
            { startOffset: 180, endOffset: 195, count: 0 }, // outer-else block
            // outer-then and inner-then are implicit: same count as whole.
          ],
        },
      ],
    } as unknown as V8ScriptCoverage

    const testB: V8ScriptCoverage = {
      scriptId: 'x',
      url,
      source: 'placeholder',
      functions: [
        {
          functionName: 'cb',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 100, endOffset: 200, count: 2 }, // whole callback
            { startOffset: 180, endOffset: 195, count: 0 }, // outer-else block
            { startOffset: 130, endOffset: 145, count: 0 }, // inner-then=0 explicit
          ],
        },
      ],
    } as unknown as V8ScriptCoverage

    const [merged] = mergeV8CoverageByUrl([testA, testB])
    const rangesByKey = new Map(
      merged.functions[0].ranges.map((r) => [`${r.startOffset}:${r.endOffset}`, r.count]),
    )

    expect(rangesByKey.get('100:200')).toBe(4) // whole callback: 2 + 2
    expect(rangesByKey.get('180:195')).toBe(0) // outer-else: 0 + 0 (never taken)
    // inner-then block: A's implicit 2 (from whole) + B's explicit 0 = 2.
    // istanbul then reads `[then=2, else=(4-2)=2]` — both arms covered.
    expect(rangesByKey.get('130:145')).toBe(2)
  })
})
