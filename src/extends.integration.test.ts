import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CosmiconfigResult } from 'cosmiconfig';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { makeProject } from '../test/support/project';

import { createExtendsTransform, type ExtendsOptions, type TrustContext } from './extends';
import { createJitiLoader } from './loader';
import type { Merge } from './merge';
import { ConfigValidationError } from './validate';

type Options = Omit<ExtendsOptions, 'importer'>;

function transformFor(options: Options = {}) {
  const { importer } = createJitiLoader();
  const transform = createExtendsTransform({ importer, ...options });

  return async (root: string, config: unknown): Promise<unknown> => {
    const filepath = configFileIn(root);
    const result = await transform({ config, filepath });

    return result?.config;
  };
}

/**
 * The transform canonicalises the config's path, which cosmiconfig only ever supplies for a file that exists; appending nothing creates an empty stand-in without touching a file that is already there.
 */
function configFileIn(root: string): string {
  const filepath = join(root, 'config.ts');
  writeFileSync(filepath, '', { flag: 'a' });

  return filepath;
}

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function preset(body: string): string {
  return `export default ${body};\n`;
}

describe('createExtendsTransform', () => {
  describe('results that carry no config', () => {
    it('passes a null result through', async () => {
      const { importer } = createJitiLoader();

      expect(await createExtendsTransform({ importer })(null)).toBeNull();
    });

    it('passes an empty-file result through untouched', async () => {
      const { importer } = createJitiLoader();
      const empty: CosmiconfigResult = { config: undefined, filepath: join(makeProject(), 'config.ts'), isEmpty: true };

      expect(await createExtendsTransform({ importer })(empty)).toBe(empty);
    });

    it('keeps the other fields of the result it transforms', async () => {
      const { importer } = createJitiLoader();
      const filepath = configFileIn(makeProject());
      const result = await createExtendsTransform({ importer })({ config: { a: 'x' }, filepath });

      expect(result).toEqual({ config: { a: 'x' }, filepath });
    });
  });

  describe('merging', () => {
    it('returns a config without extends unchanged', async () => {
      const root = makeProject();

      expect(await transformFor()(root, { a: 'x', nested: { b: 'y' } })).toEqual({ a: 'x', nested: { b: 'y' } });
    });

    it('lets a preset supply defaults and the config override them, and drops the extends key', async () => {
      const root = makeProject({ 'presets/stack.ts': preset("{ a: 'preset', b: 'preset', nested: { x: 'preset', y: 'preset' } }") });

      expect(await transformFor()(root, { extends: './presets/stack.ts', b: 'config', nested: { y: 'config' } })).toEqual({
        a: 'preset',
        b: 'config',
        nested: { x: 'preset', y: 'config' },
      });
    });

    it('applies an extends array in order, a later entry overriding an earlier one', async () => {
      const root = makeProject({ 'a.ts': preset("{ v: 'a', onlyA: true }"), 'b.ts': preset("{ v: 'b', onlyB: true }") });

      expect(await transformFor()(root, { extends: ['./a.ts', './b.ts'] })).toEqual({ v: 'b', onlyA: true, onlyB: true });
    });

    it('composes a chain depth-first, the deepest base supplying the lowest-priority defaults', async () => {
      const root = makeProject({
        'base.ts': preset("{ v: 'base', onlyBase: true }"),
        'middle.ts': preset("{ extends: './base.ts', v: 'middle', onlyMiddle: true }"),
      });

      expect(await transformFor()(root, { extends: './middle.ts', onlyConfig: true })).toEqual({
        v: 'middle',
        onlyBase: true,
        onlyMiddle: true,
        onlyConfig: true,
      });
    });

    it('resolves a nested reference from the directory of the preset that names it', async () => {
      const root = makeProject({
        'presets/base.ts': preset("{ v: 'base' }"),
        'presets/derived.ts': preset("{ extends: './base.ts' }"),
      });

      expect(await transformFor()(root, { extends: './presets/derived.ts' })).toEqual({ v: 'base' });
    });

    it('does not resolve a nested reference from the root config directory', async () => {
      const root = makeProject({
        'presets/base.ts': preset("{ v: 'base' }"),
        'presets/derived.ts': preset("{ extends: './presets/base.ts' }"),
      });

      await expect(transformFor()(root, { extends: './presets/derived.ts' })).rejects.toThrow(/Cannot find module '\.\/presets\/base\.ts'/);
    });

    it('resolves a nested package reference through the preset own node_modules', async () => {
      const root = makeProject({
        'node_modules/stack/package.json': JSON.stringify({ name: 'stack', type: 'module', main: 'index.js' }),
        'node_modules/stack/index.js': "export default { extends: 'nested-base', v: 'stack' };\n",
        'node_modules/stack/node_modules/nested-base/package.json': JSON.stringify({ name: 'nested-base', type: 'module', main: 'index.js' }),
        'node_modules/stack/node_modules/nested-base/index.js': "export default { onlyBase: true };\n",
      });

      expect(await transformFor({ trust: () => true })(root, { extends: 'stack' })).toEqual({ v: 'stack', onlyBase: true });
    });

    it('reads the presets from a custom extends key', async () => {
      const root = makeProject({ 'base.ts': preset("{ v: 'base' }") });

      expect(await transformFor({ extendsKey: 'bases' })(root, { bases: './base.ts', extends: 'kept' })).toEqual({
        v: 'base',
        extends: 'kept',
      });
    });

    it('folds through a custom merge starting from an empty object, deepest base first', async () => {
      const root = makeProject({ 'a.ts': preset("{ v: 'a' }"), 'b.ts': preset("{ v: 'b' }") });
      const calls: unknown[][] = [];
      const record: Merge = (base, override) => {
        calls.push([base, override]);

        return override;
      };
      await transformFor({ merge: record })(root, { extends: ['./a.ts', './b.ts'] });

      expect(calls).toEqual([
        [{}, { v: 'a' }],
        [{ v: 'a' }, { v: 'b' }],
        [{ v: 'b' }, {}],
      ]);
    });

    it('supports an array-union merge', async () => {
      const union: Merge = (base, override) => {
        if (isList(base) && isList(override)) {
          return [...new Set([...base, ...override])];
        }
        if (typeof base === 'object' && base !== null && typeof override === 'object' && override !== null) {
          const keys = new Set([...Object.keys(base), ...Object.keys(override)]);

          return Object.fromEntries([...keys].map((key) => [key, union(Reflect.get(base, key), Reflect.get(override, key))]));
        }

        return override ?? base;
      };
      const root = makeProject({ 'styling.ts': preset("{ features: ['tailwind', 'shared'] }") });

      expect(await transformFor({ merge: union })(root, { extends: './styling.ts', features: ['css-modules', 'shared'] })).toEqual({
        features: ['tailwind', 'shared', 'css-modules'],
      });
    });

    it('passes a null config through', async () => {
      expect(await transformFor()(makeProject(), null)).toBeNull();
    });

    it('merges a config that is not an object as the override', async () => {
      const root = makeProject();

      expect(await transformFor()(root, ['a', 'b'])).toEqual(['a', 'b']);
    });
  });

  describe('trust', () => {
    it('trusts local paths and refuses packages by default', async () => {
      const root = makeProject({ 'local.ts': preset("{ v: 'local' }") });

      expect(await transformFor()(root, { extends: './local.ts' })).toEqual({ v: 'local' });
      await expect(transformFor()(root, { extends: 'third-party' })).rejects.toThrow(
        `refusing to load untrusted preset 'third-party' (package) named in ${join(root, 'config.ts')}`,
      );
    });

    it('refuses an untrusted package that is not installed as untrusted, not as module-not-found', async () => {
      const root = makeProject();

      await expect(transformFor()(root, { extends: '@acme/not-installed' })).rejects.toThrow(/untrusted preset '@acme\/not-installed'/);
    });

    it('does not resolve or import a reference it refuses', async () => {
      const { importer } = createJitiLoader();
      const resolve = vi.spyOn(importer, 'resolve');
      const importDefault = vi.spyOn(importer, 'importDefault');
      const transform = createExtendsTransform({ importer });

      await expect(transform({ config: { extends: 'third-party' }, filepath: configFileIn(makeProject()) })).rejects.toThrow(/untrusted/);
      expect(resolve).not.toHaveBeenCalled();
      expect(importDefault).not.toHaveBeenCalled();
    });

    it('refuses an untrusted transitive base even when the preset that names it is trusted', async () => {
      const root = makeProject({ 'node_modules/stack/package.json': JSON.stringify({ name: 'stack', type: 'module', main: 'index.js' }), 'node_modules/stack/index.js': "export default { extends: 'base' };\n" });
      const trust = ({ ref }: TrustContext) => ref === 'stack';

      await expect(transformFor({ trust })(root, { extends: 'stack' })).rejects.toThrow(/untrusted preset 'base' \(package\) named in .*stack\/index\.js/);
    });

    it('admits a package the predicate allows', async () => {
      const root = makeProject({
        'node_modules/allowed/package.json': JSON.stringify({ name: 'allowed', type: 'module', main: 'index.js' }),
        'node_modules/allowed/index.js': "export default { v: 'allowed' };\n",
      });

      expect(await transformFor({ trust: ({ ref }) => ref === 'allowed' })(root, { extends: 'allowed' })).toEqual({ v: 'allowed' });
    });

    it('refuses when the predicate returns anything but true, such as the promise of an asynchronous one', async () => {
      const root = makeProject({ 'a.ts': preset("{ v: 'a' }") });
      const asynchronous = vi.fn().mockResolvedValue(false);

      await expect(transformFor({ trust: asynchronous })(root, { extends: './a.ts' })).rejects.toThrow(/refusing to load untrusted preset/);
    });

    it('lets the predicate throw its own message', async () => {
      const root = makeProject();
      const trust = ({ ref }: TrustContext): boolean => {
        throw new Error(`'${ref}' is not loadable here`);
      };

      await expect(transformFor({ trust })(root, { extends: 'self' })).rejects.toThrow("'self' is not loadable here");
    });

    it.each([
      ['./local.ts', 'local'],
      ['../up.ts', 'local'],
      ['.', 'local'],
      ['..', 'local'],
      ['/abs/path.ts', 'local'],
      ['pkg', 'package'],
      ['@scope/pkg', 'package'],
      ['pkg/sub/path', 'package'],
      ['.hidden-package', 'package'],
      ['..two-dots-package', 'package'],
      ['pkg/../escape', 'package'],
      ['pkg/..', 'package'],
    ] as const)('classifies %s as %s', async (ref, kind) => {
      const contexts: TrustContext[] = [];
      const trust = (context: TrustContext) => {
        contexts.push(context);

        return false;
      };
      const root = makeProject();
      await transformFor({ trust })(root, { extends: ref }).catch(() => undefined);

      expect(contexts).toEqual([{ ref, kind, fromFile: join(root, 'config.ts') }]);
    });
  });

  describe('cycles', () => {
    it('rejects two presets that extend each other, listing the resolved files', async () => {
      const root = makeProject({ 'a.ts': preset("{ extends: './b.ts' }"), 'b.ts': preset("{ extends: './a.ts' }") });

      await expect(transformFor()(root, { extends: './a.ts' })).rejects.toThrow(
        `extends cycle detected: ${join(root, 'config.ts')} -> ${join(root, 'a.ts')} -> ${join(root, 'b.ts')} -> ${join(root, 'a.ts')}`,
      );
    });

    it('rejects a preset that extends itself', async () => {
      const root = makeProject({ 'a.ts': preset("{ extends: './a.ts' }") });

      await expect(transformFor()(root, { extends: './a.ts' })).rejects.toThrow(/extends cycle detected/);
    });

    it('rejects a config that extends itself, because the root is seeded', async () => {
      const root = makeProject({ 'config.ts': preset("{ extends: './config.ts' }") });

      await expect(transformFor()(root, { extends: './config.ts' })).rejects.toThrow(/extends cycle detected/);
    });

    it('rejects a preset that extends the root config', async () => {
      const root = makeProject({ 'config.ts': preset("{ extends: './a.ts' }"), 'a.ts': preset("{ extends: './config.ts' }") });

      await expect(transformFor()(root, { extends: './a.ts' })).rejects.toThrow(/extends cycle detected/);
    });

    it('compares resolved paths, so two spellings of one file are the same node', async () => {
      const root = makeProject({ 'presets/a.ts': preset("{ extends: '../presets/a.ts' }") });

      await expect(transformFor()(root, { extends: './presets/a.ts' })).rejects.toThrow(/extends cycle detected/);
    });

    it('rejects a config reached through a symlink that extends itself, before importing anything', async () => {
      const root = makeProject({ 'config.ts': preset("{ extends: './config.ts' }") });
      const linkDir = realpathSync(mkdtempSync(join(tmpdir(), 'cosmiconfig-extends-link-')));
      const link = join(linkDir, 'linked');
      symlinkSync(root, link);
      const { importer } = createJitiLoader();
      const importDefault = vi.spyOn(importer, 'importDefault');
      const transform = createExtendsTransform({ importer });

      await expect(transform({ config: { extends: './config.ts' }, filepath: join(link, 'config.ts') })).rejects.toThrow(
        /extends cycle detected/,
      );
      expect(importDefault).not.toHaveBeenCalled();
    });

    it('does not treat a diamond as a cycle', async () => {
      const root = makeProject({
        'base.ts': preset("{ onlyBase: true }"),
        'left.ts': preset("{ extends: './base.ts', onlyLeft: true }"),
        'right.ts': preset("{ extends: './base.ts', onlyRight: true }"),
      });

      expect(await transformFor()(root, { extends: ['./left.ts', './right.ts'] })).toEqual({
        onlyBase: true,
        onlyLeft: true,
        onlyRight: true,
      });
    });

    it('does not treat a repeated sibling as a cycle', async () => {
      const root = makeProject({ 'a.ts': preset("{ v: 'a' }") });

      expect(await transformFor()(root, { extends: ['./a.ts', './a.ts'] })).toEqual({ v: 'a' });
    });
  });

  describe('validation', () => {
    it('validates each preset and replaces it with the schema output', async () => {
      const presetSchema = z.object({ v: z.string(), extends: z.string().optional() });
      const root = makeProject({ 'a.ts': preset("{ v: 'a', stripped: true }") });

      expect(await transformFor({ presetSchema })(root, { extends: './a.ts' })).toEqual({ v: 'a' });
    });

    it('validates a transitive preset', async () => {
      const presetSchema = z.object({ v: z.string(), extends: z.string().optional() });
      const root = makeProject({ 'a.ts': preset("{ extends: './b.ts', v: 'a' }"), 'b.ts': preset('{ v: false }') });
      const error = await transformFor({ presetSchema })(root, { extends: './a.ts' }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConfigValidationError);
      expect(error).toMatchObject({ message: expect.stringContaining("invalid preset './b.ts'") as unknown });
    });

    it('rejects a preset whose export is not an object', async () => {
      const root = makeProject({ 'a.ts': preset("'text'"), 'list.ts': preset("['x']") });

      await expect(transformFor()(root, { extends: './a.ts' })).rejects.toThrow("preset './a.ts' is not an object");
      await expect(transformFor()(root, { extends: './list.ts' })).rejects.toThrow("preset './list.ts' is not an object");
    });

    it('rejects a null preset, which an importer other than jiti can return', async () => {
      const importer = { resolve: () => '/x/null.ts', importDefault: async () => Promise.resolve(null) };

      await expect(createExtendsTransform({ importer })({ config: { extends: './null.ts' }, filepath: configFileIn(makeProject()) })).rejects.toThrow(
        "preset './null.ts' is not an object",
      );
    });

    it('validates the effective config, applies its defaults and names the file on failure', async () => {
      const schema = z.object({ v: z.string(), mode: z.string().default('strict') });
      const root = makeProject({ 'a.ts': preset("{ v: 'a' }") });

      expect(await transformFor({ schema })(root, { extends: './a.ts' })).toEqual({ v: 'a', mode: 'strict' });
      await expect(transformFor({ schema })(root, { extends: './a.ts', v: false })).rejects.toThrow(
        `invalid config ${join(root, 'config.ts')}:\n  v: `,
      );
    });

    it('leaves the effective config to the preset chain: a preset can supply a field the schema requires', async () => {
      const schema = z.object({ required: z.string() });
      const root = makeProject({ 'a.ts': preset("{ required: 'from preset' }") });

      expect(await transformFor({ schema })(root, { extends: './a.ts' })).toEqual({ required: 'from preset' });
    });
  });

  describe('the extends value', () => {
    it.each([[1], [''], [['./ok.ts', 2]], [[[]]], [{}], [null]])('rejects %j', async (value) => {
      const root = makeProject({ 'ok.ts': preset('{}') });

      await expect(transformFor()(root, { extends: value })).rejects.toThrow(
        `invalid ${join(root, 'config.ts')}: 'extends' must be a non-empty string or an array of them`,
      );
    });

    it('names the preset that carries an invalid extends value', async () => {
      const root = makeProject({ 'a.ts': preset('{ extends: 1 }') });

      await expect(transformFor()(root, { extends: './a.ts' })).rejects.toThrow(`invalid ${join(root, 'a.ts')}: 'extends'`);
    });

    it('treats an undefined extends value as absent', async () => {
      const root = makeProject();

      expect(await transformFor()(root, { extends: undefined, a: 'x' })).toEqual({ a: 'x' });
    });
  });
});
