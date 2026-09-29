import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createExtendsTransform } from '../../../src/extends';
import { createJitiLoader } from '../../../src/loader';
import { authoringOptions, EXPLORER_MODULE_NAME } from './authoring.js';
import { ConfigSchema, type Config } from './config.js';
import type { ProviderTrustPolicy } from '../provider/trust.js';

/**
 * Inputs to effective-config resolution, as the source project declared them.
 */
export interface ResolveEffectiveConfigInput {
  readonly config: unknown;
  readonly baseDir: string;
  readonly policy?: ProviderTrustPolicy;
}

/**
 * Resolve an in-memory config's `extends` chain and parse the merged result. The config has no content of its own, so `extends` is applied as if it were my-tool.config.ts in `baseDir`.
 */
export async function resolveEffectiveConfig(input: ResolveEffectiveConfigInput): Promise<Config> {
  const { config, baseDir, policy = {} } = input;
  const options = authoringOptions(policy);
  const { importer } = createJitiLoader(options);
  const transform = createExtendsTransform({ ...options, importer });
  const filepath = join(baseDir, `${EXPLORER_MODULE_NAME}.config.ts`);
  // The transform canonicalises the config's path, which cosmiconfig only ever supplies for a file that exists; appending nothing creates an empty stand-in without touching a real file.
  writeFileSync(filepath, '', { flag: 'a' });
  const result = await transform({ config, filepath });
  const effective: unknown = result?.config;

  return ConfigSchema.parse(effective);
}
