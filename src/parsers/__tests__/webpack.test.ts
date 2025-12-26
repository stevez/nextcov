import { describe, it, expect } from 'vitest'
import {
  isWebpackUrl,
  normalizeWebpackSourcePath,
  extractWebpackModulePath,
  containsSourceRoot,
} from '../webpack.js'

describe('webpack parser', () => {
  describe('isWebpackUrl', () => {
    it('should return true for webpack-internal URLs', () => {
      expect(isWebpackUrl('webpack-internal:///(rsc)/./src/app/page.tsx')).toBe(true)
      expect(isWebpackUrl('webpack-internal:///(ssr)/./src/components/Button.tsx')).toBe(true)
    })

    it('should return true for webpack:// URLs', () => {
      expect(isWebpackUrl('webpack://_N_E/./src/app/page.tsx')).toBe(true)
      expect(isWebpackUrl('webpack://my-app/./src/index.ts')).toBe(true)
      expect(isWebpackUrl('webpack:///./src/utils.ts')).toBe(true)
    })

    it('should return true for app-pages-browser URLs', () => {
      expect(isWebpackUrl('http://localhost:3000/(app-pages-browser)/./src/app/page.tsx')).toBe(true)
    })

    it('should return false for non-webpack URLs', () => {
      expect(isWebpackUrl('file:///home/user/project/src/app.ts')).toBe(false)
      expect(isWebpackUrl('/src/App.tsx')).toBe(false)
      expect(isWebpackUrl('http://localhost:3000/src/app.js')).toBe(false)
    })
  })

  describe('normalizeWebpackSourcePath', () => {
    it('should remove webpack:// prefix with app name', () => {
      expect(normalizeWebpackSourcePath('webpack://_N_E/./src/app/page.tsx')).toBe('src/app/page.tsx')
      expect(normalizeWebpackSourcePath('webpack://my-app/./src/index.ts')).toBe('src/index.ts')
    })

    it('should remove webpack:// prefix with empty app name', () => {
      expect(normalizeWebpackSourcePath('webpack:///./src/utils.ts')).toBe('src/utils.ts')
    })

    it('should remove _N_E/ prefix', () => {
      expect(normalizeWebpackSourcePath('_N_E/./src/app/page.tsx')).toBe('src/app/page.tsx')
      expect(normalizeWebpackSourcePath('_N_E/src/lib/utils.ts')).toBe('src/lib/utils.ts')
    })

    it('should remove query strings', () => {
      expect(normalizeWebpackSourcePath('src/app/page.tsx?xxxx')).toBe('src/app/page.tsx')
      expect(normalizeWebpackSourcePath('./src/app.ts?v=123&t=456')).toBe('src/app.ts')
    })

    it('should remove leading ./', () => {
      expect(normalizeWebpackSourcePath('./src/app/page.tsx')).toBe('src/app/page.tsx')
    })

    it('should decode URL-encoded paths', () => {
      expect(normalizeWebpackSourcePath('./src/components/My%20Component.tsx')).toBe('src/components/My Component.tsx')
    })

    it('should handle combined transformations', () => {
      expect(normalizeWebpackSourcePath('webpack://_N_E/./src/app/page.tsx?xxxx')).toBe('src/app/page.tsx')
    })
  })

  describe('extractWebpackModulePath', () => {
    it('should extract module path from webpack-internal URLs', () => {
      expect(extractWebpackModulePath('webpack-internal:///(rsc)/./src/app/layout.tsx')).toBe('./src/app/layout.tsx')
      expect(extractWebpackModulePath('webpack-internal:///(ssr)/./src/page.tsx')).toBe('./src/page.tsx')
    })

    it('should return null for non-webpack-internal URLs', () => {
      expect(extractWebpackModulePath('webpack://_N_E/./src/app.tsx')).toBe(null)
      expect(extractWebpackModulePath('/src/app.tsx')).toBe(null)
      expect(extractWebpackModulePath('file:///home/user/project/src/app.tsx')).toBe(null)
    })
  })

  describe('containsSourceRoot', () => {
    it('should match /src/ pattern', () => {
      expect(containsSourceRoot('webpack://_N_E/./src/app/page.tsx', 'src')).toBe(true)
      expect(containsSourceRoot('/home/user/project/src/utils.ts', 'src')).toBe(true)
    })

    it('should match /./src/ pattern', () => {
      expect(containsSourceRoot('webpack-internal:///(rsc)/./src/app/layout.tsx', 'src')).toBe(true)
    })

    it('should return false when source root not found', () => {
      expect(containsSourceRoot('webpack://_N_E/node_modules/lodash/index.js', 'src')).toBe(false)
      expect(containsSourceRoot('/lib/utils.ts', 'src')).toBe(false)
    })

    it('should work with different source roots', () => {
      expect(containsSourceRoot('/home/user/project/lib/utils.ts', 'lib')).toBe(true)
      expect(containsSourceRoot('/app/components/Button.tsx', 'app')).toBe(true)
    })
  })
})
