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

      // Sum counts for each range. If `newFn` emitted extra tail ranges
      // (e.g. detailed block coverage a rare test picked up), append them.
      const shared = Math.min(newFn.ranges.length, existingFn.ranges.length)
      for (let j = 0; j < shared; j++) {
        existingFn.ranges[j].count += newFn.ranges[j].count
      }
      for (let j = shared; j < newFn.ranges.length; j++) {
        existingFn.ranges.push({ ...newFn.ranges[j] })
      }
    }
  }

  const result = Array.from(merged.values())
  log(`  ✓ Merged ${entries.length} entries → ${result.length} unique URLs`)
  endTimer()
  return result
}
