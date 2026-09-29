import { realpathSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Transform } from 'cosmiconfig';

import type { ModuleImporter } from './loader';
import { deepMerge, type Merge } from './merge';
import { validateStandard } from './validate';

/**
 * What a {@link TrustPredicate} is asked about.
 */
export interface TrustContext {
  /**
   * The reference exactly as written in the `extends` value, except for the second question asked about a local reference that resolves into an installed package other than the one that names it: that asks again with `kind: 'package'` and `ref` set to the name of the package it reached (`@scope/name` or `name`), so a predicate decides on package names however they were spelt.
   */
  readonly ref: string;
  /**
   * `local` for a relative path, an absolute path or a `file:` URL, `package` for a bare or scoped specifier. A reference that could resolve outside what it appears to name (`.`, `..`, or a package specifier with an empty, `.` or `..` segment) is rejected as invalid before the predicate is asked.
   */
  readonly kind: 'local' | 'package';
  /**
   * Absolute path of the file whose `extends` names this reference.
   */
  readonly fromFile: string;
}

/**
 * Decides whether a reference may be loaded. Loading a preset evaluates its code, so this is called with the reference before it is resolved or imported: an untrusted package that is not installed fails as untrusted rather than as module-not-found, and no file system is probed for it. A decision on a package is by name only: the same name can resolve to a different installed copy depending on hoisting and on which file names it, since a reference resolves from the directory of the file that names it, and the predicate never sees the resolved path. Only the boolean `true` admits a reference: any other return value, including the promise of an asynchronous predicate, refuses it. Return `false` for the default refusal message, or throw for a more specific one.
 */
export type TrustPredicate = (context: TrustContext) => boolean;

/**
 * Options for {@link createExtendsTransform}.
 */
export interface ExtendsOptions {
  /**
   * Resolves and evaluates the config and every preset it extends; see {@link createJitiLoader}.
   */
  readonly importer: ModuleImporter;
  /**
   * Trust decision for each reference. The default trusts local paths and refuses packages.
   */
  readonly trust?: TrustPredicate;
  /**
   * How layers combine: the deepest base first, then each preset, then the config itself. The default is {@link deepMerge}, where a preset supplies defaults and the config overrides them.
   */
  readonly merge?: Merge;
  /**
   * Validates each preset before it is merged. Its output replaces the preset, so it must keep the `extends` key for the chain to continue, and must not apply defaults, which would turn "no opinion" into an override.
   */
  readonly presetSchema?: StandardSchemaV1;
  /**
   * Validates the effective merged config. Its output, including any defaults it applies, replaces the config.
   */
  readonly schema?: StandardSchemaV1;
  /**
   * The key that names the presets to extend. Defaults to `extends`. It is removed from every layer before merging.
   */
  readonly extendsKey?: string;
}

const LOCAL_REF = /^\.{1,2}[/\\]/;
const FILE_URL_SCHEME = 'file:';
const PATH_SEPARATOR = /[/\\]/;
const DIRECTORY_REF = /^\.{1,2}$/;

/**
 * Classify a reference, rejecting spellings whose meaning depends on how a resolver reads them. `.` and `..` name a directory, not a file. A package specifier with an empty, `.` or `..` segment would resolve outside the package or scope it appears to name (`@scope/../other` loads `other`), so a predicate that checks the text could admit a different package.
 */
function classify(ref: string, key: string, fromFile: string): TrustContext['kind'] {
  if (DIRECTORY_REF.test(ref)) {
    throw new TypeError(`invalid ${key} '${ref}' in ${fromFile}: it names a directory, not a file`);
  }

  if (LOCAL_REF.test(ref) || ref.startsWith(FILE_URL_SCHEME) || isAbsolute(ref)) {
    return 'local';
  }

  if (ref.split(PATH_SEPARATOR).some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new TypeError(`invalid ${key} '${ref}' in ${fromFile}: a package specifier must not contain an empty or dot segment`);
  }

  return 'package';
}

const PACKAGE_DIRECTORY = /^.*[/\\]node_modules[/\\]((?:@[^/\\]+[/\\])?[^/\\]+)[/\\]/;

/**
 * The name of the installed package that contains `absolutePath`, taken from the innermost `node_modules` directory in it, or `undefined` for a file outside any `node_modules`.
 */
