import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { cosmiconfig, type CosmiconfigResult, type Options, type PublicExplorer } from 'cosmiconfig';

import { createExtendsTransform, type ExtendsOptions } from './extends';
import { createJitiLoader, type JitiLoaderOptions } from './loader';

/**
 * Options for {@link createExplorer}.
 */
export interface ExplorerOptions extends JitiLoaderOptions, Omit<ExtendsOptions, 'importer'> {
  /**
   * Passed to cosmiconfig unchanged, except that `transform` is owned by this package and `loaders` are merged over the jiti loader for `.ts`, `.mts` and `.cts`, so an entry here for one of those extensions replaces the jiti loader for it.
   */
  readonly cosmiconfig?: Omit<Partial<Options>, 'transform'>;
  /**
   * Bounds an upward search. A directory makes `search` check the start directory and each parent in turn, up to and including that directory, and never reads the user's global config directory. `'project'` stops at the first directory containing a `package.json` or `package.yaml`, as cosmiconfig's `project` strategy does; pass `./project` to name a directory called `project`.
   *
   * Cannot be combined with `cosmiconfig.searchStrategy` or `cosmiconfig.stopDir`: `createExplorer` throws. A directory is resolved against the working directory when `search` runs, and `search` throws when its start directory is not inside it.
   *
   * Without this option, cosmiconfig's own default applies: only the start directory is searched.
   */
  readonly searchUpTo?: string;
}

const PROJECT_BOUND = 'project';

function assertNoRawSearchBounds(searchUpTo: string, raw: ExplorerOptions['cosmiconfig']): void {
  const conflicting = (['searchStrategy', 'stopDir'] as const).filter((key) => raw?.[key] !== undefined);
  if (conflicting.length > 0) {
    throw new TypeError(`createExplorer: searchUpTo '${searchUpTo}' cannot be combined with ${conflicting.map((key) => `cosmiconfig.${key}`).join(' and ')}`);
  }
}

/**
 * Searches `from` and each parent directory up to and including `stopDir`, returning the first result.
 *
 * `explorer` must use the `none` search strategy, which checks only the directory it is given. cosmiconfig's `global` strategy cannot express this bound, because it always ends by reading the OS config directory, whatever `stopDir` is.
 */
async function searchThroughParents(explorer: Readonly<PublicExplorer>, from: string, stopDir: string): Promise<CosmiconfigResult> {
  const stop = resolve(stopDir);
  let current = resolve(from);
  const fromStop = relative(stop, current);
  if (fromStop === '..' || fromStop.startsWith(`..${sep}`) || isAbsolute(fromStop)) {
    throw new RangeError(`createExplorer: cannot search from '${current}' up to searchUpTo '${stop}', which does not contain it`);
  }

  let result = await explorer.search(current);
  while (result === null && current !== stop) {
    current = dirname(current);
    result = await explorer.search(current);
  }

  return result;
}

/**
 * Create a standard cosmiconfig explorer, from whichever of cosmiconfig 9 or 10 is installed, that loads TypeScript configs through jiti and applies `extends` to every result.
 *
 * The explorer never relies on cosmiconfig's own `.ts` handling, which needs the optional `typescript` peer in cosmiconfig 9 and native type stripping in cosmiconfig 10.
 */
export function createExplorer(moduleName: string, options: ExplorerOptions = {}): PublicExplorer {
  const { searchUpTo } = options;
  if (searchUpTo === '') {
    throw new TypeError("createExplorer: searchUpTo must be 'project' or a directory, not an empty string");
  }
  if (searchUpTo !== undefined) {
    assertNoRawSearchBounds(searchUpTo, options.cosmiconfig);
  }

  const { loader, importer } = createJitiLoader(options);
  const explorer = cosmiconfig(moduleName, {
    ...options.cosmiconfig,
    ...(searchUpTo === undefined ? {} : { searchStrategy: searchUpTo === PROJECT_BOUND ? 'project' : 'none' }),
    loaders: { '.ts': loader, '.mts': loader, '.cts': loader, ...options.cosmiconfig?.loaders },
    transform: createExtendsTransform({ ...options, importer }),
  });

  if (searchUpTo === undefined || searchUpTo === PROJECT_BOUND) {
    return explorer;
  }

  return { ...explorer, search: async (searchFrom = '') => searchThroughParents(explorer, searchFrom, searchUpTo) };
}
