import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveEffectiveConfig } from './preset-load.js'

/**
 * Write a definePreset module to `relPath` under `repoDir`. The module imports
 * @exadev/core by the workspace source path so jiti resolves it from the temp
 * dir without a node_modules install, exactly as the provider loader test does.
 * `body` is the object literal passed to definePreset.
 */
function writeLocalPreset(repoDir: string, relPath: string, body: string): void {
  const corePath = new URL('../index.js', import.meta.url).pathname
  const full = join(repoDir, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(
    full,
    [
      `import { definePreset } from '${corePath}'`,
      '',
      `export default definePreset(${body})`,
      '',
    ].join('\n'),
  )
}

/**
 * Write a definePreset module that imports definePreset from the BARE
 * '@exadev/core' specifier — the real-preset case. With no node_modules in the
 * temp repo, this loads ONLY if the authoring-jiti alias resolves '@exadev/core'
 * to the engine barrel. It does not, then jiti throws and the test fails.
 */
function writeBareSpecifierPreset(repoDir: string, relPath: string, body: string): void {
  const full = join(repoDir, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(
    full,
    [
      `import { definePreset } from '@exadev/core'`,
      '',
      `export default definePreset(${body})`,
      '',
    ].join('\n'),
  )
}

/** A minimal valid local config with all required substrate fields set. */
function configWith(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    repoTopology: 'single-package',
    packageManager: 'pnpm',
    taskRunner: 'none',
    ...extra,
  }
}

describe('resolveEffectiveConfig', { timeout: 20000 }, async () => {
  it('leaves a config with no extends unchanged', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'exadev-preset-'))
    const config = await resolveEffectiveConfig({
      config: configWith({ schema: 'zod', capabilities: { lint: 'self' } }),
      baseDir: repoDir,
    })
    expect(config).toEqual({
      repoTopology: 'single-package',
      packageManager: 'pnpm',
      taskRunner: 'none',
      schema: 'zod',
      capabilities: { lint: 'self' },
    })
    expect('extends' in config).toBe(false)
  })

  it('inherits a local-path preset bindings, and a local binding overrides it', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'exadev-preset-'))
    writeLocalPreset(
      repoDir,
      'presets/stack.ts',
      `{ taskRunner: 'turbo', schema: 'valibot', capabilities: { lint: '@exadev/eslint', test: '@exadev/vitest' } }`,
    )

    const config = await resolveEffectiveConfig({
      config: configWith({
        extends: './presets/stack.ts',
        capabilities: { lint: 'self' },
      }),
      baseDir: repoDir,
    })

    // Preset supplies taskRunner (overriding the local 'none'? no — local set
    // 'none' explicitly via configWith, so the local wins): the local config's
    // explicit taskRunner stays.
    expect(config.taskRunner).toBe('none')
    // schema only the preset set -> inherited.
    expect(config.schema).toBe('valibot')
    // lint: local overrides the preset; test: preset-only carries through.
    expect(config.capabilities).toEqual({ lint: 'self', test: '@exadev/vitest' })
  })

  it("resolves a preset that imports definePreset from the bare '@exadev/core' specifier", async () => {
    // A real distributable preset imports its helper from '@exadev/core', not an
    // absolute dist path. In a temp repo with no node_modules, the only way this
    // resolves is the authoring-jiti alias mapping '@exadev/core' to the engine
    // barrel. This is the case the absolute-path fixtures could not exercise.
    const repoDir = mkdtempSync(join(tmpdir(), 'exadev-preset-bare-'))
    writeBareSpecifierPreset(
      repoDir,
      'presets/bare.ts',
      `{ name: 'bare', capabilities: { lint: '@exadev/eslint' } }`,
    )

    const config = await resolveEffectiveConfig({
      config: configWith({ extends: './presets/bare.ts', capabilities: {} }),
      baseDir: repoDir,
    })

    expect(config.capabilities).toEqual({ lint: '@exadev/eslint' })
  })

  it('applies an extends array in order (later entry overrides earlier)', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'exadev-preset-'))
    writeLocalPreset(repoDir, 'presets/a.ts', `{ schema: 'valibot', capabilities: { lint: '@exadev/eslint' } }`)
    writeLocalPreset(repoDir, 'presets/b.ts', `{ schema: 'arktype', capabilities: { test: '@exadev/vitest' } }`)

    const config = await resolveEffectiveConfig({
      config: configWith({ extends: ['./presets/a.ts', './presets/b.ts'] }),
      baseDir: repoDir,
    })

    // b is later in the array, so its schema overrides a's.
    expect(config.schema).toBe('arktype')
    expect(config.capabilities).toEqual({
      lint: '@exadev/eslint',
      test: '@exadev/vitest',
    })
  })

  it('composes a preset-extends-preset chain depth-first', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'exadev-preset-'))
    writeLocalPreset(repoDir, 'presets/base.ts', `{ packageManager: 'npm', schema: 'valibot', capabilities: { lint: '@exadev/eslint' } }`)
    writeLocalPreset(
      repoDir,
      'presets/derived.ts',
      `{ extends: './base.ts', packageManager: 'yarn', capabilities: { test: '@exadev/vitest' } }`,
    )

    const config = await resolveEffectiveConfig({
      // Local config sets packageManager 'pnpm' (via configWith), winning over
      // both presets.
      config: configWith({ extends: './presets/derived.ts' }),
      baseDir: repoDir,
    })

    expect(config.packageManager).toBe('pnpm') // local wins over derived & base
    expect(config.schema).toBe('valibot') // only the base preset set it
    expect(config.capabilities).toEqual({
      lint: '@exadev/eslint', // from base
      test: '@exadev/vitest', // from derived
    })
  })

  it('unions multi-select bindings from a preset and the local config', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'exadev-preset-'))
    writeLocalPreset(repoDir, 'presets/styling.ts', `{ capabilities: { styling: ['tailwind'] } }`)

    const config = await resolveEffectiveConfig({
      config: configWith({
        extends: './presets/styling.ts',
        capabilities: { styling: ['css-modules'] },
      }),
      baseDir: repoDir,
    })

    expect(config.capabilities).toEqual({ styling: ['tailwind', 'css-modules'] })
  })

  it('rejects an extends cycle', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'exadev-preset-'))
    writeLocalPreset(repoDir, 'presets/a.ts', `{ extends: './b.ts', schema: 'valibot' }`)
    writeLocalPreset(repoDir, 'presets/b.ts', `{ extends: './a.ts', schema: 'arktype' }`)

    await expect(
      resolveEffectiveConfig({
        config: configWith({ extends: './presets/a.ts' }),
        baseDir: repoDir,
      }),
    ).rejects.toThrow(/cycle/)
  })

  it('refuses an untrusted third-party preset', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'exadev-preset-'))
    await expect(
      resolveEffectiveConfig({
        config: configWith({ extends: 'evil-preset' }),
        baseDir: repoDir,
      }),
    ).rejects.toThrow(/untrusted preset 'evil-preset'/)
  })

  it('admits an allowlisted third-party preset', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'exadev-preset-'))
    // A third-party package under node_modules so node resolution finds it by
    // its bare specifier.
    writeLocalPreset(
      repoDir,
      'node_modules/trusted-preset/index.js',
      `{ schema: 'valibot', capabilities: { lint: '@exadev/eslint' } }`,
    )
    writeFileSync(
      join(repoDir, 'node_modules/trusted-preset/package.json'),
      `${JSON.stringify({ name: 'trusted-preset', type: 'module', main: 'index.js' }, null, 2)}\n`,
    )

    const config = await resolveEffectiveConfig({
      config: configWith({ extends: 'trusted-preset' }),
      baseDir: repoDir,
      policy: { allowlist: ['trusted-preset'] },
    })

    expect(config.schema).toBe('valibot')
    expect(config.capabilities).toEqual({ lint: '@exadev/eslint' })
  })

  it("admits an allowlisted third-party preset that imports definePreset from the bare '@exadev/core' specifier", async () => {
    // This is the REAL distributed-preset path: the published package uses
    // `import { definePreset } from '@exadev/core'` (not an absolute path). With
    // no node_modules/@exadev/core in the temp dir, this resolves only via the
    // authoring-jiti alias. Exercises the alias under node_modules/ resolution,
    // which is what the existing writeLocalPreset-based test sidesteps by using an
    // absolute path.
    const repoDir = mkdtempSync(join(tmpdir(), 'exadev-preset-bare-nm-'))
    writeBareSpecifierPreset(
      repoDir,
      'node_modules/published-preset/index.js',
      `{ schema: 'arktype', capabilities: { lint: '@exadev/eslint' } }`,
    )
    writeFileSync(
      join(repoDir, 'node_modules/published-preset/package.json'),
      `${JSON.stringify({ name: 'published-preset', type: 'module', main: 'index.js' }, null, 2)}\n`,
    )

    const config = await resolveEffectiveConfig({
      config: configWith({ extends: 'published-preset' }),
      baseDir: repoDir,
      policy: { allowlist: ['published-preset'] },
    })

    expect(config.schema).toBe('arktype')
    expect(config.capabilities).toEqual({ lint: '@exadev/eslint' })
  })

  it('fails loudly when a preset export is malformed', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'exadev-preset-'))
    const bad = join(repoDir, 'presets/bad.ts')
    mkdirSync(join(bad, '..'), { recursive: true })
    writeFileSync(bad, `export default { packageManager: 'cargo' }\n`)

    await expect(
      resolveEffectiveConfig({
        config: configWith({ extends: './presets/bad.ts' }),
        baseDir: repoDir,
      }),
    ).rejects.toThrow(/not a valid preset/)
  })

  it("refuses a 'self' preset reference (not loadable)", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'exadev-preset-'))
    await expect(
      resolveEffectiveConfig({
        config: configWith({ extends: 'self' }),
        baseDir: repoDir,
      }),
    ).rejects.toThrow(/'self' is not loadable/)
  })
})
