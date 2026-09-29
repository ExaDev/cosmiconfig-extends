import { statSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Loader } from 'cosmiconfig';
import { createJiti } from 'jiti';

import { defaultExportOf } from './module-namespace';

/**
 * Options for {@link createJitiLoader}.
 */
export interface JitiLoaderOptions {
  /**
   * Import specifier to absolute directory path, applied by jiti to every import made by a loaded file. jiti matches aliases by prefix, so an alias to a file would turn a subpath import (`my-tool/extra`) into `<file>/extra`; a directory serves the bare specifier and its subpaths alike. Each target must therefore be an absolute path to an existing directory, which {@link createJitiLoader} verifies when it is called.
   */
  readonly alias?: Readonly<Record<string, string>>;
  /**
   * jiti's on-disk transpile cache: `true` for its default location, `false` for none, or a directory path. Keyed by file content, so it never serves stale results and stays on by default. It is always passed to jiti explicitly, because jiti otherwise reads the `JITI_FS_CACHE` environment variable.
   */
  readonly fsCache?: boolean | string;
}

/**
 * Resolves references and evaluates modules through one aliased jiti configuration.
 */
export interface ModuleImporter {
  /**
   * Resolve `ref` to an absolute path as jiti would from a file in `fromDir`, applying the loader's aliases. Throws if the reference cannot be resolved.
   */
  resolve: (ref: string, fromDir: string) => string;
  /**
   * Evaluate the module at `absolutePath` and return its default export.
   */
  importDefault: (absolutePath: string) => Promise<unknown>;
}

/**
 * A cosmiconfig loader and the importer it is built on.
 */
export interface JitiLoader {
  /**
   * A cosmiconfig `Loader` (identical in cosmiconfig 9 and 10) that evaluates a TypeScript file and returns its default export.
   */
  readonly loader: Loader;
  readonly importer: ModuleImporter;
}

function assertAliasTargetsAreDirectories(alias: Readonly<Record<string, string>>): void {
  for (const [specifier, target] of Object.entries(alias)) {
    if (!isAbsolute(target) || statSync(target, { throwIfNoEntry: false })?.isDirectory() !== true) {
      throw new TypeError(`alias '${specifier}' must be an absolute path to an existing directory, got '${target}'`);
    }
  }
}

/**
 * Create a jiti-backed cosmiconfig loader.
 *
 * `moduleCache` is always `false`: jiti's in-process module cache survives cosmiconfig's `clearCaches()` and `cache: false`, so leaving it on serves a stale config, and stale transitive imports, after a file changes within one process.
 */
export function createJitiLoader(options: JitiLoaderOptions = {}): JitiLoader {
  const { alias, fsCache = true } = options;
  if (alias !== undefined) {
    assertAliasTargetsAreDirectories(alias);
  }

  const jitiFor = (dir: string) =>
    createJiti(pathToFileURL(`${dir}/`).href, {
      alias: { ...alias },
      fsCache,
      moduleCache: false,
    });

  const importDefault = async (absolutePath: string): Promise<unknown> =>
    defaultExportOf(await jitiFor(dirname(absolutePath)).import(absolutePath));

  return {
    loader: async (filepath) => importDefault(filepath),
    importer: {
      resolve: (ref, fromDir) => fileURLToPath(jitiFor(fromDir).esmResolve(ref)),
      importDefault,
    },
  };
}
