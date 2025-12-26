/**
 * Source Map Sanitization
 *
 * Functions for cleaning and validating source maps before processing.
 * ast-v8-to-istanbul throws "Missing original filename" when ANY mapping
 * resolves to a null/empty source. We decode VLQ mappings, filter out
 * segments referencing invalid sources, then re-encode.
 */

import { decode, encode, type SourceMapMappings } from '@jridgewell/sourcemap-codec'
import type { SourceMapData } from '../types.js'
import { log, formatError } from '../logger.js'
import { isNodeModulesPath } from '../parsers/url-utils.js'
import type { SourceMapLoader } from '../sourcemap-loader.js'
import { SOURCE_MAP_PADDING_BEFORE, SOURCE_MAP_PADDING_AFTER } from '../constants.js'

export interface SanitizerOptions {
  projectRoot: string
  sourceMapLoader: SourceMapLoader
  excludePatterns: string[]
}

/**
 * Get rejection reason for a source (returns null if valid)
 * Used for debugging why sources are being filtered out
 */
export function getSourceRejectionReason(
  source: string | null,
  content: string | null | undefined,
  projectRoot: string,
  normalizeSourcePath: (path: string) => string
): string | null {
  if (!source || source.trim() === '') {
    return 'empty/null source'
  }

  if (source.startsWith('external ') || source.includes('external%20commonjs')) {
    return 'webpack external'
  }

  // Normalize the source path first to check if it resolves to something useful
  const normalizedSource = normalizeSourcePath(source)

  // Reject sources that normalize to empty or just whitespace (e.g., webpack://_N_E/?xxxx)
  if (!normalizedSource || normalizedSource.trim() === '') {
    return 'normalized to empty path'
  }

  if (/^[A-Za-z]:[/\\]/.test(source)) {
    if (!source.toLowerCase().startsWith(projectRoot.toLowerCase())) {
      return `Windows path not in project (source starts with ${source.substring(0, 20)}, projectRoot=${projectRoot.substring(0, 20)})`
    }
  }

  // Unix absolute path check - reject paths like /src/client/... or /home/runner/src/...
  // that are Next.js internals, not user code
  if (source.startsWith('/') && !source.startsWith(projectRoot)) {
    return `Unix path not in project (source starts with ${source.substring(0, 30)}, projectRoot=${projectRoot.substring(0, 30)})`
  }

  if (isNodeModulesPath(normalizedSource)) {
    return 'node_modules'
  }

  // Check if source has src/ in its path
  // For webpack URLs with proper paths like webpack://_N_E/./src/app/page.tsx, the normalized version should have src/
  // However, Vite source maps use simple relative filenames (e.g., "App.tsx") without the full path
  // So we also accept sources that are just filenames with valid extensions
  const isViteStyleSource = /^[^/\\]+\.(tsx?|jsx?|vue|svelte)$/.test(normalizedSource)
  if (!isViteStyleSource && !normalizedSource.includes('src/') && !source.includes('/src/') && !source.includes('\\src\\')) {
    return `no src/ in path (normalized=${normalizedSource.substring(0, 40)})`
  }

  if (!content || typeof content !== 'string') {
    return 'no sourcesContent'
  }

  return null // Valid
}

/**
 * Check if a source path matches any exclude pattern.
 * Used to skip processing bundles that only contain excluded files.
 */
export function isSourceExcluded(sourcePath: string, excludePatterns: string[]): boolean {
  if (excludePatterns.length === 0) return false

  // Normalize to forward slashes for matching
  const normalized = sourcePath.replace(/\\/g, '/')

  return excludePatterns.some(pattern => {
    // Simple pattern matching - support basic glob patterns
    // Convert glob pattern to regex: ** -> .*, * -> [^/]*, ? -> .
    const regexPattern = pattern
      .replace(/\\/g, '/')
      .replace(/\*\*/g, '{{DOUBLESTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.')
      .replace(/\{\{DOUBLESTAR\}\}/g, '.*')

    const regex = new RegExp(regexPattern)
    return regex.test(normalized)
  })
}

