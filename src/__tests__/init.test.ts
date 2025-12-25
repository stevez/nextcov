import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import {
  parseInitArgs,
  INIT_HELP,
  executeInit,
  type InitOptions,
} from '../init.js'

// Mock fs module
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  }
})

describe('init command', () => {
  describe('INIT_HELP constant', () => {
    it('should contain usage information', () => {
      expect(INIT_HELP).toContain('npx nextcov init')
      expect(INIT_HELP).toContain('Usage:')
      expect(INIT_HELP).toContain('Options:')
    })

    it('should contain option descriptions', () => {
      expect(INIT_HELP).toContain('--e2e-dir')
      expect(INIT_HELP).toContain('--js')
      expect(INIT_HELP).toContain('--force')
      expect(INIT_HELP).toContain('--help')
      expect(INIT_HELP).toContain('--yes')
      expect(INIT_HELP).toContain('--client-only')
    })

    it('should contain examples', () => {
      expect(INIT_HELP).toContain('Examples:')
      expect(INIT_HELP).toContain('npx nextcov init')
      expect(INIT_HELP).toContain('npx nextcov init --js')
      expect(INIT_HELP).toContain('npx nextcov init -y')
    })
  })

  describe('parseInitArgs', () => {
    describe('help flags', () => {
      it('should return showHelp for --help', () => {
        const result = parseInitArgs(['--help'])

        expect(result.showHelp).toBe(true)
        expect(result.error).toBeUndefined()
        expect(result.options).toBeUndefined()
      })

      it('should return showHelp for -h', () => {
        const result = parseInitArgs(['-h'])

        expect(result.showHelp).toBe(true)
        expect(result.error).toBeUndefined()
      })

      it('should return showHelp when --help is mixed with other args', () => {
        const result = parseInitArgs(['--force', '--help'])

        expect(result.showHelp).toBe(true)
      })
    })

    describe('default options', () => {
      it('should use default e2e directory', () => {
        const result = parseInitArgs([])

        expect(result.options).toBeDefined()
        expect(result.options!.e2eDir).toBe('e2e')
      })

      it('should default to TypeScript', () => {
        const result = parseInitArgs([])

        expect(result.options).toBeDefined()
        expect(result.options!.typescript).toBe(true)
      })

      it('should default force to false', () => {
        const result = parseInitArgs([])

        expect(result.options).toBeDefined()
        expect(result.options!.force).toBe(false)
      })

      it('should default interactive to true', () => {
        const result = parseInitArgs([])

        expect(result.options).toBeDefined()
        expect(result.options!.interactive).toBe(true)
      })
    })

    describe('--e2e-dir option', () => {
      it('should parse --e2e-dir option', () => {
        const result = parseInitArgs(['--e2e-dir', 'tests'])

        expect(result.options).toBeDefined()
        expect(result.options!.e2eDir).toBe('tests')
      })

      it('should error when --e2e-dir has no value', () => {
        const result = parseInitArgs(['--e2e-dir'])

        expect(result.error).toBe('Missing value for --e2e-dir')
        expect(result.options).toBeUndefined()
      })
    })

    describe('--force option', () => {
      it('should parse --force option', () => {
        const result = parseInitArgs(['--force'])

        expect(result.options).toBeDefined()
        expect(result.options!.force).toBe(true)
      })
    })

    describe('--js option', () => {
      it('should parse --js option', () => {
        const result = parseInitArgs(['--js'])

        expect(result.options).toBeDefined()
        expect(result.options!.typescript).toBe(false)
      })
    })

    describe('--yes option', () => {
      it('should parse --yes option', () => {
        const result = parseInitArgs(['--yes'])

        expect(result.options).toBeDefined()
        expect(result.options!.interactive).toBe(false)
      })

      it('should parse -y option', () => {
        const result = parseInitArgs(['-y'])

        expect(result.options).toBeDefined()
        expect(result.options!.interactive).toBe(false)
      })
    })

    describe('--client-only option', () => {
      it('should parse --client-only option', () => {
        const result = parseInitArgs(['--client-only'])

        expect(result.options).toBeDefined()
        expect(result.options!.collectServer).toBe(false)
      })

      it('should default collectServer to true', () => {
        const result = parseInitArgs([])

        expect(result.options).toBeDefined()
        expect(result.options!.collectServer).toBe(true)
      })
    })

    describe('unknown options', () => {
      it('should error for unknown option', () => {
        const result = parseInitArgs(['--unknown'])

        expect(result.error).toBe('Unknown option: --unknown')
        expect(result.showHelp).toBe(true)
      })

      it('should error for unexpected positional argument', () => {
        const result = parseInitArgs(['some-arg'])

        expect(result.error).toBe('Unexpected argument: some-arg')
        expect(result.showHelp).toBe(true)
      })
    })

    describe('combined options', () => {
      it('should parse multiple options together', () => {
        const result = parseInitArgs(['--e2e-dir', 'tests', '--force', '--js', '-y'])

        expect(result.options).toBeDefined()
        expect(result.options!.e2eDir).toBe('tests')
        expect(result.options!.force).toBe(true)
        expect(result.options!.typescript).toBe(false)
        expect(result.options!.interactive).toBe(false)
        expect(result.options!.collectServer).toBe(true) // default
      })

      it('should parse --client-only with other options', () => {
        const result = parseInitArgs(['--client-only', '--force', '-y'])

        expect(result.options).toBeDefined()
        expect(result.options!.collectServer).toBe(false)
        expect(result.options!.force).toBe(true)
        expect(result.options!.interactive).toBe(false)
      })
    })
  })

  describe('executeInit', () => {
    const originalCwd = process.cwd
    const mockCwd = '/project'

    beforeEach(() => {
      vi.clearAllMocks()
      process.cwd = vi.fn().mockReturnValue(mockCwd)
      // Suppress console output during tests
      vi.spyOn(console, 'log').mockImplementation(() => {})
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      process.cwd = originalCwd
    })

    describe('TypeScript mode', () => {
      it('should detect existing playwright.config.ts', async () => {
        // Mock playwright.config.ts exists
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          if (pathStr.includes('playwright.config.js')) return false
          return false
        })
        vi.mocked(readFileSync).mockReturnValue(`
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
})
`)

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: false,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        const result = await executeInit(options)

        expect(result.success).toBe(true)
        // Should create files with .ts extension
        expect(vi.mocked(writeFileSync)).toHaveBeenCalled()
      })

      it('should create global-setup.ts with correct content', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          return false
        })
        vi.mocked(readFileSync).mockReturnValue(`
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`)

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        await executeInit(options)

        // Find the call that creates global-setup.ts
        const calls = vi.mocked(writeFileSync).mock.calls
        const globalSetupCall = calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('global-setup.ts')
        )

        expect(globalSetupCall).toBeDefined()
        expect(globalSetupCall![1]).toContain('initCoverage')
        expect(globalSetupCall![1]).toContain('loadNextcovConfig')
        expect(globalSetupCall![1]).toContain("playwright.config.ts')")
      })

      it('should create global-teardown.ts with correct content', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          return false
        })
        vi.mocked(readFileSync).mockReturnValue(`
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`)

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        await executeInit(options)

        const calls = vi.mocked(writeFileSync).mock.calls
        const globalTeardownCall = calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('global-teardown.ts')
        )

        expect(globalTeardownCall).toBeDefined()
        expect(globalTeardownCall![1]).toContain('finalizeCoverage')
        expect(globalTeardownCall![1]).toContain('loadNextcovConfig')
      })

      it('should create test-fixtures.ts with TypeScript interface', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          return false
        })
        vi.mocked(readFileSync).mockReturnValue(`
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`)

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        await executeInit(options)

        const calls = vi.mocked(writeFileSync).mock.calls
        const fixturesCall = calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('test-fixtures.ts')
        )

        expect(fixturesCall).toBeDefined()
        expect(fixturesCall![1]).toContain('interface TestFixtures')
        expect(fixturesCall![1]).toContain('collectClientCoverage')
      })
    })

    describe('JavaScript mode', () => {
      it('should detect existing playwright.config.js', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return false
          if (pathStr.includes('playwright.config.js')) return true
          if (pathStr.includes('next.config.js')) return true
          return false
        })
        vi.mocked(readFileSync).mockReturnValue(`
const { defineConfig } = require('@playwright/test')
module.exports = defineConfig({})
`)

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: false,
          typescript: false,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        const result = await executeInit(options)

        expect(result.success).toBe(true)
      })

      it('should create test-fixtures.js without TypeScript interface', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.js')) return true
          if (pathStr.includes('next.config.js')) return true
          return false
        })
        vi.mocked(readFileSync).mockReturnValue(`
const { defineConfig } = require('@playwright/test')
module.exports = defineConfig({})
`)

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: false,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        await executeInit(options)

        const calls = vi.mocked(writeFileSync).mock.calls
        const fixturesCall = calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('test-fixtures.js')
        )

        expect(fixturesCall).toBeDefined()
        expect(fixturesCall![1]).not.toContain('interface TestFixtures')
        expect(fixturesCall![1]).toContain('collectClientCoverage')
      })
    })

    describe('file skipping', () => {
      it('should skip existing files when force is false', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          // Exclude babel and jest config files
          if (pathStr.includes('babel') || pathStr.includes('.babelrc')) return false
          if (pathStr.includes('jest.config')) return false
          return true
        })
        vi.mocked(readFileSync).mockReturnValue(`
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`)

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: false,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        const result = await executeInit(options)

        expect(result.skipped.length).toBeGreaterThan(0)
      })

      it('should overwrite existing files when force is true', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          // Exclude babel and jest config files
          if (pathStr.includes('babel') || pathStr.includes('.babelrc')) return false
          if (pathStr.includes('jest.config')) return false
          return true
        })
        vi.mocked(readFileSync).mockReturnValue(`
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`)

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        const result = await executeInit(options)

        expect(result.created.length).toBeGreaterThan(0)
      })
    })

    describe('playwright.config modification', () => {
      it('should add NextcovConfig import to playwright.config.ts', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          return false
        })
        vi.mocked(readFileSync).mockReturnValue(`
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
})
`)

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        await executeInit(options)

        const calls = vi.mocked(writeFileSync).mock.calls
        const configCall = calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('playwright.config.ts')
        )

        expect(configCall).toBeDefined()
        expect(configCall![1]).toContain("import type { NextcovConfig } from 'nextcov'")
      })

      it('should add globalSetup and globalTeardown to config', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          return false
        })
        vi.mocked(readFileSync).mockReturnValue(`
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
})
`)

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        await executeInit(options)

        const calls = vi.mocked(writeFileSync).mock.calls
        const configCall = calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('playwright.config.ts')
        )

        expect(configCall).toBeDefined()
        expect(configCall![1]).toContain('globalSetup:')
        expect(configCall![1]).toContain('globalTeardown:')
      })

      it('should add nextcov config object', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          return false
        })
        vi.mocked(readFileSync).mockReturnValue(`
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
})
`)

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        await executeInit(options)

        const calls = vi.mocked(writeFileSync).mock.calls
        const configCall = calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('playwright.config.ts')
        )

        expect(configCall).toBeDefined()
        expect(configCall![1]).toContain('export const nextcov: NextcovConfig')
        expect(configCall![1]).toContain('cdpPort:')
        expect(configCall![1]).toContain('outputDir:')
        expect(configCall![1]).toContain('reporters:')
      })

      it('should skip config modification if already configured', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          return false
        })
        vi.mocked(readFileSync).mockReturnValue(`
import { defineConfig } from '@playwright/test'
import type { NextcovConfig } from 'nextcov'

export const nextcov: NextcovConfig = { cdpPort: 9230 }

export default defineConfig({
  testDir: './e2e',
})
`)

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        const result = await executeInit(options)

        // Config should not be in modified list since it's already configured
        const configModified = result.modified.some((f) => f.includes('playwright.config'))
        expect(configModified).toBe(false)
      })
    })

    describe('package.json modification', () => {
      it('should add npm scripts to package.json', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          if (pathStr.includes('package.json')) return true
          return false
        })
        vi.mocked(readFileSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('package.json')) {
            return JSON.stringify({
              name: 'test-project',
              scripts: {},
            })
          }
          return `
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`
        })

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        await executeInit(options)

        const calls = vi.mocked(writeFileSync).mock.calls
        const pkgCall = calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('package.json')
        )

        expect(pkgCall).toBeDefined()
        const pkgContent = JSON.parse(pkgCall![1] as string)
        expect(pkgContent.scripts['dev:e2e']).toBeDefined()
        expect(pkgContent.scripts['build:e2e']).toBeDefined()
        expect(pkgContent.scripts['start:e2e']).toBeDefined()
        expect(pkgContent.scripts['test:e2e']).toBeDefined()
        expect(pkgContent.scripts['coverage:merge']).toBeDefined()
        expect(pkgContent.devDependencies['start-server-and-test']).toBeDefined()
      })

      it('should add browserslist to package.json', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          if (pathStr.includes('package.json')) return true
          return false
        })
        vi.mocked(readFileSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('package.json')) {
            return JSON.stringify({
              name: 'test-project',
              scripts: {},
            })
          }
          return `
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`
        })

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        await executeInit(options)

        const calls = vi.mocked(writeFileSync).mock.calls
        const pkgCall = calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('package.json')
        )

        expect(pkgCall).toBeDefined()
        const pkgContent = JSON.parse(pkgCall![1] as string)
        expect(pkgContent.browserslist).toBeDefined()
        expect(pkgContent.browserslist).toContain('chrome 111')
      })

      it('should skip package.json modification if scripts already exist', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          if (pathStr.includes('package.json')) return true
          return false
        })
        vi.mocked(readFileSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('package.json')) {
            return JSON.stringify({
              name: 'test-project',
              scripts: {
                'dev:e2e': 'existing',
                'build:e2e': 'existing',
                'start:local': 'existing',
                'start:e2e': 'existing',
                'test:e2e': 'existing',
                'coverage:merge': 'existing',
              },
              devDependencies: {
                'cross-env': '^7.0.0',
                'start-server-and-test': '^2.0.0',
                'concurrently': '^8.0.0',
              },
              browserslist: ['chrome 100'],
            })
          }
          return `
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`
        })

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        const result = await executeInit(options)

        // package.json should not be in modified list
        const pkgModified = result.modified.some((f) => f.includes('package.json'))
        expect(pkgModified).toBe(false)
      })
    })

    describe('next.config modification', () => {
      it('should modify next.config.ts with E2E mode settings', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          if (pathStr.includes('package.json')) return true
          return false
        })
        vi.mocked(readFileSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('next.config.ts')) {
            return `import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
}

export default nextConfig
`
          }
          if (pathStr.includes('package.json')) {
            return JSON.stringify({ name: 'test', scripts: {} })
          }
          return `
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`
        })

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        await executeInit(options)

        const calls = vi.mocked(writeFileSync).mock.calls
        const nextConfigCall = calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('next.config.ts')
        )

        expect(nextConfigCall).toBeDefined()
        expect(nextConfigCall![1]).toContain('isE2EMode')
        expect(nextConfigCall![1]).toContain('E2E_MODE')
        expect(nextConfigCall![1]).toContain('productionBrowserSourceMaps')
      })

      it('should modify next.config.js with E2E mode settings', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return false
          if (pathStr.includes('next.config.mjs')) return false
          if (pathStr.includes('next.config.js')) return true
          if (pathStr.includes('package.json')) return true
          return false
        })
        vi.mocked(readFileSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('next.config.js')) {
            return `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
}

module.exports = nextConfig
`
          }
          if (pathStr.includes('package.json')) {
            return JSON.stringify({ name: 'test', scripts: {} })
          }
          return `
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`
        })

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        await executeInit(options)

        const calls = vi.mocked(writeFileSync).mock.calls
        const nextConfigCall = calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('next.config.js')
        )

        expect(nextConfigCall).toBeDefined()
        expect(nextConfigCall![1]).toContain('isE2EMode')
        expect(nextConfigCall![1]).toContain('E2E_MODE')
      })

      it('should add webpack config when not present', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          if (pathStr.includes('package.json')) return true
          return false
        })
        vi.mocked(readFileSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('next.config.ts')) {
            return `import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
}

export default nextConfig
`
          }
          if (pathStr.includes('package.json')) {
            return JSON.stringify({ name: 'test', scripts: {} })
          }
          return `
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`
        })

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        await executeInit(options)

        const calls = vi.mocked(writeFileSync).mock.calls
        const nextConfigCall = calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('next.config.ts')
        )

        expect(nextConfigCall).toBeDefined()
        expect(nextConfigCall![1]).toContain('webpack:')
        expect(nextConfigCall![1]).toContain('source-map')
        expect(nextConfigCall![1]).toContain('minimize: false')
      })

      it('should skip next.config modification if already configured', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          if (pathStr.includes('package.json')) return true
          return false
        })
        vi.mocked(readFileSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('next.config.ts')) {
            return `import type { NextConfig } from 'next'

const isE2EMode = process.env.E2E_MODE === 'true'

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: isE2EMode,
}

export default nextConfig
`
          }
          if (pathStr.includes('package.json')) {
            return JSON.stringify({ name: 'test', scripts: {} })
          }
          return `
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`
        })

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        const result = await executeInit(options)

        // next.config should not be in modified list
        const nextConfigModified = result.modified.some((f) => f.includes('next.config'))
        expect(nextConfigModified).toBe(false)
      })

    })

    describe('Playwright detection', () => {
      it('should fail when playwright.config is not found', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          // No playwright config exists
          if (pathStr.includes('playwright.config')) return false
          return false
        })

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        const result = await executeInit(options)

        expect(result.success).toBe(false)
        expect(result.error).toBe('Playwright is not set up')
        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining('Playwright is not set up')
        )
      })
    })

    describe('Next.js config detection', () => {
      it('should fail when next.config is not found', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          // No next.config exists
          if (pathStr.includes('next.config')) return false
          return false
        })

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        const result = await executeInit(options)

        expect(result.success).toBe(false)
        expect(result.error).toBe('Next.js config not found')
        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining('Next.js config not found')
        )
      })
    })

    describe('Babel detection', () => {
      it('should fail when babel.config.js is found', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('babel.config.js')) return true
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          return false
        })

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        const result = await executeInit(options)

        expect(result.success).toBe(false)
        expect(result.error).toBe('Babel is not supported')
        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining('Babel is not supported')
        )
      })

      it('should fail when .babelrc is found', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('.babelrc') && !pathStr.includes('.babelrc.')) return true
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          return false
        })

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        const result = await executeInit(options)

        expect(result.success).toBe(false)
        expect(result.error).toBe('Babel is not supported')
      })

      it('should fail when package.json has babel field', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('package.json')) return true
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          return false
        })
        vi.mocked(readFileSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('package.json')) {
            return JSON.stringify({
              name: 'test',
              babel: {
                presets: ['next/babel'],
              },
            })
          }
          return `
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`
        })

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        const result = await executeInit(options)

        expect(result.success).toBe(false)
        expect(result.error).toBe('Babel is not supported')
      })

      it('should proceed when no Babel config is found', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('babel')) return false
          if (pathStr.includes('.babelrc')) return false
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          if (pathStr.includes('package.json')) return true
          return false
        })
        vi.mocked(readFileSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('package.json')) {
            return JSON.stringify({ name: 'test', scripts: {} })
          }
          return `
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`
        })

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        const result = await executeInit(options)

        expect(result.success).toBe(true)
      })
    })

    describe('Jest detection', () => {
      it('should fail when jest.config.js is found and mergeCoverage is true', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('jest.config.js')) return true
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          return false
        })

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        const result = await executeInit(options)

        expect(result.success).toBe(false)
        expect(result.error).toBe('Jest is not supported')
        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining('Jest is not supported')
        )
      })

      it('should fail when package.json has jest field and mergeCoverage is true', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('package.json')) return true
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          return false
        })
        vi.mocked(readFileSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('package.json')) {
            return JSON.stringify({
              name: 'test',
              jest: {
                testEnvironment: 'jsdom',
              },
            })
          }
          return `
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`
        })

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        const result = await executeInit(options)

        expect(result.success).toBe(false)
        expect(result.error).toBe('Jest is not supported')
      })

      it('should allow Jest when mergeCoverage is false', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('jest.config.js')) return true
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          if (pathStr.includes('package.json')) return true
          return false
        })
        vi.mocked(readFileSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('package.json')) {
            return JSON.stringify({ name: 'test', scripts: {} })
          }
          return `
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`
        })

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: false,
          collectServer: true,
        }

        const result = await executeInit(options)

        expect(result.success).toBe(true)
      })
    })

    describe('mergeCoverage option', () => {
      it('should add coverage:merge script when mergeCoverage is true', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          if (pathStr.includes('package.json')) return true
          return false
        })
        vi.mocked(readFileSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('package.json')) {
            return JSON.stringify({ name: 'test', scripts: {} })
          }
          return `
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`
        })

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        await executeInit(options)

        const calls = vi.mocked(writeFileSync).mock.calls
        const pkgCall = calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('package.json')
        )

        expect(pkgCall).toBeDefined()
        const pkgContent = JSON.parse(pkgCall![1] as string)
        expect(pkgContent.scripts['coverage:merge']).toBeDefined()
      })

      it('should NOT add coverage:merge script when mergeCoverage is false', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          if (pathStr.includes('package.json')) return true
          return false
        })
        vi.mocked(readFileSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('package.json')) {
            return JSON.stringify({ name: 'test', scripts: {} })
          }
          return `
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`
        })

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: false,
          collectServer: true,
        }

        await executeInit(options)

        const calls = vi.mocked(writeFileSync).mock.calls
        const pkgCall = calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('package.json')
        )

        expect(pkgCall).toBeDefined()
        const pkgContent = JSON.parse(pkgCall![1] as string)
        expect(pkgContent.scripts['coverage:merge']).toBeUndefined()
      })
    })

    describe('custom e2e directory', () => {
      it('should create files in custom e2e directory', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          return false
        })
        vi.mocked(readFileSync).mockReturnValue(`
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`)

        const options: InitOptions = {
          e2eDir: 'tests/e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        await executeInit(options)

        const calls = vi.mocked(writeFileSync).mock.calls
        // Use platform-agnostic check (path separators differ on Windows)
        const globalSetupCall = calls.find(
          (call) => typeof call[0] === 'string' &&
            call[0].includes('tests') &&
            call[0].includes('e2e') &&
            call[0].includes('global-setup.ts')
        )

        expect(globalSetupCall).toBeDefined()
      })

      it('should reference custom e2e directory in playwright.config', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          return false
        })
        vi.mocked(readFileSync).mockReturnValue(`
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`)

        const options: InitOptions = {
          e2eDir: 'tests/e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: true,
        }

        await executeInit(options)

        const calls = vi.mocked(writeFileSync).mock.calls
        const configCall = calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('playwright.config.ts')
        )

        expect(configCall).toBeDefined()
        expect(configCall![1]).toContain('./tests/e2e/global-setup.ts')
        expect(configCall![1]).toContain('./tests/e2e/global-teardown.ts')
      })
    })

    describe('client-only mode (collectServer: false)', () => {
      it('should create global-setup.ts in client-only mode (needed for initCoverage)', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          return false
        })
        vi.mocked(readFileSync).mockReturnValue(`
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`)

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: false, // Client-only mode
        }

        await executeInit(options)

        const calls = vi.mocked(writeFileSync).mock.calls
        const globalSetupCall = calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('global-setup.ts')
        )

        // global-setup.ts IS created for client-only mode (initCoverage is needed for both modes)
        expect(globalSetupCall).toBeDefined()
        expect(globalSetupCall![1]).toContain('initCoverage')
      })

      it('should still create global-teardown.ts in client-only mode', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          return false
        })
        vi.mocked(readFileSync).mockReturnValue(`
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`)

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: false,
        }

        await executeInit(options)

        const calls = vi.mocked(writeFileSync).mock.calls
        const globalTeardownCall = calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('global-teardown.ts')
        )

        expect(globalTeardownCall).toBeDefined()
        expect(globalTeardownCall![1]).toContain('finalizeCoverage')
        expect(globalTeardownCall![1]).toContain('client-side coverage only')
      })

      it('should add collectServer: false to playwright.config in client-only mode', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          return false
        })
        vi.mocked(readFileSync).mockReturnValue(`
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
})
`)

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: false,
        }

        await executeInit(options)

        const calls = vi.mocked(writeFileSync).mock.calls
        const configCall = calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('playwright.config.ts')
        )

        expect(configCall).toBeDefined()
        expect(configCall![1]).toContain('collectServer: false')
        expect(configCall![1]).toContain('Client-only mode')
      })

      it('should add both globalSetup and globalTeardown to playwright.config in client-only mode', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          return false
        })
        vi.mocked(readFileSync).mockReturnValue(`
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
})
`)

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: false,
        }

        await executeInit(options)

        const calls = vi.mocked(writeFileSync).mock.calls
        const configCall = calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('playwright.config.ts')
        )

        // Both globalSetup and globalTeardown are needed for client-only mode
        // globalSetup runs initCoverage, globalTeardown runs finalizeCoverage
        expect(configCall).toBeDefined()
        expect(configCall![1]).toContain('globalSetup:')
        expect(configCall![1]).toContain('globalTeardown:')
      })

      it('should add simpler dev:e2e script without --inspect in client-only mode (Next.js project)', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          if (pathStr.includes('next.config.ts')) return true
          if (pathStr.includes('package.json')) return true
          return false
        })
        vi.mocked(readFileSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('package.json')) {
            return JSON.stringify({
              name: 'test-project',
              scripts: {},
            })
          }
          return `
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`
        })

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: false,
        }

        await executeInit(options)

        const calls = vi.mocked(writeFileSync).mock.calls
        const pkgCall = calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('package.json')
        )

        expect(pkgCall).toBeDefined()
        const pkgContent = JSON.parse(pkgCall![1] as string)
        expect(pkgContent.scripts['dev:e2e']).toBeDefined()
        expect(pkgContent.scripts['dev:e2e']).not.toContain('--inspect')
        expect(pkgContent.scripts['dev:e2e']).toContain('E2E_MODE=true')
      })

      it('should not add e2e scripts in client-only mode without Next.js', async () => {
        vi.mocked(existsSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('playwright.config.ts')) return true
          // No next.config - not a Next.js project
          if (pathStr.includes('next.config')) return false
          if (pathStr.includes('package.json')) return true
          return false
        })
        vi.mocked(readFileSync).mockImplementation((path) => {
          const pathStr = String(path)
          if (pathStr.includes('package.json')) {
            return JSON.stringify({
              name: 'test-project',
              scripts: {},
            })
          }
          return `
import { defineConfig } from '@playwright/test'
export default defineConfig({})
`
        })

        const options: InitOptions = {
          e2eDir: 'e2e',
          force: true,
          typescript: true,
          interactive: false,
          mergeCoverage: true,
          collectServer: false, // Client-only mode
        }

        await executeInit(options)

        const calls = vi.mocked(writeFileSync).mock.calls
        const pkgCall = calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('package.json')
        )

        expect(pkgCall).toBeDefined()
        const pkgContent = JSON.parse(pkgCall![1] as string)
        // No Next.js scripts should be added
        expect(pkgContent.scripts['dev:e2e']).toBeUndefined()
        expect(pkgContent.scripts['build:e2e']).toBeUndefined()
        expect(pkgContent.scripts['start:local']).toBeUndefined()
        expect(pkgContent.scripts['start:e2e']).toBeUndefined()
        expect(pkgContent.scripts['test:e2e']).toBeUndefined()
        // But coverage:merge should still be added (mergeCoverage is true)
        expect(pkgContent.scripts['coverage:merge']).toBeDefined()
      })
    })
  })
})
