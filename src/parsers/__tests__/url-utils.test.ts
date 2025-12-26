import { describe, it, expect } from 'vitest'
import { toFileUrl, isNodeModulesPath } from '../url-utils.js'

describe('url-utils', () => {
  describe('toFileUrl', () => {
    it('should return unchanged if already a file:// URL', () => {
      expect(toFileUrl('file:///C:/Users/dev/project/src/app.ts')).toBe(
        'file:///C:/Users/dev/project/src/app.ts'
      )
      expect(toFileUrl('file:///home/user/project/src/app.ts')).toBe(
        'file:///home/user/project/src/app.ts'
      )
    })

    it('should convert Windows absolute paths', () => {
      expect(toFileUrl('C:\\Users\\dev\\project\\src\\app.ts')).toBe(
        'file:///C:/Users/dev/project/src/app.ts'
      )
      expect(toFileUrl('D:\\Projects\\my-app\\index.ts')).toBe(
        'file:///D:/Projects/my-app/index.ts'
      )
    })

    it('should convert Unix absolute paths', () => {
      expect(toFileUrl('/home/user/project/src/app.ts')).toBe(
        'file:///home/user/project/src/app.ts'
      )
      expect(toFileUrl('/var/www/app/index.js')).toBe(
        'file:///var/www/app/index.js'
      )
    })

    it('should convert relative paths with projectRoot', () => {
      expect(toFileUrl('src/app.ts', '/home/user/project')).toBe(
        'file:///home/user/project/src/app.ts'
      )
    })

    it('should convert relative Windows paths with projectRoot', () => {
      const result = toFileUrl('src\\app.ts', 'C:\\Users\\dev\\project')
      expect(result).toMatch(/^file:\/\/\/C:\/Users\/dev\/project/)
    })

    it('should handle relative paths without projectRoot', () => {
      expect(toFileUrl('src/app.ts')).toBe('file://src/app.ts')
    })
  })

  describe('isNodeModulesPath', () => {
    it('should return true for paths containing node_modules/', () => {
      expect(isNodeModulesPath('/home/user/project/node_modules/lodash/index.js')).toBe(true)
      expect(isNodeModulesPath('C:/Users/dev/project/node_modules/react/index.js')).toBe(true)
      expect(isNodeModulesPath('webpack://_N_E/./node_modules/axios/index.js')).toBe(true)
    })

    it('should return true for Windows paths with backslashes', () => {
      expect(isNodeModulesPath('C:\\Users\\dev\\project\\node_modules\\lodash\\index.js')).toBe(true)
    })

    it('should return false for paths without node_modules', () => {
      expect(isNodeModulesPath('/home/user/project/src/app.ts')).toBe(false)
      expect(isNodeModulesPath('src/components/Button.tsx')).toBe(false)
      expect(isNodeModulesPath('webpack://_N_E/./src/app/page.tsx')).toBe(false)
    })
  })
})
