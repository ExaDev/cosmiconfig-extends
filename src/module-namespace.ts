// intent/module-namespace — shared TS-module default-export extraction.
//
// When jiti evaluates a TypeScript module, the result is a module namespace
// object whose default export lives under the `.default` key. When the module
// has no named exports (only `export default`), jiti may return the value
// directly. This helper normalises both cases: it unwraps `.default` when
// present and returns the module namespace otherwise, so callers always get
// the intended value without needing to know the module's export style.
//
// Used by the config loader (intent/loader.ts), preset loader
// (intent/preset-load.ts), and provider loader (provider/load.ts) — the three
// TS-module evaluation sites in core.

/**
 * Extract the default export from a jiti-evaluated module namespace.
 *
 * - If the namespace is not an object (e.g. a plain value), return it as-is.
 * - If the namespace has a `default` key, return `namespace.default`.
 * - Otherwise, return the namespace itself (the module only had a default
 *   export and jiti returned the value directly).
 */
export function defaultExportOf(moduleNamespace: unknown): unknown {
  if (typeof moduleNamespace !== 'object' || moduleNamespace === null) {
    return moduleNamespace
  }
  if ('default' in moduleNamespace) {
    return moduleNamespace.default
  }

  return moduleNamespace
}
