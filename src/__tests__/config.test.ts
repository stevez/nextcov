import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import {
  resolveNextcovConfig,
  clearConfigCache,
  normalizePath,
  loadNextcovConfig,
  isPathWithinBase,
  DEFAULT_NEXTCOV_CONFIG,
  DEFAULT_INCLUDE_PATTERNS,
  DEFAULT_EXCLUDE_PATTERNS,
  DEFAULT_REPORTERS,
  DEFAULT_WATERMARKS,
  COVERAGE_FINAL_JSON,
} from '../config.js'

describe('config', () => {
  beforeEach(() => {
    clearConfigCache()
  })

  describe('DEFAULT_NEXTCOV_CONFIG', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_NEXTCOV_CONFIG.cdpPort).toBe(9230)
      expect(DEFAULT_NEXTCOV_CONFIG.buildDir).toBe('.next')
      expect(DEFAULT_NEXTCOV_CONFIG.outputDir).toBe('coverage/e2e')
      expect(DEFAULT_NEXTCOV_CONFIG.collectServer).toBe(true)
      expect(DEFAULT_NEXTCOV_CONFIG.collectClient).toBe(true)
      expect(DEFAULT_NEXTCOV_CONFIG.sourceRoot).toBe('./src')
    })

    it('should have default include patterns', () => {
      expect(DEFAULT_INCLUDE_PATTERNS).toEqual(['src/**/*.{ts,tsx,js,jsx}'])
    })

    it('should have default exclude patterns', () => {
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('src/**/__tests__/**')
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('src/**/*.test.{ts,tsx}')
    })

    it('should have default reporters', () => {
      expect(DEFAULT_REPORTERS).toContain('html')
      expect(DEFAULT_REPORTERS).toContain('lcov')
      expect(DEFAULT_REPORTERS).toContain('json')
      expect(DEFAULT_REPORTERS).toContain('text-summary')
    })

    it('should have default watermarks', () => {
      expect(DEFAULT_WATERMARKS.statements).toEqual([50, 80])
      expect(DEFAULT_WATERMARKS.functions).toEqual([50, 80])
      expect(DEFAULT_WATERMARKS.branches).toEqual([50, 80])
      expect(DEFAULT_WATERMARKS.lines).toEqual([50, 80])
    })
  })

  describe('resolveNextcovConfig', () => {
    it('should return defaults when no config provided', () => {
      const config = resolveNextcovConfig()

      expect(config.cdpPort).toBe(DEFAULT_NEXTCOV_CONFIG.cdpPort)
      expect(config.buildDir).toBe(DEFAULT_NEXTCOV_CONFIG.buildDir)
      expect(config.outputDir).toBe(DEFAULT_NEXTCOV_CONFIG.outputDir)
      expect(config.collectServer).toBe(true)
      expect(config.collectClient).toBe(true)
    })

    it('should override defaults with provided config', () => {
      const config = resolveNextcovConfig({
        cdpPort: 9999,
        buildDir: '.custom-next',
        outputDir: 'custom-coverage',
        collectServer: false,
        collectClient: false,
      })

      expect(config.cdpPort).toBe(9999)
      expect(config.buildDir).toBe('.custom-next')
      expect(config.outputDir).toBe('custom-coverage')
      expect(config.collectServer).toBe(false)
      expect(config.collectClient).toBe(false)
    })

    it('should set cacheDir based on outputDir', () => {
      const config = resolveNextcovConfig({
        outputDir: 'my-coverage',
      })

      expect(config.cacheDir).toBe(join('my-coverage', '.cache'))
    })

    it('should allow partial config override', () => {
      const config = resolveNextcovConfig({
        cdpPort: 8888,
      })

      expect(config.cdpPort).toBe(8888)
      expect(config.buildDir).toBe(DEFAULT_NEXTCOV_CONFIG.buildDir)
      expect(config.outputDir).toBe(DEFAULT_NEXTCOV_CONFIG.outputDir)
    })

    it('should allow custom include/exclude patterns', () => {
      const config = resolveNextcovConfig({
        include: ['app/**/*.ts'],
        exclude: ['app/**/*.spec.ts'],
      })

      expect(config.include).toEqual(['app/**/*.ts'])
      expect(config.exclude).toEqual(['app/**/*.spec.ts'])
    })

    it('should allow custom reporters', () => {
      const config = resolveNextcovConfig({
        reporters: ['json', 'text'],
      })

      expect(config.reporters).toEqual(['json', 'text'])
    })
  })

  describe('normalizePath', () => {
    it('should convert backslashes to forward slashes', () => {
      expect(normalizePath('src\\components\\Button.tsx')).toBe('src/components/Button.tsx')
    })

    it('should leave forward slashes unchanged', () => {
      expect(normalizePath('src/components/Button.tsx')).toBe('src/components/Button.tsx')
    })

    it('should handle mixed slashes', () => {
      expect(normalizePath('src\\components/Button.tsx')).toBe('src/components/Button.tsx')
    })

    it('should handle empty string', () => {
      expect(normalizePath('')).toBe('')
    })
  })

  describe('clearConfigCache', () => {
    it('should clear the cached config', () => {
      // This test mainly ensures the function doesn't throw
      clearConfigCache()
      expect(true).toBe(true)
    })
  })
})

