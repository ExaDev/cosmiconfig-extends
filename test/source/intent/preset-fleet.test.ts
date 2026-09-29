// intent/preset-fleet — published-org-preset fixture tests.
//
// The preset merge machinery is unit-tested with LOCAL-PATH presets in
// preset-load.test.ts; that leaves the published bare-specifier path unproven.
// This file proves the polyrepo fleet-consistency path: a PUBLISHED
// bare-specifier preset (a node_modules package importing definePreset from
// '@my-tool/core'), a preset-extends-preset chain across two bare specifiers, and
// the allowlist gate on transitive chains.
//
// All preset modules use the bare '@my-tool/core' import (not an absolute path
// corePath alias), which is what a real distributed org preset does. This
// exercises the authoring-jiti alias under node-resolution, not the local helper
// path that writeLocalPreset uses and which sidesteps that alias.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveEffectiveConfig } from './preset-load.js'

/**
 * Write a published-style preset to `node_modules/<pkgName>/` under `repoDir`.
 *
 * Writes:
 *   node_modules/<pkgName>/package.json  — { name, type: 'module', main: 'index.js' }
 *   node_modules/<pkgName>/index.js      — imports definePreset from '@my-tool/core'
 *                                          (the bare specifier; the authoring-jiti
 *                                          alias resolves it to the engine barrel)
 *
 * `body` is the object literal passed to definePreset. An optional `extends`
 * option writes that as the preset's own extends field.
 */
