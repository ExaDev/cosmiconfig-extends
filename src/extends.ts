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
   * The reference exactly as written in the `extends` value.
   */
  readonly ref: string;
  /**
   * `local` for a relative or absolute path, `package` for a bare or scoped specifier.
   */
  readonly kind: 'local' | 'package';
  /**
   * Absolute path of the file whose `extends` names this reference.
   */
  readonly fromFile: string;
}

/**
 * Decides whether a reference may be loaded. Loading a preset evaluates its code, so this is called with the unresolved reference before it is resolved or imported: an untrusted package that is not installed fails as untrusted rather than as module-not-found, and no file system is probed for it. Return `false` for the default refusal message, or throw for a more specific one.
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

const LOCAL_REF = /^\.{1,2}(?:[/\\]|$)/;

function isLocalRef(ref: string): boolean {
  return LOCAL_REF.test(ref) || isAbsolute(ref);
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
 * For each reference the file names, in order: the trust predicate runs, the reference resolves from the directory of the file that names it (so a nested preset's relative reference is relative to that preset, as in tsconfig), and the path it resolves to is checked against the files currently being loaded to reject a cycle. The importer resolves to real paths, so the config's own path is canonicalised the same way before it seeds that list. The same base reached by two parents is a diamond, not a cycle. The layers are then folded through `merge`, deepest base first and the config last.
 */
export function createExtendsTransform(options: ExtendsOptions): Transform {
  const { importer, trust = ({ kind }) => kind === 'local', merge = deepMerge, extendsKey = 'extends' } = options;

  async function layersFor(layer: unknown, fromFile: string, loading: readonly string[]): Promise<readonly unknown[]> {
    const layers: unknown[] = [];
    for (const ref of refsOf(layer, extendsKey, fromFile)) {
      const kind = isLocalRef(ref) ? 'local' : 'package';
      if (!trust({ ref, kind, fromFile })) {
        throw new Error(`refusing to load untrusted preset '${ref}' (${kind}) named in ${fromFile}: loading a preset runs its code`);
      }

      const resolved = importer.resolve(ref, dirname(fromFile));
      if (loading.includes(resolved)) {
        throw new Error(`extends cycle detected: ${[...loading, resolved].join(' -> ')}`);
      }

      const exported = await importer.importDefault(resolved);
      const preset =
        options.presetSchema === undefined ? exported : await validateStandard(options.presetSchema, exported, `preset '${ref}'`);
      if (!isRecord(preset)) {
        throw new TypeError(`preset '${ref}' is not an object`);
      }

      layers.push(...(await layersFor(preset, resolved, [...loading, resolved])), withoutKey(preset, extendsKey));
    }

    return layers;
  }

  return async (result) => {
    if (result === null || result.isEmpty === true) {
      return result;
    }

    const config: unknown = result.config;
    const { filepath } = result;
    const layers = [...(await layersFor(config, filepath, [realpathSync(filepath)])), withoutKey(config, extendsKey)];
    const merged = layers.reduce<unknown>((accumulated, layer) => merge(accumulated, layer), {});
    const effective = options.schema === undefined ? merged : await validateStandard(options.schema, merged, `config ${filepath}`);

    return { ...result, config: effective };
  };
}
