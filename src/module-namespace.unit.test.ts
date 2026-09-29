import { describe, expect, it } from 'vitest';

import { defaultExportOf } from './module-namespace';

describe('defaultExportOf', () => {
  it('returns a non-object namespace as-is', () => {
    expect(defaultExportOf(true)).toBe(true);
    expect(defaultExportOf('text')).toBe('text');
    expect(defaultExportOf(undefined)).toBeUndefined();
  });

  it('returns null as-is', () => {
    expect(defaultExportOf(null)).toBeNull();
  });

  it('unwraps the default key when present', () => {
    expect(defaultExportOf({ default: { a: 1 }, named: 2 })).toEqual({ a: 1 });
  });

  it('unwraps a default key whose value is falsy', () => {
    expect(defaultExportOf({ default: 0 })).toBe(0);
  });

  it('returns a namespace without a default key unchanged', () => {
    const namespace = { a: 1 };
    expect(defaultExportOf(namespace)).toBe(namespace);
  });
});