function writePublishedPreset(
  repoDir: string,
  pkgName: string,
  body: string,
): void {
  const pkgDir = join(repoDir, 'node_modules', pkgName)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(
    join(pkgDir, 'package.json'),
    `${JSON.stringify({ name: pkgName, type: 'module', main: 'index.js' }, null, 2)}\n`,
  )
  writeFileSync(
    join(pkgDir, 'index.js'),
    [
      `import { definePreset } from '@my-tool/core'`,
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

describe('resolveEffectiveConfig: published-org-preset fleet scenarios', { timeout: 20000 }, async () => {
  it('multi-level chain across bare specifiers: base sets schema/lint, stack adds test, local substrate wins', async () => {
    // @acme/base: packageManager 'npm', schema 'valibot', lint '@my-tool/eslint'
    // @acme/stack: extends '@acme/base', taskRunner 'turbo', test '@my-tool/vitest'
    // local config: packageManager 'pnpm' (via configWith), extends '@acme/stack'
    //
    // Expected depth-first layering:
    //   layer 0 (deepest): @acme/base  -> packageManager:'npm', schema:'valibot', lint
    //   layer 1:           @acme/stack -> taskRunner:'turbo', test
    //   layer 2 (local):   configWith  -> packageManager:'pnpm', taskRunner:'none'
    //
    // local packageManager wins, local taskRunner wins, schema from base, both
    // capabilities inherited.
    const repoDir = mkdtempSync(join(tmpdir(), 'my-tool-fleet-'))
    writePublishedPreset(
      repoDir,
      '@acme/base',
      `{ name: '@acme/base', packageManager: 'npm', schema: 'valibot', capabilities: { lint: '@my-tool/eslint' } }`,
    )
    writePublishedPreset(
      repoDir,
      '@acme/stack',
      `{ name: '@acme/stack', extends: '@acme/base', taskRunner: 'turbo', capabilities: { test: '@my-tool/vitest' } }`,
    )

    const config = await resolveEffectiveConfig({
      config: configWith({ extends: '@acme/stack' }),
      baseDir: repoDir,
      policy: { allowlist: ['@acme/base', '@acme/stack'] },
    })

    // Local substrate wins.
    expect(config.packageManager).toBe('pnpm')
    expect(config.taskRunner).toBe('none')
    // schema only @acme/base set -> inherited as the deepest default.
    expect(config.schema).toBe('valibot')
    // Capabilities from both preset layers carry through.
    expect(config.capabilities).toEqual({ lint: '@my-tool/eslint', test: '@my-tool/vitest' })
  })

  it('defaults-vs-overrides across a published chain: local field wins, base-only field is inherited', async () => {
    // @acme/base sets packageManager:'npm' (defaults layer).
    // local config sets packageManager:'pnpm' explicitly (overrides layer) -> wins.
    // @acme/base also sets schema:'arktype'; local does not set schema -> inherited.
    const repoDir = mkdtempSync(join(tmpdir(), 'my-tool-fleet-'))
    writePublishedPreset(
      repoDir,
      '@acme/base',
      `{ packageManager: 'npm', schema: 'arktype', capabilities: { lint: '@my-tool/eslint' } }`,
    )

    const config = await resolveEffectiveConfig({
      config: configWith({ extends: '@acme/base', packageManager: 'pnpm' }),
      baseDir: repoDir,
      policy: { allowlist: ['@acme/base'] },
    })

    // Local 'pnpm' wins over base's 'npm'.
    expect(config.packageManager).toBe('pnpm')
    // 'arktype' only @acme/base set -> inherited (proves bare presets are the defaults layer).
    expect(config.schema).toBe('arktype')
    expect(config.capabilities).toEqual({ lint: '@my-tool/eslint' })
  })

  it('multi-select union from a published preset: preset styling is unioned with local styling', async () => {
    // @acme/styling contributes ['tailwind']; local contributes ['css-modules'].
    // Expected union: ['tailwind', 'css-modules'] in that order
    // (preset = earlier layer -> its entries come first).
    const repoDir = mkdtempSync(join(tmpdir(), 'my-tool-fleet-'))
    writePublishedPreset(
      repoDir,
      '@acme/styling',
      `{ capabilities: { styling: ['tailwind'] } }`,
    )

    const config = await resolveEffectiveConfig({
      config: configWith({
        extends: '@acme/styling',
        capabilities: { styling: ['css-modules'] },
      }),
      baseDir: repoDir,
      policy: { allowlist: ['@acme/styling'] },
    })

    expect(config.capabilities).toMatchObject({ styling: ['tailwind', 'css-modules'] })
  })

  it('allowlist gate: a published preset NOT in the allowlist is refused', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'my-tool-fleet-'))
    writePublishedPreset(
      repoDir,
      '@acme/evil',
      `{ schema: 'valibot' }`,
    )

    await expect(
      resolveEffectiveConfig({
        config: configWith({ extends: '@acme/evil' }),
        baseDir: repoDir,
        // No allowlist entry for '@acme/evil'.
      }),
    ).rejects.toThrow(/untrusted/)
  })

  it('allowlist gate: a transitive base preset NOT in the allowlist is refused', async () => {
    // @acme/stack extends @acme/base. @acme/stack is allowlisted but @acme/base
    // is not. The resolver walks the chain depth-first and gates each ref it
    // walks, so @acme/base must be refused even though it is only transitive.
    const repoDir = mkdtempSync(join(tmpdir(), 'my-tool-fleet-'))
    writePublishedPreset(
      repoDir,
      '@acme/base',
      `{ schema: 'valibot' }`,
    )
    writePublishedPreset(
      repoDir,
      '@acme/stack',
      `{ extends: '@acme/base', taskRunner: 'turbo' }`,
    )

    await expect(
      resolveEffectiveConfig({
        config: configWith({ extends: '@acme/stack' }),
        baseDir: repoDir,
        policy: { allowlist: ['@acme/stack'] }, // @acme/base deliberately omitted
      }),
    ).rejects.toThrow(/untrusted/)
  })

  it('re-resolution stability: resolving the same published config twice produces deeply equal results', async () => {
    // Proves day-2 'my-tool update' determinism: loading the same config a
    // second time from the same node_modules preset yields the exact same
    // effective config (no clock, no randomness, no ordering variation).
    const repoDir = mkdtempSync(join(tmpdir(), 'my-tool-fleet-'))
    writePublishedPreset(
      repoDir,
      '@acme/base',
      `{ schema: 'valibot', capabilities: { lint: '@my-tool/eslint' } }`,
    )
    writePublishedPreset(
      repoDir,
      '@acme/stack',
      `{ extends: '@acme/base', taskRunner: 'turbo', capabilities: { test: '@my-tool/vitest' } }`,
    )

    const input = {
      config: configWith({ extends: '@acme/stack' }),
      baseDir: repoDir,
      policy: { allowlist: ['@acme/base', '@acme/stack'] },
    }
    const first = await resolveEffectiveConfig(input)
    const second = await resolveEffectiveConfig(input)

    expect(first).toEqual(second)
  })
})