/**
 * Clean source map by filtering out problematic sources AND their mappings
 *
 * ast-v8-to-istanbul throws "Missing original filename" when ANY mapping
 * resolves to a null/empty source. We decode VLQ mappings, filter out
 * segments referencing invalid sources, then re-encode.
 */
export function sanitizeSourceMap(
  sourceMap: SourceMapData,
  options: SanitizerOptions
): SourceMapData | undefined {
  if (!sourceMap.sources || sourceMap.sources.length === 0) {
    return undefined
  }

  const { projectRoot, sourceMapLoader, excludePatterns } = options
  const normalizeSourcePath = (path: string) => sourceMapLoader.normalizeSourcePath(path)

  // Step 1: Identify valid source indices
  const validSourceIndices = new Set<number>()
  const rejectionReasons: string[] = []
  const acceptedSources: string[] = []

  for (let i = 0; i < sourceMap.sources.length; i++) {
    const source = sourceMap.sources[i]
    const content = sourceMap.sourcesContent?.[i]
    const reason = getSourceRejectionReason(source, content, projectRoot, normalizeSourcePath)
    if (!reason) {
      validSourceIndices.add(i)
      if (acceptedSources.length < 10) {
        // Show full source path for better debugging
        acceptedSources.push(`[${i}] ${source}`)
      }
    } else if (rejectionReasons.length < 5) {
      // Log first 5 rejection reasons for debugging
      rejectionReasons.push(`[${i}] ${source?.substring(0, 60)}: ${reason}`)
    }
  }

  // If no valid sources, skip this entry
  if (validSourceIndices.size === 0) {
    log(`  Debug: sanitizeSourceMap rejected all ${sourceMap.sources.length} sources`)
    if (rejectionReasons.length > 0) {
      rejectionReasons.forEach(r => log(`    ${r}`))
    }
    return undefined
  }

  // Log accepted sources for debugging
  if (acceptedSources.length > 0) {
    log(`  Debug: sanitizeSourceMap accepted ${validSourceIndices.size}/${sourceMap.sources.length} sources`)
    acceptedSources.forEach(s => log(`    ✓ ${s}`))
  }

  // Performance optimization: Skip bundles where ALL valid sources are excluded
  // This avoids expensive VLQ decode/encode for bundles like middleware.js
  // where all sources (e.g., middleware.ts) are in the exclude list.
  if (excludePatterns.length > 0) {
    const validSources = Array.from(validSourceIndices).map(i => sourceMap.sources[i])
    const allExcluded = validSources.every(source => {
      const normalized = normalizeSourcePath(source)
      return isSourceExcluded(normalized, excludePatterns)
    })
    if (allExcluded) {
      log(`  ⏭️ Skipping bundle: all ${validSources.length} sources match exclude patterns`)
      validSources.slice(0, 5).forEach(s => log(`    - ${s.split('/').pop()}`))
      return undefined
    }
  }

  // If all sources are valid, just normalize and return
  if (validSourceIndices.size === sourceMap.sources.length) {
    const normalizedSources = sourceMap.sources.map((source) => {
      return normalizeSourcePath(source)
    })
    return {
      ...sourceMap,
      sources: normalizedSources,
    }
  }

  // Step 2: Decode mappings to filter out bad source references
  let decodedMappings: SourceMapMappings
  try {
    decodedMappings = decode(sourceMap.mappings)
  } catch (error) {
    log(`  Failed to decode source map mappings: ${formatError(error)}`)
    return undefined
  }

  // Step 3: Build old->new source index mapping
  const oldToNewIndex = new Map<number, number>()
  let newIndex = 0
  for (let i = 0; i < sourceMap.sources.length; i++) {
    if (validSourceIndices.has(i)) {
      oldToNewIndex.set(i, newIndex++)
    }
  }

  // Step 4: Filter and remap segments
  const filteredMappings: SourceMapMappings = []
  for (const line of decodedMappings) {
    const filteredLine: typeof line = []
    for (const segment of line) {
      if (segment.length === 1) {
        filteredLine.push(segment)
      } else if (segment.length >= 4) {
        const sourceIndex = segment[1]
        if (validSourceIndices.has(sourceIndex)) {
          const newSourceIndex = oldToNewIndex.get(sourceIndex)!
          if (segment.length === 4) {
            filteredLine.push([segment[0], newSourceIndex, segment[2], segment[3]])
          } else {
            filteredLine.push([segment[0], newSourceIndex, segment[2], segment[3], segment[4]])
          }
        }
      }
    }
    filteredMappings.push(filteredLine)
  }

  // Step 5: Re-encode mappings
  let encodedMappings: string
  try {
    encodedMappings = encode(filteredMappings)
  } catch (error) {
    log(`  Failed to encode source map mappings: ${formatError(error)}`)
    return undefined
  }

  // Step 6: Build new source map with only valid sources
  const newSources: string[] = []
  const newSourcesContent: (string | null)[] = []
  for (let i = 0; i < sourceMap.sources.length; i++) {
    if (validSourceIndices.has(i)) {
      newSources.push(normalizeSourcePath(sourceMap.sources[i]))
      newSourcesContent.push(sourceMap.sourcesContent?.[i] ?? null)
    }
  }

  return {
    ...sourceMap,
    sources: newSources,
    sourcesContent: newSourcesContent,
    mappings: encodedMappings,
  }
}

