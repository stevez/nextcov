import { describe, it, expect } from 'vitest'
import {
  VITE_FS_PREFIX,
  isViteSourceUrl,
  isViteInternalUrl,
  extractViteFsPath,
  normalizeViteSourcePath,
} from '../vite.js'

describe('vite parser', () => {
  describe('VITE_FS_PREFIX', () => {
    it('should be /@fs/', () => {
      expect(VITE_FS_PREFIX).toBe('/@fs/')
    })
  })

  describe('isViteSourceUrl', () => {
    it('should return true for /src/ paths', () => {
      expect(isViteSourceUrl('/src/App.tsx')).toBe(true)
      expect(isViteSourceUrl('/src/components/Button.tsx')).toBe(true)
      expect(isViteSourceUrl('http://localhost:5173/src/main.ts')).toBe(true)
    })

    it('should return true for /@fs/ paths', () => {
      expect(isViteSourceUrl('/@fs/home/user/project/src/App.tsx')).toBe(true)
      expect(isViteSourceUrl('/@fs/C:/Users/dev/project/lib/utils.ts')).toBe(true)
    })

    it('should return false for /@vite/ paths', () => {
      expect(isViteSourceUrl('/@vite/client')).toBe(false)
      expect(isViteSourceUrl('/@vite/env')).toBe(false)
    })

    it('should return false for /@react-refresh paths', () => {
      expect(isViteSourceUrl('/@react-refresh')).toBe(false)
    })

    it('should return false for other paths', () => {
      expect(isViteSourceUrl('/node_modules/react/index.js')).toBe(false)
      expect(isViteSourceUrl('/api/users')).toBe(false)
    })
  })

  describe('isViteInternalUrl', () => {
    it('should return true for /@vite/ paths', () => {
      expect(isViteInternalUrl('/@vite/client')).toBe(true)
      expect(isViteInternalUrl('/@vite/env')).toBe(true)
    })

    it('should return true for /@react-refresh paths', () => {
      expect(isViteInternalUrl('/@react-refresh')).toBe(true)
    })

    it('should return false for source paths', () => {
      expect(isViteInternalUrl('/src/App.tsx')).toBe(false)
      expect(isViteInternalUrl('/@fs/home/user/project/src/App.tsx')).toBe(false)
    })
  })

  describe('extractViteFsPath', () => {
    it('should extract path from /@fs/ URL', () => {
      expect(extractViteFsPath('/@fs/home/user/project/src/App.tsx')).toBe('/home/user/project/src/App.tsx')
      expect(extractViteFsPath('/@fs/C:/Users/dev/project/lib/utils.ts')).toBe('/C:/Users/dev/project/lib/utils.ts')
    })

    it('should return null for non-/@fs/ URLs', () => {
      expect(extractViteFsPath('/src/App.tsx')).toBe(null)
      expect(extractViteFsPath('/@vite/client')).toBe(null)
    })
  })

  describe('normalizeViteSourcePath', () => {
    it('should remove /@fs/ prefix', () => {
      expect(normalizeViteSourcePath('/@fs/home/user/project/src/App.tsx')).toBe('/home/user/project/src/App.tsx')
    })

    it('should remove query strings', () => {
      expect(normalizeViteSourcePath('/src/App.tsx?v=12345')).toBe('/src/App.tsx')
      expect(normalizeViteSourcePath('/src/main.ts?t=1234567890')).toBe('/src/main.ts')
    })

    it('should handle combined transformations', () => {
      expect(normalizeViteSourcePath('/@fs/home/user/project/src/App.tsx?v=12345')).toBe('/home/user/project/src/App.tsx')
    })

    it('should return unchanged for simple paths', () => {
      expect(normalizeViteSourcePath('/src/App.tsx')).toBe('/src/App.tsx')
    })
  })
})
