import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ConfigValidationError, validateStandard } from './validate';

/**
 * A hand-written Standard Schema whose validation is asynchronous and whose issue paths use every segment shape the specification allows.
 */
const handWritten: StandardSchemaV1<unknown, { readonly ok: true }> = {
  '~standard': {
    version: 1,
    vendor: 'hand-written',
    validate: async (value) =>
      Promise.resolve(
        value === 'valid'
          ? { value: { ok: true } as const }
          : {
              issues: [
                { message: 'plain segments', path: ['a', 'b', 0] },
                { message: 'object segment', path: [{ key: 'c' }, { key: 1 }] },
                { message: 'symbol segment', path: [Symbol('d')] },
                { message: 'root issue' },
                { message: 'empty path', path: [] },
              ],
            },
      ),
  },
};

describe('validateStandard', () => {
  it('returns the schema output, including defaults the schema applies', async () => {
    const schema = z.object({ name: z.string(), mode: z.string().default('strict') });

    expect(await validateStandard(schema, { name: 'x' }, 'config')).toEqual({ name: 'x', mode: 'strict' });
  });

  it('awaits an asynchronous validator', async () => {
    expect(await validateStandard(handWritten, 'valid', 'config')).toEqual({ ok: true });
  });

  it('normalises every path segment shape and formats one line per issue', async () => {
    const error = await validateStandard(handWritten, 'invalid', 'config /tmp/x.ts').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConfigValidationError);
    expect(error).toMatchObject({
      name: 'ConfigValidationError',
      message: [
        'invalid config /tmp/x.ts:',
        '  a.b.0: plain segments',
        '  c.1: object segment',
        '  Symbol(d): symbol segment',
        '  (root): root issue',
        '  (root): empty path',
      ].join('\n'),
      issues: [
        { path: ['a', 'b', 0], message: 'plain segments' },
        { path: ['c', 1], message: 'object segment' },
        { path: ['Symbol(d)'], message: 'symbol segment' },
        { path: [], message: 'root issue' },
        { path: [], message: 'empty path' },
      ],
    });
  });

  describe.each([
    [
      'zod',
      z.object({ mode: z.enum(['a', 'b']), nested: z.object({ count: z.string() }) }),
    ],
    [
      'valibot',
      v.object({ mode: v.picklist(['a', 'b']), nested: v.object({ count: v.string() }) }),
    ],
  ] as const)('with %s', (_vendor, schema) => {
    it('accepts a valid value', async () => {
      const valid = { mode: 'a', nested: { count: 'x' } };

      expect(await validateStandard(schema, valid, 'config')).toEqual(valid);
    });

    it('reports the dotted path of each failure', async () => {
      const error = await validateStandard(schema, { mode: 'nope', nested: { count: true } }, 'config').catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(ConfigValidationError);
      expect(error).toMatchObject({ issues: [{ path: ['mode'] }, { path: ['nested', 'count'] }] });
    });

    it('exposes only path and message, with primitive path segments, so a validator that embeds the input in its raw issues cannot leak it', async () => {
      const error = await validateStandard(schema, { mode: 'nope', nested: { count: false } }, 'config').catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(ConfigValidationError);
      if (!(error instanceof ConfigValidationError)) {
        return;
      }

      for (const issue of error.issues) {
        expect(Object.keys(issue).sort()).toEqual(['message', 'path']);
        expect(issue.path.every((segment) => typeof segment === 'string' || typeof segment === 'number')).toBe(true);
      }
    });
  });
});
