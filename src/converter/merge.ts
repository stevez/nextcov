/**
 * V8 Coverage Merging
 *
 * Functions for merging V8 coverage entries from multiple test runs.
 * When the same chunk is visited by multiple tests, we merge execution counts.
 */

import type { V8ScriptCoverage } from '@/types.js'
import { log, createTimer } from '@/utils/logger.js'

/**
 * Normalize URL for merging by stripping query parameters.
 *
 * In dev mode, Next.js appends version timestamps like `?v=1765765839055`
 * to chunk URLs. These are the same file content, just different cache busters.
 * We strip these to merge coverage from the same underlying file.
 */
export function normalizeUrlForMerge(url: string): string {
  // Strip query parameters (e.g., ?v=1765765839055)
  const queryIndex = url.indexOf('?')
  return queryIndex === -1 ? url : url.substring(0, queryIndex)
}

/**
 * Merge V8 coverage entries by URL using SUM strategy.
 *
 * When the same chunk is visited by multiple tests, we SUM execution counts
 * to get total coverage across all tests. This matches how Vitest merges
 * coverage (though Vitest uses @bcoe/v8-coverage which we can't use due to
 * its normalization changing function structures).
 *
 * For coverage reporting (covered vs uncovered), SUM and MAX produce identical
 * results since both preserve non-zero counts. SUM gives more accurate execution
 * counts if you need them for profiling.
 *
 * URLs are normalized by stripping query parameters (e.g., ?v=xxxxx) so that
 * dev mode cache-busted URLs are merged correctly.
 *
 * This significantly reduces processing time by converting 400 entries → ~30 unique entries.
 */
export function mergeV8CoverageByUrl(entries: V8ScriptCoverage[]): V8ScriptCoverage[] {
  const endTimer = createTimer(`mergeV8CoverageByUrl (${entries.length} entries)`)
  const merged = new Map<string, V8ScriptCoverage>()

  for (const entry of entries) {
    const normalizedUrl = normalizeUrlForMerge(entry.url)
    const existing = merged.get(normalizedUrl)

    if (!existing) {
      // First time seeing this URL - deep clone it
      // Use normalized URL as both the key and the stored URL
      merged.set(normalizedUrl, {
        scriptId: entry.scriptId,
        url: normalizedUrl,
        source: entry.source,
        functions: entry.functions.map(fn => ({
          functionName: fn.functionName,
          isBlockCoverage: fn.isBlockCoverage,
          ranges: fn.ranges.map(r => ({ ...r })),
        })),
      })
      continue
    }

    // Same URL - merge coverage counts using SUM.
    //
    // V8's `Profiler.takePreciseCoverage` emits functions in discovery order,
    // NOT in source-position order. Different tests exercise different code
    // paths → different discovery orders → the same source function appears
    // at DIFFERENT array indices across entries (see nextcov #80). We must
    // match functions by identity (`ranges[0].startOffset`, which is the
    // function's source-byte offset in the compiled bundle — stable across
    // all tests that reference the same script).
    //
    // When a function present in the new entry is NOT in the existing entry
    // (e.g. it was cold in earlier tests but a later test exercised it), we
    // append it so the coverage isn't lost.
    const existingByStart = new Map<number, (typeof existing.functions)[number]>()
    for (const fn of existing.functions) {
      const key = fn.ranges[0]?.startOffset
      if (key !== undefined) existingByStart.set(key, fn)
    }

    for (const newFn of entry.functions) {
      const key = newFn.ranges[0]?.startOffset
      const existingFn = key !== undefined ? existingByStart.get(key) : undefined

      if (!existingFn) {
        // Function absent from the existing entry — clone into it so its
        // counts contribute to the merged output.
        existing.functions.push({
          functionName: newFn.functionName,
          isBlockCoverage: newFn.isBlockCoverage,
          ranges: newFn.ranges.map((r) => ({ ...r })),
        })
        continue
      }

      // Sum counts for inner ranges. V8 emits ranges hierarchically: a
      // function's range list starts with the whole-body range and adds
      // strictly-nested sub-ranges only when the sub-region's count DIFFERS
      // from its enclosing range. Two consequences drive this merge:
      //
      // 1. V8 may emit inner sub-ranges in different array orders across
      //    tests, or omit them entirely in tests where the sub-region
      //    happened to match its enclosing count. Match by
      //    `(startOffset, endOffset)` identity, not array index.
      //
      // 2. When one entry has a sub-range and the other doesn't, the
      //    "silent" entry is IMPLYING that its enclosing range's count
      //    applies to that sub-region. To merge correctly we must add that
      //    implicit count to whatever explicit count the other entry gave.
      //    Skipping this step (as the naive `existingByKey`-only approach
      //    does) causes rare sub-ranges to lose all counts from tests
      //    whose whole-body range would otherwise have covered them.
      const findEnclosingCount = (
        ranges: (typeof existingFn.ranges),
        start: number,
        end: number,
      ): number => {
        let bestCount = 0
        let bestSize = Infinity
        for (const r of ranges) {
          if (r.startOffset <= start && r.endOffset >= end) {
            const size = r.endOffset - r.startOffset
            if (size < bestSize) {
              bestSize = size
              bestCount = r.count
            }
          }
        }
        return bestCount
      }

      const existingRangesByKey = new Map<string, (typeof existingFn.ranges)[number]>()
      for (const range of existingFn.ranges) {
        existingRangesByKey.set(`${range.startOffset}:${range.endOffset}`, range)
      }
      // Snapshot the accumulator's ranges before we start mutating counts —
      // used to answer "what was the implicit count for a range only the
      // new entry emitted?".
      const existingRangesSnapshot = existingFn.ranges.map((r) => ({ ...r }))

      const seenNewKeys = new Set<string>()
      for (const newRange of newFn.ranges) {
        const rangeKey = `${newRange.startOffset}:${newRange.endOffset}`
        seenNewKeys.add(rangeKey)
        const existingRange = existingRangesByKey.get(rangeKey)
        if (existingRange) {
          existingRange.count += newRange.count
        } else {
          // New sub-range not present in the accumulator. Its merged count
          // is `new.count + accumulator's implicit count` for that region.
          const implicit = findEnclosingCount(
            existingRangesSnapshot,
            newRange.startOffset,
            newRange.endOffset,
          )
          const clonedRange = { ...newRange, count: newRange.count + implicit }
          existingFn.ranges.push(clonedRange)
          existingRangesByKey.set(rangeKey, clonedRange)
        }
      }

      // Symmetrically: for accumulator sub-ranges the new entry never
      // emitted, add the new entry's implicit count for that region.
      for (const range of existingFn.ranges) {
        const key = `${range.startOffset}:${range.endOffset}`
        if (seenNewKeys.has(key)) continue
        range.count += findEnclosingCount(
          newFn.ranges,
          range.startOffset,
          range.endOffset,
        )
      }
    }
  }

  const result = Array.from(merged.values())
  log(`  ✓ Merged ${entries.length} entries → ${result.length} unique URLs`)
  endTimer()
  return result
}
