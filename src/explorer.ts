import { cosmiconfig, type Options, type PublicExplorer } from 'cosmiconfig';

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
}

/**
 * Create a standard cosmiconfig explorer, from whichever of cosmiconfig 9 or 10 is installed, that loads TypeScript configs through jiti and applies `extends` to every result.
 *
 * The explorer never relies on cosmiconfig's own `.ts` handling, which needs the optional `typescript` peer in cosmiconfig 9 and native type stripping in cosmiconfig 10.
 */
export function createExplorer(moduleName: string, options: ExplorerOptions = {}): PublicExplorer {
  const { loader, importer } = createJitiLoader(options);

  return cosmiconfig(moduleName, {
    ...options.cosmiconfig,
    loaders: { '.ts': loader, '.mts': loader, '.cts': loader, ...options.cosmiconfig?.loaders },
    transform: createExtendsTransform({ ...options, importer }),
  });
}
