import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { StandardSchemaV1 } from '@standard-schema/spec';

import { createExplorer } from '../../../src/explorer';
import type { ExplorerOptions } from '../../../src/explorer';
import { mergeLayers, ConfigLayerSchema } from './preset-merge.js';
import { isPreset, type PresetDefinition } from './preset.js';
import { classifyProviderRef, type ProviderTrustPolicy } from '../provider/trust.js';

/**
 * The source project aliases its public specifiers to the engine barrel so a config evaluates the same whatever the install layout; here the barrel is test/source, the directory holding this fixture's index.ts.
 */
const BARREL_DIRECTORY = dirname(fileURLToPath(new URL('../index.ts', import.meta.url)));

/**
 * A Standard Schema over the source project's isPreset guard, with the source project's wording for a malformed export.
 */
const presetSchema: StandardSchemaV1<unknown, PresetDefinition> = {
  '~standard': {
    version: 1,
    vendor: 'source-project',
    validate: (value) =>
      isPreset(value)
        ? { value }
        : { issues: [{ message: 'not a valid preset: its export is not a definePreset result' }] },
  },
};

/**
 * The source project's pairwise merge: both sides are read as layers (unknown keys such as `name` are dropped) and the later one overlays the earlier.
 */
function mergeConfigLayers(base: unknown, override: unknown): unknown {
  return mergeLayers([ConfigLayerSchema.parse(base), ConfigLayerSchema.parse(override)]);
}

/**
 * Options that configure this package the way the source project's loader was configured.
 */
export function authoringOptions(policy: ProviderTrustPolicy): ExplorerOptions {
  return {
    alias: { 'my-tool': BARREL_DIRECTORY, '@my-tool/core': BARREL_DIRECTORY },
    trust: ({ ref }) => {
      const decision = classifyProviderRef(ref, policy);
      if (decision.origin === 'self') {
        throw new Error(`preset reference 'self' is not loadable: a preset must be a package specifier or a local path`);
      }

      return decision.trusted;
    },
    merge: mergeConfigLayers,
    presetSchema,
  };
}

export const EXPLORER_MODULE_NAME = 'my-tool';

export function authoringExplorer(policy: ProviderTrustPolicy) {
  return createExplorer(EXPLORER_MODULE_NAME, authoringOptions(policy));
}
