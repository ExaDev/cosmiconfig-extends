import { describe, expect, expectTypeOf, it } from 'vitest';

import { createDefineConfig } from './define-config';

interface Input {
  readonly extends?: string;
  readonly name?: string;
}

describe('createDefineConfig', () => {
  const defineConfig = createDefineConfig<Input>();

  it('returns its argument unchanged, so schema defaults are never applied at authoring time', () => {
    const config = { extends: './preset.ts' };

    expect(defineConfig(config)).toBe(config);
  });

  it('types the argument as the input type', () => {
    expectTypeOf(defineConfig).parameter(0).toEqualTypeOf<Input>();
    expectTypeOf(defineConfig).returns.toEqualTypeOf<Input>();
  });
});
