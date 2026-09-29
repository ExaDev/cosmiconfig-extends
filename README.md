# cosmiconfig-extends

A jiti-backed TypeScript loader and a trust-gated `extends` transform for [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig) 9 and 10, with configurable merging and [Standard Schema](https://standardschema.dev) validation.

## Getting started

```sh
pnpm add cosmiconfig-extends cosmiconfig zod
```

`zod` is only for the example below: `schema` and `presetSchema` accept any [Standard Schema](https://standardschema.dev) library. `cosmiconfig` is a peer dependency (`^9.0.0 || ^10.0.0`). The package supports Node 20 and later. cosmiconfig 10 itself declares Node `^22.18 || >=24`, so a consumer on an older Node sees an engines warning from cosmiconfig, not from this package. Only cosmiconfig's own default `.ts` loading depends on that Node version, and this package replaces it.

```ts
import { createExplorer } from 'cosmiconfig-extends';
import { z } from 'zod';

const explorer = createExplorer('my-tool', {
  schema: z.object({ target: z.string(), features: z.array(z.string()).default([]) }),
});

const result = await explorer.search();
// result?.config is the merged, validated config; result?.filepath is the file that was found.
```

`createExplorer` returns a standard cosmiconfig explorer. It registers the jiti loader for `.ts`, `.mts` and `.cts`, and applies `extends` to every result. cosmiconfig's default `searchPlaces` list only `.ts`, so `search()` does not find `my-tool.config.mts` or `my-tool.config.cts`: reach those through `load()` or through your own `cosmiconfig.searchPlaces`. A config that exports `undefined` is empty, and `search()` skips it as cosmiconfig skips any empty file. A config file:

```ts
// my-tool.config.ts
export default {
  extends: ['./presets/base.ts', 'shared-preset'],
  target: 'node',
};
```

The package `shared-preset` is refused by default. See [the `extends` transform](#the-extends-transform) for how to allow it.

## Using the pieces with plain cosmiconfig

Each part works on its own with a cosmiconfig explorer you build yourself:

```ts
import { cosmiconfig } from 'cosmiconfig';
import { createExtendsTransform, createJitiLoader } from 'cosmiconfig-extends';

const { loader, importer } = createJitiLoader();
const explorer = cosmiconfig('my-tool', {
  loaders: { '.ts': loader, '.mts': loader, '.cts': loader },
  transform: createExtendsTransform({ importer }),
});
```

The `Loader` and `Transform` types are identical in cosmiconfig 9 and 10, so the same code serves both. Leave `transform` out to get a TypeScript loader without `extends`.

## The loader

`createJitiLoader(options)` returns `{ loader, importer }`. `loader` is a cosmiconfig `Loader` that evaluates a TypeScript file and returns its default export. `importer` resolves and evaluates the presets that `extends` names, through the same aliased jiti configuration.

**`alias`** maps an import specifier to an absolute directory, and applies to every import a loaded file makes. It lets a config import its authoring helpers by their public specifier (`import { defineConfig } from 'my-tool'`) whatever the install layout: without it the import fails in one layout and silently resolves an unrelated copy in another. jiti matches aliases by prefix, so a target that is a file would turn a subpath import into `<file>/extra`. Each target must therefore be an existing directory, and `createJitiLoader` throws otherwise.

**`fsCache`** controls jiti's on-disk transpile cache: `true` (the default), `false`, or a directory. The cache is keyed by file content and never serves a stale result. The loader always passes it to jiti explicitly, because jiti otherwise reads the `JITI_FS_CACHE` environment variable.

**Native imports are always off.** jiti's `tryNative` option defaults to on under Bun and follows `JITI_TRY_NATIVE`. A native import ignores `alias` and is served from the runtime's own module cache, so the loader always passes `tryNative: false` and no `JITI_*` variable can change which file is loaded.

**The module cache is always off.** jiti's in-process module cache survives cosmiconfig's `clearCaches()` and `cache: false`, so leaving it on serves a stale config after a file changes within one process. The loader turns it off, and additionally reads and evaluates every config and preset file it is asked for afresh, whatever its format (`.ts`, `.mjs`, `.cjs`, `.js`, `.json`): jiti hands `.mjs`, `.cjs` and `.js` files to the runtime's own module cache, which nothing can clear, so a JavaScript preset would otherwise stay stale.

The freshness covers the file itself and the TypeScript it imports. A JavaScript module imported by a config or preset, and any module in `node_modules`, is loaded by the runtime and stays cached for the life of the process, even after `clearCaches()`.

## The `extends` transform

`createExtendsTransform(options)` returns a cosmiconfig `Transform`. The transform receives `{ config, filepath }`, or `null` when nothing was found, and returns the same shape.

For each reference in `extends` (a string or an array), in order:

1. **Trust.** The `trust` predicate runs first, on the unresolved reference. Loading a preset evaluates its code, so nothing is resolved or imported for a reference that is refused, and an untrusted package that is not installed fails as untrusted, not as module-not-found. The default trusts local paths (`./`, `../`, absolute paths and `file:` URLs) and refuses packages. A reference that could resolve outside what it appears to name is rejected as invalid before the predicate runs: `.` and `..` (directories, not files) and a package specifier with an empty, `.` or `..` segment (`@scope/../other` would load `other`, and pass a scope-prefix check). The predicate receives `{ ref, kind, fromFile }`, returns a boolean, and may throw for a more specific message. Trust is checked for every reference at every depth, so an allowed preset cannot name an untrusted base by package name. A local path is trusted by its spelling, but where it resolves decides what code runs: a local reference that resolves into an installed package other than the one that names it (`../evil/index.ts` from a preset in `node_modules`, or `./node_modules/evil/index.ts` from your config) is put to the predicate again with `kind: 'package'` and the package's name as `ref`, and one that leaves the package that names it for a place outside any package is refused.
2. **Resolution.** The reference resolves from the directory of the file that names it, as in tsconfig and ESLint. A preset's own `extends: './base.ts'` is relative to that preset.
3. **Cycles.** The resolved path is compared with the files currently being loaded, starting with the config itself, whose `filepath` is resolved to its real path first, so it must name an existing file, as cosmiconfig's results do. Two spellings of one file, including a path through a symlink, are the same node. A base reached through two parents (a diamond) is not a cycle.
4. **Validation.** With `presetSchema`, each preset is validated and replaced by the schema output. The schema must keep the `extends` key, and must not apply defaults, since a default would turn "no opinion" into an override.
5. **Recursion.** The preset's own `extends` is processed depth-first.

The layers are then folded through `merge`, deepest base first and the config itself last, so a preset supplies defaults and the config overrides them. The `extends` key is removed from every layer. With `schema`, the merged result is validated and the schema output, including its defaults, replaces the config.

`extendsKey` changes the key the transform reads.

### Trust

A trust decision on a package is by name only. The same allowed name can resolve to a different installed copy depending on hoisting and on which file names it, because a package reference resolves from the directory of the file that names it, and the predicate sees the name, never the path. Allow only names whose every installed copy you would run.

`extends` runs code whatever format the config is in. A JSON, YAML or `package.json` config that the explorer finds can still name a local path in `extends`, and the default policy trusts local paths, so loading such a config can evaluate a TypeScript or JavaScript file. A data-format config is not inert: refuse local paths in `trust` too if you must load configs you do not control.

### Merging

`merge` is a pairwise function `(base, override) => merged`, called with `{}` as the first base. The default, `deepMerge`, merges plain objects (object literals, `Object.create(null)`, parsed JSON) key by key, replaces every other value (arrays, scalars, dates, regular expressions, maps, sets and class instances, which it never rebuilds), and never lets `undefined` override a value. It builds result objects from own data properties, so a `__proto__` key in a layer stays ordinary data.

Arrays replace by default. To combine them, pass your own `merge`:

```ts
import { deepMerge, type Merge } from 'cosmiconfig-extends';

const unionArrays: Merge = (base, override) => {
  if (Array.isArray(base) && Array.isArray(override)) {
    return [...new Set([...base, ...override])];
  }
  return deepMerge(base, override);
};
```

This one unions top-level arrays only. Recurse into objects yourself if nested arrays should union too.

`merge` also decides which keys reach the result: a layer-only key such as a preset's `name` is carried into the config unless `merge` or `schema` drops it.

### Validation

`presetSchema` and `schema` accept any [Standard Schema](https://standardschema.dev) implementation (zod, valibot, ArkType and others) and are awaited, so asynchronous validators work. A failure throws `ConfigValidationError`, whose `issues` are normalised `{ path, message }` entries with a path of strings and numbers. The error keeps no raw validator issues, but each `message` is the validator's own text and some validators quote the received value in it (valibot's defaults do, zod's do not), so a secret in a config can appear in the error message and in `issues`. Configure the validator's messages, or keep the error out of logs, where that matters.

`validateStandard(schema, value, source)` is exported for validating anything else the same way.

## `createDefineConfig`

`createDefineConfig<Input>()` returns a `defineConfig` helper that type-checks its argument and returns it unchanged. It deliberately applies no schema defaults: `extends` merges what a module exports, so a default applied while authoring would look like a value the author wrote and would override the preset it extends. Give `Input` an optional `extends` key, and make optional any field a preset may supply. Validation and defaults belong to the `schema` option, which runs once on the merged result.

## Development

Requires Node 22 or later for the toolchain and pnpm. The published package supports Node 20 and later.

```sh
pnpm install
pnpm lint            # eslint, with --fix
pnpm lint:check      # eslint, check only; what CI runs
pnpm typecheck
pnpm test            # vitest, with coverage
pnpm build           # tsdown: ESM, CJS and declarations
pnpm test:mutation   # Stryker, with a 100% break threshold; CI runs it on manual dispatch only
```

CI also runs `pnpm exec publint` and `pnpm exec attw --pack` after the build. It also installs the packed tarball into a scratch project on each supported Node line and both cosmiconfig majors, and loads a config with `extends` through it as ESM and as CommonJS.

Both cosmiconfig majors are installed as dev dependencies under the aliases `cosmiconfig-9` and `cosmiconfig-10`, so `src/interop.integration.test.ts` exercises the loader and transform against each. `test/source` holds tests relocated from the project this package was extracted from, together with the domain they exercise, adapted onto the public API. They are the compatibility check for `extends` semantics.

CI selects its runner with `ExaDev/runner-fallback-action` (self-hosted fleet first, Blacksmith as fallback). The release job stays on a GitHub-hosted runner because npm trusted publishing needs one, and publishes with provenance through OIDC, with no stored token.

Commits follow [Conventional Commits](https://www.conventionalcommits.org); semantic-release derives the version from them.
