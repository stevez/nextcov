/**
 * Core Processing Modules
 *
 * Main pipeline components for coverage processing
 */

// Main processor
export { CoverageProcessor } from './processor.js'

// Supporting classes
export { V8CoverageReader } from './v8-reader.js'
export { SourceMapLoader } from './sourcemap-loader.js'
export { CoverageConverter } from '@/converter/index.js'
export { IstanbulReporter } from './reporter.js'