describe('config - edge cases', () => {
  beforeEach(() => {
    clearConfigCache()
  })

  it('should handle all watermarks properties', () => {
    const config = resolveNextcovConfig()
    expect(config.include).toEqual(DEFAULT_INCLUDE_PATTERNS)
    expect(config.exclude).toEqual(DEFAULT_EXCLUDE_PATTERNS)
    expect(config.reporters).toEqual(DEFAULT_REPORTERS)
  })

  it('should set default cacheDir from default outputDir', () => {
    const config = resolveNextcovConfig()
    expect(config.cacheDir).toBe(join(DEFAULT_NEXTCOV_CONFIG.outputDir, '.cache'))
  })

  it('should handle custom sourceRoot', () => {
    const config = resolveNextcovConfig({
      sourceRoot: './app',
    })
    expect(config.sourceRoot).toBe('./app')
  })

  it('should handle undefined values in config', () => {
    const config = resolveNextcovConfig({
      cdpPort: undefined,
      buildDir: undefined,
    })
    expect(config.cdpPort).toBe(DEFAULT_NEXTCOV_CONFIG.cdpPort)
    expect(config.buildDir).toBe(DEFAULT_NEXTCOV_CONFIG.buildDir)
  })

  it('should preserve all default config properties', () => {
    const config = resolveNextcovConfig({})
    expect(config.sourceRoot).toBe(DEFAULT_NEXTCOV_CONFIG.sourceRoot)
    expect(config.collectServer).toBe(DEFAULT_NEXTCOV_CONFIG.collectServer)
    expect(config.collectClient).toBe(DEFAULT_NEXTCOV_CONFIG.collectClient)
  })
})

describe('COVERAGE_FINAL_JSON', () => {
  it('should be coverage-final.json', () => {
    expect(COVERAGE_FINAL_JSON).toBe('coverage-final.json')
  })
})

describe('loadNextcovConfig', () => {
  beforeEach(() => {
    clearConfigCache()
  })

  afterEach(() => {
    clearConfigCache()
  })

  it('should return defaults when config file does not exist', async () => {
    const config = await loadNextcovConfig('/non/existent/path.ts')

    expect(config.cdpPort).toBe(DEFAULT_NEXTCOV_CONFIG.cdpPort)
    expect(config.buildDir).toBe(DEFAULT_NEXTCOV_CONFIG.buildDir)
  })

  it('should cache config after first load', async () => {
    const config1 = await loadNextcovConfig('/non/existent/path.ts')
    const config2 = await loadNextcovConfig('/non/existent/path.ts')

    expect(config1).toBe(config2)
  })

  it('should load from different path if changed', async () => {
    const config1 = await loadNextcovConfig('/path/one.ts')
    clearConfigCache()
    const config2 = await loadNextcovConfig('/path/two.ts')

    // Both should return defaults since files don't exist
    expect(config1.cdpPort).toBe(config2.cdpPort)
  })
})

describe('isPathWithinBase', () => {
  it('should return true for paths within base directory', () => {
    expect(isPathWithinBase('/project/src/file.ts', '/project')).toBe(true)
    expect(isPathWithinBase('/project/src/nested/file.ts', '/project')).toBe(true)
  })

  it('should return true for the base directory itself', () => {
    expect(isPathWithinBase('/project', '/project')).toBe(true)
  })

  it('should return false for parent directory traversal', () => {
    expect(isPathWithinBase('/project/../etc/passwd', '/project')).toBe(false)
    expect(isPathWithinBase('../etc/passwd', '/project')).toBe(false)
  })

  it('should return false for paths outside base directory', () => {
    expect(isPathWithinBase('/other/file.ts', '/project')).toBe(false)
    expect(isPathWithinBase('/etc/passwd', '/project')).toBe(false)
  })

  it('should not match partial directory names', () => {
    // /project-other should not match /project
    expect(isPathWithinBase('/project-other/file.ts', '/project')).toBe(false)
    expect(isPathWithinBase('/projects/file.ts', '/project')).toBe(false)
  })

  it('should handle relative paths', () => {
    // Relative paths are resolved against cwd
    const cwd = process.cwd()
    expect(isPathWithinBase('src/file.ts', cwd)).toBe(true)
    expect(isPathWithinBase('./src/file.ts', cwd)).toBe(true)
  })

  it('should handle Windows-style paths', () => {
    // Test with backslashes (Windows paths)
    expect(isPathWithinBase('C:\\project\\src\\file.ts', 'C:\\project')).toBe(true)
    expect(isPathWithinBase('C:\\other\\file.ts', 'C:\\project')).toBe(false)
  })
})
