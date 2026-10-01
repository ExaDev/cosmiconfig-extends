import fsPromises from 'node:fs/promises';
import { join } from 'node:path';

import * as v from 'valibot';
import type { PublicExplorer } from 'cosmiconfig';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { makeProject, writeProjectFile } from '../test/support/project';

import { createExplorer } from './explorer';
import { ConfigValidationError } from './validate';

function listOf(value: unknown): readonly unknown[] {
  return typeof value === 'object' && value !== null && 'list' in value && Array.isArray(value.list) ? value.list : [];
}

describe('createExplorer', () => {
  it('finds and loads a TypeScript config with the module name', async () => {
    const root = makeProject({ 'my-tool.config.ts': "export default { a: 'x' };\n" });
    const result = await createExplorer('my-tool').search(root);

    expect(result).toEqual({ config: { a: 'x' }, filepath: join(root, 'my-tool.config.ts') });
  });

  it('reports a config that exports undefined as empty, without a spurious default key', async () => {
    const root = makeProject({ 'my-tool.config.ts': 'export default undefined;\n' });

    const filepath = join(root, 'my-tool.config.ts');

    expect(await createExplorer('my-tool').load(filepath)).toEqual({ config: undefined, filepath, isEmpty: true });
  });

  it('returns null when nothing is found', async () => {
    expect(await createExplorer('my-tool').search(makeProject())).toBeNull();
  });

  it('applies extends from a local preset', async () => {
    const root = makeProject({
      'preset.ts': "export default { a: 'preset', b: 'preset' };\n",
      'my-tool.config.ts': "export default { extends: './preset.ts', b: 'config' };\n",
    });

    expect((await createExplorer('my-tool').search(root))?.config).toEqual({ a: 'preset', b: 'config' });
  });

  it('refuses a third-party preset by default', async () => {
    const root = makeProject({
      'node_modules/third-party/package.json': JSON.stringify({ name: 'third-party', type: 'module', main: 'index.js' }),
      'node_modules/third-party/index.js': "export default { a: 'third-party' };\n",
      'my-tool.config.ts': "export default { extends: 'third-party' };\n",
    });

    await expect(createExplorer('my-tool').search(root)).rejects.toThrow(/refusing to load untrusted preset 'third-party'/);
  });

  it('admits a third-party preset the trust predicate allows', async () => {
    const root = makeProject({
      'node_modules/third-party/package.json': JSON.stringify({ name: 'third-party', type: 'module', main: 'index.js' }),
      'node_modules/third-party/index.js': "export default { a: 'third-party' };\n",
      'my-tool.config.ts': "export default { extends: 'third-party' };\n",
    });
    const explorer = createExplorer('my-tool', { trust: ({ ref }) => ref === 'third-party' });

    expect((await explorer.search(root))?.config).toEqual({ a: 'third-party' });
  });

  it('resolves an aliased authoring specifier without a node_modules install', async () => {
    const root = makeProject({
      'authoring/index.ts': "export const defineConfig = <T>(config: T): T => config;\n",
      'my-tool.config.ts': "import { defineConfig } from 'my-tool';\nexport default defineConfig({ a: 'x' });\n",
    });
    const explorer = createExplorer('my-tool', { alias: { 'my-tool': join(root, 'authoring') } });

    expect((await explorer.search(root))?.config).toEqual({ a: 'x' });
  });

  it('applies a custom merge', async () => {
    const root = makeProject({
      'preset.ts': "export default { list: ['a'] };\n",
      'my-tool.config.ts': "export default { extends: './preset.ts', list: ['b'] };\n",
    });
    const explorer = createExplorer('my-tool', { merge: (base, override) => ({ list: [...listOf(base), ...listOf(override)] }) });

    expect((await explorer.search(root))?.config).toEqual({ list: ['a', 'b'] });
  });

  it.each([
    ['zod', z.object({ a: z.string(), mode: z.string().default('strict') })],
    ['valibot', v.object({ a: v.string(), mode: v.optional(v.string(), 'strict') })],
  ] as const)('validates the effective config with %s and applies its defaults', async (_vendor, schema) => {
    const root = makeProject({
      'preset.ts': "export default { a: 'from preset' };\n",
      'my-tool.config.ts': "export default { extends: './preset.ts' };\n",
    });
    const explorer = createExplorer('my-tool', { schema });

    expect((await explorer.search(root))?.config).toEqual({ a: 'from preset', mode: 'strict' });
  });

  it.each([
    ['zod', z.object({ a: z.string() })],
    ['valibot', v.object({ a: v.string() })],
  ] as const)('rejects an invalid effective config with %s', async (_vendor, schema) => {
    const root = makeProject({ 'my-tool.config.ts': 'export default { a: false };\n' });

    await expect(createExplorer('my-tool', { schema }).search(root)).rejects.toBeInstanceOf(ConfigValidationError);
  });

  it('passes cosmiconfig options through', async () => {
    const root = makeProject({ 'custom.config.ts': "export default { a: 'x' };\n" });
    const explorer = createExplorer('my-tool', { cosmiconfig: { searchPlaces: ['custom.config.ts'] } });

    expect((await explorer.search(root))?.filepath).toBe(join(root, 'custom.config.ts'));
  });

  it('lets a caller loader replace the jiti loader for an extension', async () => {
    const root = makeProject({ 'config.ts': "export default { a: 'x' };\n" });
    const explorer = createExplorer('my-tool', { cosmiconfig: { loaders: { '.ts': () => ({ replaced: true }) } } });

    expect((await explorer.load(join(root, 'config.ts')))?.config).toEqual({ replaced: true });
  });

  it('serves an edited file after clearCaches', async () => {
    const root = makeProject({ 'config.ts': "export default { a: 'one' };\n" });
    const explorer = createExplorer('my-tool');
    const file = join(root, 'config.ts');
    await explorer.load(file);
    writeProjectFile(root, 'config.ts', "export default { a: 'two' };\n");
    explorer.clearCaches();

    expect((await explorer.load(file))?.config).toEqual({ a: 'two' });
  });
});

