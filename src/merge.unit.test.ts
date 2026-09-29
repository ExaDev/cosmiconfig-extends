import { describe, expect, it } from 'vitest';

import { deepMerge } from './merge';

describe('deepMerge', () => {
  it('merges plain objects key by key, recursively', () => {
    expect(deepMerge({ a: { x: 'base', y: 'base' }, b: 'base' }, { a: { x: 'override' }, c: 'override' })).toEqual({
      a: { x: 'override', y: 'base' },
      b: 'base',
      c: 'override',
    });
  });

  it('replaces an array rather than concatenating it', () => {
    expect(deepMerge({ list: ['a', 'b'] }, { list: ['c'] })).toEqual({ list: ['c'] });
  });

  it('replaces a scalar, and replaces a value of a different shape', () => {
    expect(deepMerge({ a: 'x', b: { c: 'x' }, d: ['x'] }, { a: 'y', b: 'y', d: { e: 'y' } })).toEqual({
      a: 'y',
      b: 'y',
      d: { e: 'y' },
    });
  });

  it('never lets undefined override a value', () => {
    expect(deepMerge({ a: 'base', b: { c: 'base' } }, { a: undefined, b: { c: undefined } })).toEqual({ a: 'base', b: { c: 'base' } });
    expect(deepMerge('base', undefined)).toBe('base');
  });

  it('lets null override a value', () => {
    expect(deepMerge({ a: 'base' }, { a: null })).toEqual({ a: null });
  });

  it('returns the override when the base is not a plain object', () => {
    expect(deepMerge(undefined, { a: 'x' })).toEqual({ a: 'x' });
    expect(deepMerge(['x'], { a: 'y' })).toEqual({ a: 'y' });
    expect(deepMerge(null, { a: 'y' })).toEqual({ a: 'y' });
  });

  it('returns an empty object for two empty objects', () => {
    expect(deepMerge({}, {})).toEqual({});
  });

  it('does not mutate its inputs', () => {
    const base = { a: { x: 'base' } };
    const override = { a: { y: 'override' } };
    deepMerge(base, override);

    expect(base).toEqual({ a: { x: 'base' } });
    expect(override).toEqual({ a: { y: 'override' } });
  });

  describe('values that are not plain objects', () => {
    function valueAt(container: unknown, key: string): unknown {
      return typeof container === 'object' && container !== null ? Reflect.get(container, key) : undefined;
    }

    class Logger {
      constructor(readonly level: string) {}

      describe(): string {
        return this.level;
      }
    }

    it.each([
      ['a Date', new Date(1), new Date(2)],
      ['a RegExp', /a/u, /b/u],
      ['a Map', new Map([['a', 1]]), new Map([['b', 2]])],
      ['a Set', new Set([1]), new Set([2])],
      ['a class instance', new Logger('info'), new Logger('debug')],
    ])('replaces %s with the override instead of rebuilding it', (_name, base, override) => {
      expect(valueAt(deepMerge({ key: base }, { key: override }), 'key')).toBe(override);
    });

    it('replaces a plain object with a class instance, keeping its prototype', () => {
      expect(valueAt(deepMerge({ logger: { level: 'info' } }, { logger: new Logger('debug') }), 'logger')).toBeInstanceOf(Logger);
    });

    it('merges plain objects with a null prototype', () => {
      const base: unknown = Object.setPrototypeOf({ a: 1 }, null);
      const override: unknown = Object.setPrototypeOf({ b: 2 }, null);

      expect(deepMerge(base, override)).toEqual({ a: 1, b: 2 });
    });
  });

  it('keeps a __proto__ key as ordinary data instead of changing a prototype', () => {
    const hostile: unknown = JSON.parse('{"__proto__":{"polluted":"yes"}}');
    const merged = deepMerge({}, hostile);

    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(Object.getOwnPropertyNames(merged)).toEqual(['__proto__']);
    expect('polluted' in {}).toBe(false);
  });
});
