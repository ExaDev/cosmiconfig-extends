import { join } from 'node:path';

import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
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
