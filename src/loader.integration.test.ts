import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeProject, writeProjectFile } from '../test/support/project';

import { createJitiLoader } from './loader';

describe('createJitiLoader', () => {
  it('evaluates a TypeScript file and returns its default export', async () => {
    const root = makeProject({ 'config.ts': "const value: { readonly a: number } = { a: 1 };\nexport default value;\n" });
    const { loader } = createJitiLoader();

    expect(await loader(join(root, 'config.ts'), '')).toEqual({ a: 1 });
  });

  it('returns the namespace when the file has no default export', async () => {
    const root = makeProject({ 'config.ts': "export const named = 'x';\n" });
    const { importer } = createJitiLoader();

    expect(await importer.importDefault(join(root, 'config.ts'))).toEqual({ named: 'x' });
  });

  describe('alias', () => {
    const barrel = "export const BARREL = 'barrel';\n";

    it('serves the bare specifier and its subpaths from a directory target', async () => {
      const root = makeProject({
        'lib/index.ts': barrel,
        'lib/extra.ts': "export const EXTRA = 'extra';\n",
        'config.ts': "import { BARREL } from 'my-tool';\nimport { EXTRA } from 'my-tool/extra';\nexport default { BARREL, EXTRA };\n",
      });
      const { importer } = createJitiLoader({ alias: { 'my-tool': join(root, 'lib') } });

      expect(await importer.importDefault(join(root, 'config.ts'))).toEqual({ BARREL: 'barrel', EXTRA: 'extra' });
    });

    it('wins over a package of the same name in node_modules', async () => {
      const root = makeProject({
        'lib/index.ts': barrel,
        'node_modules/my-tool/package.json': JSON.stringify({ name: 'my-tool', main: 'index.js' }),
        'node_modules/my-tool/index.js': "module.exports = { BARREL: 'decoy' };\n",
        'config.ts': "import { BARREL } from 'my-tool';\nexport default BARREL;\n",
      });
      const { importer } = createJitiLoader({ alias: { 'my-tool': join(root, 'lib') } });

      expect(await importer.importDefault(join(root, 'config.ts'))).toBe('barrel');
    });

    it('applies to resolve as well as to import', () => {
      const root = makeProject({ 'lib/index.ts': barrel });
      const { importer } = createJitiLoader({ alias: { 'my-tool': join(root, 'lib') } });

      expect(importer.resolve('my-tool', root)).toBe(join(root, 'lib', 'index.ts'));
    });

    it('rejects a target that is a file, because a file breaks subpath imports', () => {
      const root = makeProject({ 'lib/index.ts': barrel });

      expect(() => createJitiLoader({ alias: { 'my-tool': join(root, 'lib', 'index.ts') } })).toThrow(
        /alias 'my-tool' must be an absolute path to an existing directory/,
      );
    });

    it('rejects a target that does not exist', () => {
      const root = makeProject();

      expect(() => createJitiLoader({ alias: { 'my-tool': join(root, 'missing') } })).toThrow(/alias 'my-tool'/);
    });

    it('rejects a relative target', () => {
      makeProject({ 'lib/index.ts': barrel });

      expect(() => createJitiLoader({ alias: { 'my-tool': '.' } })).toThrow(/alias 'my-tool'/);
    });

    it('accepts a frozen alias object, which jiti would otherwise normalise in place', async () => {
      const root = makeProject({ 'lib/index.ts': barrel, 'config.ts': "import { BARREL } from 'my-tool';\nexport default BARREL;\n" });
      const { importer } = createJitiLoader({ alias: Object.freeze({ 'my-tool': join(root, 'lib') }) });

      expect(await importer.importDefault(join(root, 'config.ts'))).toBe('barrel');
    });
  });

  describe('module cache', () => {
    it('re-evaluates a rewritten config and a rewritten import within one process', async () => {
      const root = makeProject({
        'dep.ts': "export const dep = 'one';\n",
        'config.ts': "import { dep } from './dep';\nexport default dep;\n",
      });
      const { loader } = createJitiLoader();
      const file = join(root, 'config.ts');

      expect(await loader(file, '')).toBe('one');

      writeProjectFile(root, 'dep.ts', "export const dep = 'two';\n");

      expect(await loader(file, '')).toBe('two');
    });
  });

  describe('module formats', () => {
    const formats: readonly (readonly [string, string, (value: string) => string])[] = [
      ['.ts', 'module', (value) => `export default { value: '${value}' };\n`],
      ['.mjs', 'module', (value) => `export default { value: '${value}' };\n`],
      ['.js', 'module', (value) => `export default { value: '${value}' };\n`],
      ['.js', 'commonjs', (value) => `module.exports = { value: '${value}' };\n`],
      ['.cjs', 'module', (value) => `module.exports = { value: '${value}' };\n`],
      ['.json', 'module', (value) => JSON.stringify({ value })],
    ];

    it.each(formats)('re-evaluates a rewritten %s file in a %s package', async (extension, type, body) => {
      const file = `preset${extension}`;
      const root = makeProject({ 'package.json': JSON.stringify({ type }), [file]: body('one') });
      const { importer } = createJitiLoader();

      expect(await importer.importDefault(join(root, file))).toEqual({ value: 'one' });

      writeProjectFile(root, file, body('two'));

      expect(await importer.importDefault(join(root, file))).toEqual({ value: 'two' });
    });
  });

  describe('environment', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('keeps aliases and fresh reloads when JITI_TRY_NATIVE asks for native imports', async () => {
      vi.stubEnv('JITI_TRY_NATIVE', 'true');
      const root = makeProject({
        'lib/index.ts': "export const WHO = 'barrel';\n",
        'node_modules/my-tool/package.json': JSON.stringify({ name: 'my-tool', main: 'index.js', type: 'module' }),
        'node_modules/my-tool/index.js': "export const WHO = 'decoy';\n",
        'package.json': JSON.stringify({ type: 'module' }),
        'dep.ts': "export const dep = 'one';\n",
        'config.ts': "import { WHO } from 'my-tool';\nimport { dep } from './dep.ts';\nexport default { WHO, dep };\n",
      });
      const { importer } = createJitiLoader({ alias: { 'my-tool': join(root, 'lib') } });
      const file = join(root, 'config.ts');

      expect(await importer.importDefault(file)).toEqual({ WHO: 'barrel', dep: 'one' });

      writeProjectFile(root, 'dep.ts', "export const dep = 'two';\n");

      expect(await importer.importDefault(file)).toEqual({ WHO: 'barrel', dep: 'two' });
    });
  });

  describe('fsCache', () => {
    function cacheEntries(root: string): readonly string[] {
      const cacheDir = join(root, 'node_modules', '.cache', 'jiti');

      return existsSync(cacheDir) ? readdirSync(cacheDir) : [];
    }

    it('writes jiti transpile cache entries by default', async () => {
      const root = makeProject({ 'node_modules/.keep': '', 'config.ts': "export default 'x';\n" });
      await createJitiLoader().loader(join(root, 'config.ts'), '');

      expect(cacheEntries(root)).not.toHaveLength(0);
    });

    it('writes nothing when disabled', async () => {
      const root = makeProject({ 'node_modules/.keep': '', 'config.ts': "export default 'x';\n" });
      await createJitiLoader({ fsCache: false }).loader(join(root, 'config.ts'), '');

      expect(cacheEntries(root)).toHaveLength(0);
    });

    it('writes to the directory it is given', async () => {
      const root = makeProject({ 'config.ts': "export default 'x';\n" });
      const cacheDir = join(root, 'custom-cache');
      await createJitiLoader({ fsCache: cacheDir }).loader(join(root, 'config.ts'), '');

      expect(readdirSync(cacheDir)).not.toHaveLength(0);
    });

    it('is not overridden by the JITI_FS_CACHE environment variable', async () => {
      const root = makeProject({ 'node_modules/.keep': '', 'config.ts': "export default 'x';\n" });
      process.env['JITI_FS_CACHE'] = 'false';
      try {
        await createJitiLoader().loader(join(root, 'config.ts'), '');
      } finally {
        delete process.env['JITI_FS_CACHE'];
      }

      expect(cacheEntries(root)).not.toHaveLength(0);
    });

    it('serves a rewritten file rather than a stale transpile', async () => {
      const root = makeProject({ 'config.ts': "export default 'one';\n" });
      const { loader } = createJitiLoader({ fsCache: join(root, 'cache') });

      expect(await loader(join(root, 'config.ts'), '')).toBe('one');

      writeProjectFile(root, 'config.ts', "export default 'two';\n");

      expect(await loader(join(root, 'config.ts'), '')).toBe('two');
    });
  });
});
