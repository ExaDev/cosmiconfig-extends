import fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cosmiconfig as cosmiconfig10 } from 'cosmiconfig-10';
import { cosmiconfig as cosmiconfig9 } from 'cosmiconfig-9';
import { describe, expect, it, vi } from 'vitest';

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

/**
 * Pins the cosmiconfig behaviour that the `searchUpTo` option of `createExplorer` is designed around, in both majors.
 */
describe.each([
  ['cosmiconfig 9', cosmiconfig9],
  ['cosmiconfig 10', cosmiconfig10],
] as const)('%s search strategies', (_name, cosmiconfig) => {
  const { loader } = createJitiLoader();
  const loaders = { '.ts': loader, '.mts': loader, '.cts': loader };

  async function directoriesChecked(search: (from: string) => Promise<unknown>, from: string): Promise<readonly string[]> {
    const stat = vi.spyOn(fsPromises, 'stat');
    try {
      await search(from);

      return stat.mock.calls.flatMap(([path]) => (typeof path === 'string' ? [path] : []));
    } finally {
      stat.mockRestore();
    }
  }

  it('searches only the start directory with the none strategy', async () => {
    const root = makeProject({ '.my-toolrc.json': '{}', 'start/placeholder.txt': '' });

    expect(await cosmiconfig('my-tool', { loaders, searchStrategy: 'none' }).search(join(root, 'start'))).toBeNull();
  });

  it('stops at the first directory with a package.json with the project strategy', async () => {
    const root = makeProject({ '.my-toolrc.json': '{}', 'package/package.json': '{}', 'package/start/placeholder.txt': '' });

    expect(await cosmiconfig('my-tool', { loaders, searchStrategy: 'project' }).search(join(root, 'package/start'))).toBeNull();
  });

  it('rejects stopDir with a strategy other than global', () => {
    for (const searchStrategy of ['none', 'project'] as const) {
      expect(() => cosmiconfig('my-tool', { loaders, searchStrategy, stopDir: tmpdir() })).toThrow(/stopDir/);
    }
  });

  it('includes stopDir in the global strategy', async () => {
    const root = makeProject({ 'bound/.my-toolrc.json': '{"from":"bound"}', 'bound/start/placeholder.txt': '' });

    const result = await cosmiconfig('my-tool', { loaders, searchStrategy: 'global', stopDir: join(root, 'bound') }).search(join(root, 'bound/start'));

    expect(result?.config).toEqual({ from: 'bound' });
  });

  it('still checks the OS config directory after stopDir with the global strategy', async () => {
    const root = makeProject({ 'bound/start/placeholder.txt': '' });
    const explorer = cosmiconfig('my-tool', { loaders, searchStrategy: 'global', stopDir: join(root, 'bound') });

    const checked = await directoriesChecked(async (from) => explorer.search(from), join(root, 'bound/start'));

    expect(checked.filter((directory) => !directory.startsWith(root))).not.toEqual([]);
  });
});
