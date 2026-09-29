import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { evaluateConfig, loadConfig, validateConfig } from './loader.js'

describe('validateConfig', async () => {
  it('validates an in-memory config object synchronously (no extends resolution)', async () => {
    const config = validateConfig({
      repoTopology: 'monorepo',
      packageManager: 'pnpm',
      taskRunner: 'turbo',
    })
    expect(config.schema).toBe('zod')
  })

  it('throws on an invalid object', async () => {
    expect(() => validateConfig({ repoTopology: 'nope' })).toThrow()
  })
})

describe('evaluateConfig', async () => {
  it('resolves an in-memory config object (no extends) against ConfigSchema', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'my-tool-config-'))
    const config = await evaluateConfig(
      {
        repoTopology: 'monorepo',
        packageManager: 'pnpm',
        taskRunner: 'turbo',
      },
      dir,
    )
    expect(config.schema).toBe('zod')
  })

  it('throws on an invalid object', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'my-tool-config-'))
    await expect(evaluateConfig({ repoTopology: 'nope' }, dir)).rejects.toThrow()
  })
})

describe('loadConfig', { timeout: 20000 }, async () => {
  it('evaluates an executable config module and validates its default export', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'my-tool-config-'))
    const file = join(dir, 'my-tool.config.ts')
    writeFileSync(
      file,
      [
        'const config = {',
        "  repoTopology: 'single-package' as const,",
        "  packageManager: 'pnpm' as const,",
        "  taskRunner: 'none' as const,",
        '}',
        'export default config',
        '',
      ].join('\n'),
    )

    const config = await loadConfig(file)
    expect(config.repoTopology).toBe('single-package')
    expect(config.packageManager).toBe('pnpm')
  })

  it("evaluates a scaffolded config that imports defineConfig from the bare 'my-tool' specifier", async () => {
    // The shape the scaffold actually writes (see renderConfigFile): the config
    // imports defineConfig from 'my-tool'. In a temp repo with no node_modules,
    // this loads only if the authoring-jiti alias maps 'my-tool' to the engine
    // barrel — the masked-defect case. The published 'my-tool' entry also runs
    // the CLI on import, which the alias deliberately bypasses.
    const dir = mkdtempSync(join(tmpdir(), 'my-tool-config-'))
    const file = join(dir, 'my-tool.config.ts')
    writeFileSync(
      file,
      [
        "import { defineConfig } from 'my-tool'",
        '',
        'export default defineConfig({',
        "  repoTopology: 'single-package',",
        "  packageManager: 'pnpm',",
        "  taskRunner: 'none',",
        "  schema: 'zod',",
        "  capabilities: { 'ts-package': '@my-tool/ts-package' },",
        '})',
        '',
      ].join('\n'),
    )

    const config = await loadConfig(file)
    expect(config.repoTopology).toBe('single-package')
    expect(config.capabilities).toEqual({ 'ts-package': '@my-tool/ts-package' })
  })

  it('rejects a module whose export is not a valid config', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'my-tool-config-'))
    const file = join(dir, 'my-tool.config.ts')
    writeFileSync(file, 'export default { repoTopology: "bogus" }\n')
    await expect(loadConfig(file)).rejects.toThrow()
  })
})
