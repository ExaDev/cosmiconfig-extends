import { describe, expect, it } from 'vitest'

import {
  mergeLayers,
  mergeToConfig,
  type ConfigLayer,
} from './preset-merge.js'

describe('mergeLayers', async () => {
  it('returns an empty layer for no layers', async () => {
    expect(mergeLayers([])).toEqual({
      repoTopology: undefined,
      packageManager: undefined,
      taskRunner: undefined,
      schema: undefined,
      capabilities: undefined,
    })
  })

  it('last-wins for a substrate scalar a later layer sets', async () => {
    const base: ConfigLayer = { packageManager: 'npm', taskRunner: 'turbo' }
    const local: ConfigLayer = { packageManager: 'pnpm' }
    const merged = mergeLayers([base, local])
    // local overrides the package manager; the task runner only the base set
    // carries through (an omitted local field does not override).
    expect(merged.packageManager).toBe('pnpm')
    expect(merged.taskRunner).toBe('turbo')
  })

  it('an omitted later field does not override an earlier value', async () => {
    const base: ConfigLayer = { schema: 'valibot' }
    const local: ConfigLayer = {}
    expect(mergeLayers([base, local]).schema).toBe('valibot')
  })

  it('merges capability bindings key-by-key, local overriding the preset', async () => {
    const preset: ConfigLayer = {
      capabilities: { lint: '@exadev/eslint', test: '@exadev/vitest' },
    }
    const local: ConfigLayer = { capabilities: { lint: 'self' } }
    const merged = mergeLayers([preset, local])
    expect(merged.capabilities).toEqual({
      lint: 'self', // local wins for this key
      test: '@exadev/vitest', // preset-only key carries through
    })
  })

  it('unions multi-select array bindings across layers and de-dupes', async () => {
    const preset: ConfigLayer = {
      capabilities: { styling: ['tailwind', 'css-modules'] },
    }
    const local: ConfigLayer = {
      capabilities: { styling: ['css-modules', 'vanilla-extract'] },
    }
    expect(mergeLayers([preset, local]).capabilities).toEqual({
      styling: ['tailwind', 'css-modules', 'vanilla-extract'],
    })
  })

  it('replaces a string binding outright (no composition)', async () => {
    const preset: ConfigLayer = { capabilities: { 'api-contract': '@exadev/orpc' } }
    const local: ConfigLayer = { capabilities: { 'api-contract': 'self' } }
    expect(mergeLayers([preset, local]).capabilities).toEqual({
      'api-contract': 'self',
    })
  })

  it('applies an ordered chain deepest-base first, nearer layers overriding', async () => {
    const deepest: ConfigLayer = { packageManager: 'npm', schema: 'arktype' }
    const middle: ConfigLayer = { packageManager: 'yarn' }
    const local: ConfigLayer = { packageManager: 'pnpm' }
    const merged = mergeLayers([deepest, middle, local])
    expect(merged.packageManager).toBe('pnpm') // nearest wins
    expect(merged.schema).toBe('arktype') // only the deepest set it
  })
})

describe('mergeToConfig', async () => {
  it('parses the merged layers into an effective config', async () => {
    const preset: ConfigLayer = {
      repoTopology: 'single-package',
      packageManager: 'pnpm',
      taskRunner: 'none',
      schema: 'valibot',
      capabilities: { lint: '@exadev/eslint' },
    }
    const local: ConfigLayer = { capabilities: { lint: 'self' } }
    const config = mergeToConfig([preset, local])
    expect(config.repoTopology).toBe('single-package')
    expect(config.packageManager).toBe('pnpm')
    expect(config.schema).toBe('valibot') // preset's choice survives, not defaulted
    expect(config.capabilities).toEqual({ lint: 'self' })
  })

  it("defaults schema to 'zod' only when no layer chose one", async () => {
    const config = mergeToConfig([
      { repoTopology: 'single-package', packageManager: 'pnpm', taskRunner: 'none' },
    ])
    expect(config.schema).toBe('zod')
    expect(config.capabilities).toEqual({})
  })

  it('fails loudly when no layer supplies a required substrate field', async () => {
    // No layer sets repoTopology: a required field with no default, so the merged
    // result is not a valid config and the parse throws rather than silently
    // inventing a value.
    expect(() =>
      mergeToConfig([{ packageManager: 'pnpm', taskRunner: 'none' }]),
    ).toThrow()
  })
})
