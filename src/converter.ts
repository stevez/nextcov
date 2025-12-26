/**
 * V8 to Istanbul Coverage Converter
 *
 * Re-exports from the modular converter implementation for backward compatibility.
 * The actual implementation is now split across multiple files in src/converter/
 */

// Re-export the main class
export { CoverageConverter } from './converter/index.js'

// Re-export utility functions that were previously exported
export { mergeV8CoverageByUrl } from './converter/merge.js'