function packageOf(absolutePath: string): string | undefined {
  return PACKAGE_DIRECTORY.exec(absolutePath)?.[1]?.replace('\\', '/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function refsOf(layer: unknown, key: string, source: string): readonly string[] {
  if (!isRecord(layer) || layer[key] === undefined) {
    return [];
  }

  const value = layer[key];
  const refs: readonly unknown[] = Array.isArray(value) ? value : [value];
  const valid = refs.filter((ref): ref is string => typeof ref === 'string' && ref.length > 0);
  if (valid.length !== refs.length) {
    throw new TypeError(`invalid ${source}: '${key}' must be a non-empty string or an array of them`);
  }

  return valid;
}

function withoutKey(layer: unknown, key: string): unknown {
  if (!isRecord(layer)) {
    return layer;
  }

  return Object.fromEntries(Object.entries(layer).filter(([name]) => name !== key));
}

/**
 * Create a cosmiconfig `Transform` (the same in cosmiconfig 9 and 10) that applies `extends`.
 *
 * For each reference the file names, in order: the trust predicate runs, the reference resolves from the directory of the file that names it (so a nested preset's relative reference is relative to that preset, as in tsconfig), a local reference that resolved into a different installed package is put to the predicate again as that package, and the path it resolves to is checked against the files currently being loaded to reject a cycle. The importer resolves to real paths, so the config's own path is canonicalised the same way before it seeds that list. The same base reached by two parents is a diamond, not a cycle. The layers are then folded through `merge`, deepest base first and the config last.
 */
export function createExtendsTransform(options: ExtendsOptions): Transform {
  const { importer, trust = ({ kind }) => kind === 'local', merge = deepMerge, extendsKey = 'extends' } = options;

  function assertTrusted(context: TrustContext, written: string = context.ref): void {
    // Typed `unknown` because a JavaScript caller can return a non-boolean, and a promise or any truthy value must not admit the reference.
    const decision: unknown = trust(context);
    if (decision !== true) {
      const subject = written === context.ref ? `'${written}' (${context.kind})` : `'${written}' (package '${context.ref}')`;
      throw new Error(`refusing to load untrusted preset ${subject} named in ${context.fromFile}: loading a preset runs its code`);
    }
  }

  /**
   * A local reference is trusted by its spelling, but where it resolves decides what code runs. Resolved into an installed package other than the one that names it, it is a package load and the predicate is asked about that package by name. Left outside any package by a file that is inside one, it is refused, because nothing names what it reaches.
   */
  function assertStaysInPackage(ref: string, fromFile: string, fromReal: string, resolved: string): void {
    const owner = packageOf(fromReal);
    const target = packageOf(resolved);
    if (target !== undefined) {
      if (target !== owner) {
        assertTrusted({ ref: target, kind: 'package', fromFile }, ref);
      }
    } else if (owner !== undefined) {
      throw new Error(`refusing to load '${ref}' named in ${fromFile}: it resolves outside the package '${owner}' that names it`);
    }
  }

  async function layersFor(layer: unknown, fromFile: string, loading: readonly string[], fromReal: string): Promise<readonly unknown[]> {
    const layers: unknown[] = [];
    for (const ref of refsOf(layer, extendsKey, fromFile)) {
      const kind = classify(ref, extendsKey, fromFile);
      assertTrusted({ ref, kind, fromFile });

      const resolved = importer.resolve(ref, dirname(fromFile));
      if (kind === 'local') {
        assertStaysInPackage(ref, fromFile, fromReal, resolved);
      }

      if (loading.includes(resolved)) {
        throw new Error(`extends cycle detected: ${[...loading, resolved].join(' -> ')}`);
      }

      const exported = await importer.importDefault(resolved);
      const preset =
        options.presetSchema === undefined ? exported : await validateStandard(options.presetSchema, exported, `preset '${ref}'`);
      if (!isRecord(preset)) {
        throw new TypeError(`preset '${ref}' is not an object`);
      }

      layers.push(...(await layersFor(preset, resolved, [...loading, resolved], resolved)), withoutKey(preset, extendsKey));
    }

    return layers;
  }

  return async (result) => {
    if (result === null || result.isEmpty === true) {
      return result;
    }

    const config: unknown = result.config;
    const { filepath } = result;
    const real = realpathSync(filepath);
    const layers = [...(await layersFor(config, filepath, [real], real)), withoutKey(config, extendsKey)];
    const merged = layers.reduce<unknown>((accumulated, layer) => merge(accumulated, layer), {});
    const effective = options.schema === undefined ? merged : await validateStandard(options.schema, merged, `config ${filepath}`);

    return { ...result, config: effective };
  };
}
