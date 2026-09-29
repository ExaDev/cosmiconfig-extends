/**
 * Extract the default export from a jiti-evaluated module namespace, so callers get the intended value without knowing the module's export style.
 *
 * - If the namespace is not an object (for example a plain value), it is returned as-is.
 * - If the namespace has a `default` key, `namespace.default` is returned.
 * - Otherwise the namespace itself is returned (the module had no default key and jiti returned the value directly).
 */
export function defaultExportOf(moduleNamespace: unknown): unknown {
  if (typeof moduleNamespace !== 'object' || moduleNamespace === null) {
    return moduleNamespace;
  }

  if ('default' in moduleNamespace) {
    return moduleNamespace.default;
  }

  return moduleNamespace;
}
