import type { StandardSchemaV1 } from '@standard-schema/spec';

/**
 * One validation failure with the path normalised to plain strings and numbers.
 */
export interface ConfigValidationIssue {
  /**
   * Location of the failing value, outermost key first; empty for the root.
   */
  readonly path: readonly (string | number)[];
  readonly message: string;
}

function normalisePath(path: StandardSchemaV1.Issue['path']): readonly (string | number)[] {
  if (path === undefined) {
    return [];
  }

  return path.map((segment) => {
    const key = typeof segment === 'object' ? segment.key : segment;

    return typeof key === 'symbol' ? key.toString() : key;
  });
}

function formatIssue({ path, message }: ConfigValidationIssue): string {
  return `${path.length === 0 ? '(root)' : path.join('.')}: ${message}`;
}

/**
 * Thrown when a value fails Standard Schema validation. It carries normalised `{ path, message }` entries and keeps no raw validator issues. Each `message` is the validator's own text, unchanged, and some validators quote the received value in it (valibot's defaults do), so the error message can contain a value from the config. Do not log it where a secret in the config must not appear, or use messages that omit the input.
 */
export class ConfigValidationError extends Error {
  readonly issues: readonly ConfigValidationIssue[];

  constructor(source: string, issues: readonly StandardSchemaV1.Issue[]) {
    const normalised = issues.map((issue) => ({ path: normalisePath(issue.path), message: issue.message }));
    super(`invalid ${source}:\n${normalised.map((issue) => `  ${formatIssue(issue)}`).join('\n')}`);
    this.name = 'ConfigValidationError';
    this.issues = normalised;
  }
}

/**
 * Validate `value` with any Standard Schema implementation and return the schema's output, so defaults the schema applies are included. `source` names what was validated in the error message. Throws {@link ConfigValidationError} when the schema reports issues.
 */
export async function validateStandard<S extends StandardSchemaV1>(
  schema: S,
  value: unknown,
  source: string,
): Promise<StandardSchemaV1.InferOutput<S>> {
  const result = await schema['~standard'].validate(value);
  if (result.issues !== undefined) {
    throw new ConfigValidationError(source, result.issues);
  }

  return result.value;
}
