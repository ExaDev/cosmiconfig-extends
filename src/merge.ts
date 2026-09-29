/**
 * Combines two layers of a config. `base` is the accumulated result of every earlier layer (`{}` for the first fold) and `override` is the next, higher-priority layer.
 */
export type Merge = (base: unknown, override: unknown) => unknown;

/**
 * A plain object is one created by an object literal, `Object.create(null)` or `JSON.parse`: its prototype is `null` or a root prototype with no prototype of its own. Checking the prototype's prototype rather than `Object.prototype` itself keeps objects from another realm plain. Arrays, dates, regular expressions, maps, sets and class instances are not, so they are values to replace, never containers to rebuild.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

/**
 * The default {@link Merge}: plain objects merge key by key, and every other value (arrays, scalars, dates, regular expressions, maps, sets, class instances) is replaced by the override, and an `undefined` override never replaces a value. Result objects are built with own data properties, so a `__proto__` key in a layer stays an ordinary key and cannot change a prototype.
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
