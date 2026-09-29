const PACKAGE_DIRECTORY = /.*[/\\]node_modules[/\\]((?:@[^/\\]+[/\\])?[^/\\]+)[/\\]/;

/**
 * The name of the installed package that contains `absolutePath`, taken from the innermost `node_modules` directory in it and written with `/` between a scope and a name on every platform, or `undefined` for a file outside any `node_modules`.
 */
export function installedPackageOf(absolutePath: string): string | undefined {
  return PACKAGE_DIRECTORY.exec(absolutePath)?.[1]?.replace('\\', '/');
}
