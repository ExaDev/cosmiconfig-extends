import { join } from 'node:path';

import { cosmiconfig as cosmiconfig10 } from 'cosmiconfig-10';
import { cosmiconfig as cosmiconfig9 } from 'cosmiconfig-9';
import { describe, expect, it } from 'vitest';

import { makeProject, writeProjectFile } from '../test/support/project';

import { createExtendsTransform } from './extends';
import { createJitiLoader } from './loader';

/**
 * Uses only the loader and the transform with plain cosmiconfig, one describe block per major version, to prove neither depends on this package's own explorer wrapper.
 */
describe.each([
  ['cosmiconfig 9', cosmiconfig9],
  ['cosmiconfig 10', cosmiconfig10],
] as const)('%s with the jiti loader alone', (_name, cosmiconfig) => {
  const { loader } = createJitiLoader();
  const loaders = { '.ts': loader, '.mts': loader, '.cts': loader };

  it('loads a TypeScript file it finds by searching', async () => {
    const root = makeProject({ 'my-tool.config.ts': "const config: { readonly a: string } = { a: 'x' };\nexport default config;\n" });
    const result = await cosmiconfig('my-tool', { loaders }).search(root);

    expect(result).toEqual({ config: { a: 'x' }, filepath: join(root, 'my-tool.config.ts') });
  });

  it.each(['.ts', '.mts', '.cts'])('loads a %s file', async (extension) => {
    const root = makeProject({ [`config${extension}`]: "export default { a: 'x' };\n" });
    const result = await cosmiconfig('my-tool', { loaders }).load(join(root, `config${extension}`));

    expect(result?.config).toEqual({ a: 'x' });
  });

  it('serves the edited file after clearCaches, because the jiti module cache is off', async () => {
    const root = makeProject({ 'config.ts': "export default { a: 'one' };\n" });
    const explorer = cosmiconfig('my-tool', { loaders });
    const file = join(root, 'config.ts');

    expect((await explorer.load(file))?.config).toEqual({ a: 'one' });

    writeProjectFile(root, 'config.ts', "export default { a: 'two' };\n");
    explorer.clearCaches();

    expect((await explorer.load(file))?.config).toEqual({ a: 'two' });
  });

  it('applies extends through the transform', async () => {
    const { importer } = createJitiLoader();
    const root = makeProject({
      'base.ts': "export default { a: 'base', b: 'base' };\n",
      'config.ts': "export default { extends: './base.ts', b: 'config' };\n",
    });
    const explorer = cosmiconfig('my-tool', { loaders, transform: createExtendsTransform({ importer }) });

    expect((await explorer.load(join(root, 'config.ts')))?.config).toEqual({ a: 'base', b: 'config' });
  });

  it('calls the transform with null when nothing is found', async () => {
    const { importer } = createJitiLoader();
    const explorer = cosmiconfig('my-tool', { loaders, transform: createExtendsTransform({ importer }) });

    expect(await explorer.search(makeProject())).toBeNull();
  });

  it('refuses a third-party preset by default, before resolving it', async () => {
    const { importer } = createJitiLoader();
    const root = makeProject({ 'config.ts': "export default { extends: 'third-party-preset' };\n" });
    const explorer = cosmiconfig('my-tool', { loaders, transform: createExtendsTransform({ importer }) });

    await expect(explorer.load(join(root, 'config.ts'))).rejects.toThrow(/refusing to load untrusted preset 'third-party-preset'/);
  });
});
