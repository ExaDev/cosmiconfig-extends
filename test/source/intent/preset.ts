// intent — the definePreset contract and the preset reference shape.
//
// A preset is a shareable, reusable bundle of substrate choices and capability
// bindings that a repo's exadev.config.ts can `extends`, so an org publishes a
// standard stack once and many repos inherit it (the fleet-consistency story for
// polyrepo). A preset is a PARTIAL config: any subset of the substrate fields
// plus any capability bindings, with no field required. It is the defaults layer;
// the local config is the overrides layer (see the merge semantics below).
//
// definePreset mirrors defineProvider/defineConfig: a preset module exports a
// typed, schema-validated definition the loader discovers and validates against
// PresetDefinitionSchema with the isPreset type guard (never a cast). This module
// is pure schema and validation; the dynamic import of a preset module is IO and
// belongs at the adapter edge alongside the config loader and the provider
// loader, exactly as defineProvider's loading lives in provider/load.ts.

import { z } from 'zod'

import {
  CapabilityBindingSchema,
  ExtendsSchema,
  PackageManagerKeySchema,
  RepoTopologySchema,
  SchemaKeySchema,
  TaskRunnerKeySchema,
} from './config.js'
import { ConfigUnitSchema } from './units.js'

// The preset reference space (PresetRefSchema) and the `extends` value
// (ExtendsSchema) are the same on a config and on a preset, so they are defined
// once in config.js (the leaf module) and consumed here. ExtendsSchema composes
// left to right, later overriding earlier, with the local config overriding
// every extended preset; a preset's own `extends` chains depth-first so a base
// preset's values are the deepest defaults. They are not re-exported here
// because the intent barrel already surfaces them from config.js.

/**
 * The preset definition exported by a preset module.
 *
 * Every field is optional: an omitted substrate field means 'do not override'
 * (NOT 'apply the config default'), which is why these reference the bare
 * enum/binding schemas directly rather than ConfigSchema's fields — the latter
 * carry `.default(...)`, which would silently materialise a value the preset
 * author never wrote and turn 'no opinion' into an override.
 *
 * - `name`           — optional human-readable identifier for diagnostics.
 * - `extends`        — this preset's own bases, for preset-extends-preset chains.
 * - `repoTopology` / `packageManager` / `taskRunner` / `schema` — substrate
 *   overrides; each is a single value that the next layer down may override.
 * - `capabilities`  — capability bindings contributed by this preset; merged
 *   key-by-key with the next layer (a key the local config also binds wins).
 */
export const PresetDefinitionSchema = z.object({
  name: z.string().min(1).optional(),
  extends: ExtendsSchema.optional(),
  repoTopology: RepoTopologySchema.optional(),
  packageManager: PackageManagerKeySchema.optional(),
  taskRunner: TaskRunnerKeySchema.optional(),
  schema: SchemaKeySchema.optional(),
  capabilities: z
    .record(z.string().min(1), CapabilityBindingSchema)
    .optional(),
  // A preset may declare deployable units (the bare schema, no default), so an
  // omitted units field means 'do not override' rather than 'apply []'. The
  // monorepo-cloudflare preset uses this to ship its apps/web + apps/api units.
  units: z.array(ConfigUnitSchema).optional(),
})

/**
 * The validated shape of a preset definition (post-parse). Because every field
 * is optional and none defaulted, the parsed shape equals the input shape.
 */
export type PresetDefinition = z.infer<typeof PresetDefinitionSchema>

/**
 * The input a preset author passes to definePreset. Identical to the parsed
 * shape (no defaults are applied), exposed separately to mirror the
 * defineProvider/defineConfig input-type convention.
 */
export type PresetInput = z.input<typeof PresetDefinitionSchema>

/**
 * Define a preset. Validates the definition at the boundary so a malformed
 * preset fails loudly when authored or loaded rather than corrupting the merge.
 */
export function definePreset(input: PresetInput): PresetDefinition {
  return PresetDefinitionSchema.parse(input)
}

/**
 * Type guard for a parsed preset definition. The preset loader (at the adapter
 * edge) validates a dynamically-imported module's export with this guard rather
 * than casting it, mirroring isProviderDefinition / isFeature.
 */
export function isPreset(value: unknown): value is PresetDefinition {
  return PresetDefinitionSchema.safeParse(value).success
}
