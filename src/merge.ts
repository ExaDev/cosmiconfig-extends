/**
 * Combines two layers of a config. `base` is the accumulated result of every earlier layer (`{}` for the first fold) and `override` is the next, higher-priority layer.
 */
export type Merge = (base: unknown, override: unknown) => unknown;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The default {@link Merge}: plain objects merge key by key, arrays and scalars are replaced by the override, and an `undefined` override never replaces a value. Result objects are built with own data properties, so a `__proto__` key in a layer stays an ordinary key and cannot change a prototype.
 */
export const deepMerge: Merge = (base, override) => {
  if (override === undefined) {
    return base;
  }

  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override;
  }

  const keys = new Set([...Object.keys(base), ...Object.keys(override)]);

  return Object.fromEntries([...keys].map((key) => [key, deepMerge(base[key], override[key])]));
};
