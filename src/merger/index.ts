/**
 * Coverage Merger Module
 *
 * Merges coverage from multiple sources while preserving coverage structures
 */

// Core merger class and functions
export {
  CoverageMerger,
  createMerger,
  mergeCoverageMaps,
  mergeWithBaseCoverage,
  mergeCoverage,
  type MergeCoverageOptions,
  type MergeCoverageResult,
} from './core.js'

// Printer functions
export {
  printCoverageSummary,
  printCoverageComparison,
} from './printer.js'
