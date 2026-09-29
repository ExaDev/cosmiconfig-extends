import { z } from 'zod';

/**
 * Stand-in for the source project's deployable-unit schema, which depends on modules this package does not need. The merge and config schemas only require that a unit schema exists and can be an optional array element.
 */
export const ConfigUnitSchema = z.object({ name: z.string().min(1) });

export type ConfigUnit = z.infer<typeof ConfigUnitSchema>;