/**
 * Compute multiple contiguous byte ranges where source code exists.
 *
 * For large bundles with many external dependencies, src code is often
 * scattered across multiple "islands" in the generated code (especially
 * with webpack bundles where each user module is a separate range).
 *
 * By computing these precise ranges, we can skip processing AST nodes
 * in framework/library code between user modules, significantly improving
 * performance over a single min-max range approach.
 *
 * Returns array of { minOffset, maxOffset } or empty array if no mappings found.
 */
export function computeSrcCodeRanges(
  sourceMap: SourceMapData,
  code: string
): Array<{ minOffset: number; maxOffset: number }> {
  if (!sourceMap.mappings || !sourceMap.sources) {
    return []
  }

  // Decode the mappings
  let decodedMappings: SourceMapMappings
  try {
    decodedMappings = decode(sourceMap.mappings)
  } catch {
    return []
  }

  // Find line offsets in the generated code
  const lines = code.split('\n')
  const lineOffsets: number[] = [0]
  let offset = 0
  for (const line of lines) {
    offset += line.length + 1
    lineOffsets.push(offset)
  }

  // Collect all byte offsets that map to source files
  const srcOffsets: number[] = []
  for (let lineIndex = 0; lineIndex < decodedMappings.length; lineIndex++) {
    const lineSegments = decodedMappings[lineIndex]
    const lineStart = lineOffsets[lineIndex] || 0

    for (const segment of lineSegments) {
      if (segment.length >= 4) {
        const columnOffset = segment[0]
        const byteOffset = lineStart + columnOffset
        srcOffsets.push(byteOffset)
      }
    }
  }

  if (srcOffsets.length === 0) {
    return []
  }

  // Sort offsets and group into contiguous ranges
  // Gap threshold: if two mappings are more than 1KB apart, treat as separate ranges
  const GAP_THRESHOLD = 1000
  srcOffsets.sort((a, b) => a - b)

  const ranges: Array<{ minOffset: number; maxOffset: number }> = []
  let rangeStart = srcOffsets[0]
  let rangeEnd = srcOffsets[0]

  for (let i = 1; i < srcOffsets.length; i++) {
    const current = srcOffsets[i]
    if (current - rangeEnd > GAP_THRESHOLD) {
      // Gap detected - save current range and start new one
      ranges.push({
        minOffset: Math.max(0, rangeStart - SOURCE_MAP_PADDING_BEFORE),
        maxOffset: Math.min(code.length, rangeEnd + SOURCE_MAP_PADDING_AFTER),
      })
      rangeStart = current
    }
    rangeEnd = current
  }

  // Add the last range
  ranges.push({
    minOffset: Math.max(0, rangeStart - SOURCE_MAP_PADDING_BEFORE),
    maxOffset: Math.min(code.length, rangeEnd + SOURCE_MAP_PADDING_AFTER),
  })

  return ranges
}