describe('createExplorer searchUpTo', () => {
  const rc = (from: string): string => JSON.stringify({ from });

  it('searches parents up to the directory, nearest first', async () => {
    const root = makeProject({
      'bound/.my-toolrc.json': rc('bound'),
      'bound/middle/.my-toolrc.json': rc('middle'),
      'bound/middle/start/placeholder.txt': '',
    });

    const result = await createExplorer('my-tool', { searchUpTo: join(root, 'bound') }).search(join(root, 'bound/middle/start'));

    expect(result?.config).toEqual({ from: 'middle' });
  });

  it('includes the bounding directory itself', async () => {
    const root = makeProject({ 'bound/.my-toolrc.json': rc('bound'), 'bound/start/placeholder.txt': '' });

    const result = await createExplorer('my-tool', { searchUpTo: join(root, 'bound') }).search(join(root, 'bound/start'));

    expect(result?.filepath).toBe(join(root, 'bound/.my-toolrc.json'));
  });

  it('does not search above the bounding directory', async () => {
    const root = makeProject({ '.my-toolrc.json': rc('above'), 'bound/start/placeholder.txt': '' });

    expect(await createExplorer('my-tool', { searchUpTo: join(root, 'bound') }).search(join(root, 'bound/start'))).toBeNull();
  });

  it('searches the start directory when it is the bounding directory', async () => {
    const root = makeProject({ 'bound/.my-toolrc.json': rc('bound') });

    const result = await createExplorer('my-tool', { searchUpTo: join(root, 'bound') }).search(join(root, 'bound'));

    expect(result?.config).toEqual({ from: 'bound' });
  });

  it('applies extends to a config found in a parent', async () => {
    const root = makeProject({
      'bound/preset.ts': "export default { a: 'preset', b: 'preset' };\n",
      'bound/my-tool.config.ts': "export default { extends: './preset.ts', b: 'config' };\n",
      'bound/start/placeholder.txt': '',
    });

    const result = await createExplorer('my-tool', { searchUpTo: join(root, 'bound') }).search(join(root, 'bound/start'));

    expect(result?.config).toEqual({ a: 'preset', b: 'config' });
  });

  it('throws when the search starts outside the bounding directory', async () => {
    const root = makeProject({ 'bound/placeholder.txt': '', 'elsewhere/.my-toolrc.json': rc('elsewhere') });
    const explorer = createExplorer('my-tool', { searchUpTo: join(root, 'bound') });

    await expect(explorer.search(join(root, 'elsewhere'))).rejects.toThrow(/does not contain it/);
  });

  it('is not fooled by a sibling directory sharing the bounding directory name as a prefix', async () => {
    const root = makeProject({ 'bound/placeholder.txt': '', 'bound-sibling/.my-toolrc.json': rc('sibling') });
    const explorer = createExplorer('my-tool', { searchUpTo: join(root, 'bound') });

    await expect(explorer.search(join(root, 'bound-sibling'))).rejects.toThrow(/does not contain it/);
  });

  it('keeps the other explorer methods', async () => {
    const root = makeProject({ 'config.ts': "export default { a: 'x' };\n" });
    const explorer = createExplorer('my-tool', { searchUpTo: root });

    expect((await explorer.load(join(root, 'config.ts')))?.config).toEqual({ a: 'x' });
    expect(() => {
      explorer.clearCaches();
    }).not.toThrow();
  });

  describe('against the user global config directory', () => {
    /**
     * Records every directory cosmiconfig checks during `search`, so the test does not depend on where the OS keeps the global config directory (cosmiconfig's path lookup caches the home directory at import time, so it cannot be redirected with environment variables). cosmiconfig stats a directory before reading anything from it, whether or not it exists.
     */
    async function pathsCheckedBy(explorer: Readonly<PublicExplorer>, from: string): Promise<readonly string[]> {
      const stat = vi.spyOn(fsPromises, 'stat');
      try {
        await explorer.search(from);

        return stat.mock.calls.flatMap(([path]) => (typeof path === 'string' ? [path] : []));
      } finally {
        stat.mockRestore();
      }
    }

    it('is never read for a directory bound, though the global strategy with stopDir reads it', async () => {
      const root = makeProject({ 'bound/start/placeholder.txt': '' });
      const start = join(root, 'bound/start');
      const outsideRoot = (file: string): boolean => !file.startsWith(root);

      const raw = await pathsCheckedBy(createExplorer('my-tool', { cosmiconfig: { searchStrategy: 'global', stopDir: join(root, 'bound') } }), start);
      const bounded = await pathsCheckedBy(createExplorer('my-tool', { searchUpTo: join(root, 'bound') }), start);

      expect(raw.some(outsideRoot)).toBe(true);
      expect(bounded.length).toBeGreaterThan(0);
      expect(bounded.filter(outsideRoot)).toEqual([]);
    });

    it('is never read for the project bound', async () => {
      const root = makeProject({ 'package.json': '{}', 'start/placeholder.txt': '' });

      const checked = await pathsCheckedBy(createExplorer('my-tool', { searchUpTo: 'project' }), join(root, 'start'));

      expect(checked.length).toBeGreaterThan(0);
      expect(checked.filter((file) => !file.startsWith(root))).toEqual([]);
    });
  });

  describe('project', () => {
    it('stops at the first directory containing a package.json', async () => {
      const root = makeProject({
        '.my-toolrc.json': rc('above-package'),
        'package/package.json': '{}',
        'package/nested/start/placeholder.txt': '',
      });

      expect(await createExplorer('my-tool', { searchUpTo: 'project' }).search(join(root, 'package/nested/start'))).toBeNull();
    });

    it('finds a config in a parent below the package root', async () => {
      const root = makeProject({
        'package.json': '{}',
        'nested/.my-toolrc.json': rc('nested'),
        'nested/start/placeholder.txt': '',
      });

      const result = await createExplorer('my-tool', { searchUpTo: 'project' }).search(join(root, 'nested/start'));

      expect(result?.config).toEqual({ from: 'nested' });
    });

    it('finds a config beside the package.json', async () => {
      const root = makeProject({ 'package.json': '{}', '.my-toolrc.json': rc('root'), 'start/placeholder.txt': '' });

      const result = await createExplorer('my-tool', { searchUpTo: 'project' }).search(join(root, 'start'));

      expect(result?.config).toEqual({ from: 'root' });
    });
  });

  describe('construction errors', () => {
    it('rejects a raw searchStrategy, naming both options', () => {
      expect(() => createExplorer('my-tool', { searchUpTo: 'project', cosmiconfig: { searchStrategy: 'global' } })).toThrow(
        /searchUpTo 'project' cannot be combined with cosmiconfig\.searchStrategy$/,
      );
    });

    it('rejects a raw stopDir, naming both options', () => {
      expect(() => createExplorer('my-tool', { searchUpTo: '/some/dir', cosmiconfig: { stopDir: '/other' } })).toThrow(
        /searchUpTo '\/some\/dir' cannot be combined with cosmiconfig\.stopDir$/,
      );
    });

    it('names every raw option it conflicts with', () => {
      expect(() =>
        createExplorer('my-tool', { searchUpTo: 'project', cosmiconfig: { searchStrategy: 'global', stopDir: '/other' } }),
      ).toThrow(/cannot be combined with cosmiconfig\.searchStrategy and cosmiconfig\.stopDir$/);
    });

    it('rejects an empty string', () => {
      expect(() => createExplorer('my-tool', { searchUpTo: '' })).toThrow(/not an empty string/);
    });

    it('still passes a raw searchStrategy and stopDir through without searchUpTo', () => {
      expect(() => createExplorer('my-tool', { cosmiconfig: { searchStrategy: 'global', stopDir: '/some/dir' } })).not.toThrow();
    });
  });
});
