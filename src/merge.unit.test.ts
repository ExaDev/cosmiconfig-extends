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

  it('keeps a __proto__ key as ordinary data instead of changing a prototype', () => {
    const hostile: unknown = JSON.parse('{"__proto__":{"polluted":"yes"}}');
    const merged = deepMerge({}, hostile);

    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(Object.getOwnPropertyNames(merged)).toEqual(['__proto__']);
    expect('polluted' in {}).toBe(false);
  });
});
