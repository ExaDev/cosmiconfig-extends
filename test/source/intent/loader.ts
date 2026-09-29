import { authoringExplorer } from './authoring.js';
import { ConfigSchema, type Config } from './config.js';
import { resolveEffectiveConfig } from './preset-load.js';
import type { ProviderTrustPolicy } from '../provider/trust.js';

/**
 * Evaluate an executable config module and resolve it into the effective Config through this package's explorer.
 */
export async function loadConfig(path: string, policy: ProviderTrustPolicy = {}): Promise<Config> {
  const result = await authoringExplorer(policy).load(path);
  const effective: unknown = result?.config;

  return ConfigSchema.parse(effective);
}

/**
 * Resolve an already-evaluated config object into the effective Config.
 */
export async function evaluateConfig(value: unknown, baseDir: string, policy: ProviderTrustPolicy = {}): Promise<Config> {
  return resolveEffectiveConfig({ config: value, baseDir, policy });
}

/**
 * Validate an already-evaluated config object against ConfigSchema without resolving any `extends` chain.
 */
export function validateConfig(value: unknown): Config {
  return ConfigSchema.parse(value);
}
