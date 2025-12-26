import { describe, it, expect } from 'vitest'
import {
  SOURCE_MAP_LOOKBACK_LIMIT,
  SOURCE_MAPPING_URL_PATTERN,
  INLINE_SOURCE_MAP_BASE64_PATTERN,
  DATA_URL_BASE64_PATTERN,
  INLINE_SOURCE_MAP_PATTERN,
  INLINE_SOURCE_MAP_PATTERN_GLOBAL,
  hasInlineSourceMap,
  hasSourceMappingUrl,
  extractSourceMappingUrl,
  isDataUrl,
} from '../sourcemap.js'

// Build test strings dynamically to avoid Vite's source map scanner
// detecting our test data as actual source maps (Windows Vite bug)
const SM_URL_KEY = ['source', 'Mapping', 'URL'].join('')
const buildSourceMapComment = (url: string) => `//#${' '}${SM_URL_KEY}=${url}`
const buildDataUrl = (base64: string, withCharset = true) => {
  const charset = withCharset ? 'charset=utf-8;' : ''
  return `data:application/json;${charset}base64,${base64}`
}

describe('sourcemap parser', () => {
  describe('constants', () => {
    it('should have correct lookback limit', () => {
      expect(SOURCE_MAP_LOOKBACK_LIMIT).toBe(10000)
    })
  })

  describe('SOURCE_MAPPING_URL_PATTERN', () => {
    it('should match //# format', () => {
      const code = buildSourceMapComment('app.js.map')
      const match = code.match(SOURCE_MAPPING_URL_PATTERN)
      expect(match?.[1]).toBe('app.js.map')
    })

    it('should match //@ format (legacy)', () => {
      const code = `//@${' '}${SM_URL_KEY}=bundle.js.map`
      const match = code.match(SOURCE_MAPPING_URL_PATTERN)
      expect(match?.[1]).toBe('bundle.js.map')
    })
  })

  describe('INLINE_SOURCE_MAP_BASE64_PATTERN', () => {
    it('should match inline base64 source map with charset', () => {
      const dataUrl = buildDataUrl('eyJ2ZXJzaW9uIjozfQ==', true)
      const code = buildSourceMapComment(dataUrl)
      const match = code.match(INLINE_SOURCE_MAP_BASE64_PATTERN)
      expect(match?.[1]).toBe('eyJ2ZXJzaW9uIjozfQ==')
    })

    it('should match inline base64 source map without charset', () => {
      const dataUrl = buildDataUrl('eyJ2ZXJzaW9uIjozfQ==', false)
      const code = buildSourceMapComment(dataUrl)
      const match = code.match(INLINE_SOURCE_MAP_BASE64_PATTERN)
      expect(match?.[1]).toBe('eyJ2ZXJzaW9uIjozfQ==')
    })
  })

  describe('DATA_URL_BASE64_PATTERN', () => {
    it('should match data URL with charset', () => {
      const url = buildDataUrl('eyJ2ZXJzaW9uIjozfQ==', true)
      const match = url.match(DATA_URL_BASE64_PATTERN)
      expect(match?.[1]).toBe('eyJ2ZXJzaW9uIjozfQ==')
    })

    it('should match data URL without charset', () => {
      const url = buildDataUrl('eyJ2ZXJzaW9uIjozfQ==', false)
      const match = url.match(DATA_URL_BASE64_PATTERN)
      expect(match?.[1]).toBe('eyJ2ZXJzaW9uIjozfQ==')
    })

    it('should not match non-data URLs', () => {
      const url = 'app.js.map'
      const match = url.match(DATA_URL_BASE64_PATTERN)
      expect(match).toBe(null)
    })
  })

  describe('INLINE_SOURCE_MAP_PATTERN', () => {
    it('should extract base64 content from data URL', () => {
      const dataUrl = buildDataUrl('eyJ2ZXJzaW9uIjozfQ==', false)
      const code = buildSourceMapComment(dataUrl)
      const match = code.match(INLINE_SOURCE_MAP_PATTERN)
      expect(match?.[1]).toBe('eyJ2ZXJzaW9uIjozfQ==')
    })
  })

  describe('INLINE_SOURCE_MAP_PATTERN_GLOBAL', () => {
    it('should find all inline source maps in a chunk', () => {
      const dataUrl1 = buildDataUrl('eyJ2ZXJzaW9uIjozfQ==', true)
      const dataUrl2 = buildDataUrl('eyJ2ZXJzaW9uIjo0fQ==', true)
      const code = `
        ${buildSourceMapComment(dataUrl1)}
        ${buildSourceMapComment(dataUrl2)}
      `
      const matches = [...code.matchAll(INLINE_SOURCE_MAP_PATTERN_GLOBAL)]
      expect(matches).toHaveLength(2)
      expect(matches[0][1]).toBe('eyJ2ZXJzaW9uIjozfQ==')
      expect(matches[1][1]).toBe('eyJ2ZXJzaW9uIjo0fQ==')
    })
  })

  describe('hasInlineSourceMap', () => {
    it('should return true for code with inline source map', () => {
      const dataUrl = buildDataUrl('eyJ2ZXJzaW9uIjozfQ==', true)
      const code = `function foo() {}\n${buildSourceMapComment(dataUrl)}`
      expect(hasInlineSourceMap(code)).toBe(true)
    })

    it('should return false for code with external source map', () => {
      const code = `function foo() {}\n${buildSourceMapComment('app.js.map')}`
      expect(hasInlineSourceMap(code)).toBe(false)
    })

    it('should return false for code without source map', () => {
      const code = 'function foo() {}'
      expect(hasInlineSourceMap(code)).toBe(false)
    })
  })

  describe('hasSourceMappingUrl', () => {
    it('should return true for inline source map', () => {
      const dataUrl = buildDataUrl('eyJ2ZXJzaW9uIjozfQ==', false)
      const code = `function foo() {}\n${buildSourceMapComment(dataUrl)}`
      expect(hasSourceMappingUrl(code)).toBe(true)
    })

    it('should return true for external source map', () => {
      const code = `function foo() {}\n${buildSourceMapComment('app.js.map')}`
      expect(hasSourceMappingUrl(code)).toBe(true)
    })

    it('should return false for code without source map', () => {
      const code = 'function foo() {}'
      expect(hasSourceMappingUrl(code)).toBe(false)
    })
  })

  describe('extractSourceMappingUrl', () => {
    it('should extract external source map URL', () => {
      const code = `function foo() {}\n${buildSourceMapComment('app.js.map')}`
      expect(extractSourceMappingUrl(code)).toBe('app.js.map')
    })

    it('should extract inline source map data URL', () => {
      const dataUrl = buildDataUrl('eyJ2ZXJzaW9uIjozfQ==', false)
      const code = `function foo() {}\n${buildSourceMapComment(dataUrl)}`
      expect(extractSourceMappingUrl(code)).toBe(dataUrl)
    })

    it('should return null when no source map', () => {
      const code = 'function foo() {}'
      expect(extractSourceMappingUrl(code)).toBe(null)
    })

    it('should trim whitespace from URL', () => {
      const code = `function foo() {}\n${buildSourceMapComment('app.js.map   ')}`
      expect(extractSourceMappingUrl(code)).toBe('app.js.map')
    })
  })

  describe('isDataUrl', () => {
    it('should return true for data URLs', () => {
      expect(isDataUrl(buildDataUrl('eyJ2ZXJzaW9uIjozfQ==', true))).toBe(true)
      expect(isDataUrl('data:text/plain,hello')).toBe(true)
    })

    it('should return false for file paths', () => {
      expect(isDataUrl('app.js.map')).toBe(false)
      expect(isDataUrl('/path/to/app.js.map')).toBe(false)
      expect(isDataUrl('./app.js.map')).toBe(false)
    })

    it('should return false for http URLs', () => {
      expect(isDataUrl('http://example.com/app.js.map')).toBe(false)
      expect(isDataUrl('https://example.com/app.js.map')).toBe(false)
    })
  })
})
