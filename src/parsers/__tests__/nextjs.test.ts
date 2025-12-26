import { describe, it, expect } from 'vitest'
import {
  NEXTJS_CHUNK_PATTERN,
  isNextChunksUrl,
  extractNextPath,
  getServerPatterns,
  isNextjsInternalPath,
  stripNextjsPrefix,
} from '../nextjs.js'

describe('nextjs parser', () => {
  describe('NEXTJS_CHUNK_PATTERN', () => {
    it('should match Next.js chunk URLs', () => {
      const html = '<script src="_next/static/chunks/app/page.js"></script>'
      const matches = html.match(NEXTJS_CHUNK_PATTERN)
      expect(matches).toContain('_next/static/chunks/app/page.js')
    })

    it('should match multiple chunks', () => {
      const html = `
        <script src="_next/static/chunks/main.js"></script>
        <script src="_next/static/chunks/app/layout.js"></script>
      `
      const matches = html.match(NEXTJS_CHUNK_PATTERN)
      expect(matches).toHaveLength(2)
    })
  })

  describe('isNextChunksUrl', () => {
    it('should return true for Next.js chunk URLs', () => {
      expect(isNextChunksUrl('http://localhost:3000/_next/static/chunks/app/page.js')).toBe(true)
      expect(isNextChunksUrl('/_next/static/chunks/main.js')).toBe(true)
    })

    it('should return false for non-chunk URLs', () => {
      expect(isNextChunksUrl('http://localhost:3000/src/app.js')).toBe(false)
      expect(isNextChunksUrl('/_next/image?url=...')).toBe(false)
      expect(isNextChunksUrl('/api/users')).toBe(false)
    })
  })

  describe('extractNextPath', () => {
    it('should extract path after /_next/', () => {
      expect(extractNextPath('http://localhost:3000/_next/static/chunks/app/page.js')).toBe('static/chunks/app/page.js')
      expect(extractNextPath('/_next/static/media/image.png')).toBe('static/media/image.png')
    })

    it('should return null if /_next/ not found', () => {
      expect(extractNextPath('http://localhost:3000/src/app.js')).toBe(null)
      expect(extractNextPath('/api/users')).toBe(null)
    })
  })

  describe('getServerPatterns', () => {
    it('should return patterns for default build dir', () => {
      const patterns = getServerPatterns('.next')
      expect(patterns).toContain('.next/server/app')
      expect(patterns).toContain('.next/server/pages')
      expect(patterns).toContain('.next/server/chunks')
      expect(patterns).toContain('.next/server/src')
    })

    it('should work with custom build dir', () => {
      const patterns = getServerPatterns('build')
      expect(patterns).toContain('build/server/app')
      expect(patterns).toContain('build/server/pages')
    })
  })

  describe('isNextjsInternalPath', () => {
    it('should return true for _N_E/ paths', () => {
      expect(isNextjsInternalPath('_N_E/src/app/page.tsx')).toBe(true)
      expect(isNextjsInternalPath('_N_E/./src/utils.ts')).toBe(true)
    })

    it('should return false for non-internal paths', () => {
      expect(isNextjsInternalPath('src/app/page.tsx')).toBe(false)
      expect(isNextjsInternalPath('./src/utils.ts')).toBe(false)
      expect(isNextjsInternalPath('webpack://_N_E/./src/app.tsx')).toBe(false)
    })
  })

  describe('stripNextjsPrefix', () => {
    it('should remove _N_E/ prefix', () => {
      expect(stripNextjsPrefix('_N_E/src/app/page.tsx')).toBe('src/app/page.tsx')
      expect(stripNextjsPrefix('_N_E/./src/utils.ts')).toBe('./src/utils.ts')
    })

    it('should return unchanged if no prefix', () => {
      expect(stripNextjsPrefix('src/app/page.tsx')).toBe('src/app/page.tsx')
      expect(stripNextjsPrefix('./src/utils.ts')).toBe('./src/utils.ts')
    })
  })
})
