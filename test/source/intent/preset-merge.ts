// intent — the pure preset/config merge.
//
// Given an ordered list of layers (preset = defaults, local config = overrides),
// deep-merge them into a single effective config input, then validate it once
// through ConfigSchema. This module is PURE: no clock, no randomness, no
// network, no module IO. Resolving the `extends` references to preset modules is
// IO and lives at the adapter edge (preset-load.ts); this module only composes
// already-resolved layers, so it stays deterministic and is the oracle the
// loader builds on.
//
// Layer ordering, from earliest (deepest defaults) to latest (final overrides):
//   deepest-base preset -> ... -> direct preset -> local config.
// A later layer overrides an earlier one. The merge rules:
//
// - Substrate scalars (repoTopology / packageManager / taskRunner / schema):
//   last-wins. A layer that SETS a field overrides earlier layers; a layer that
//   OMITS a field (the value is undefined) does not override — 'no opinion' is
//   not the same as setting a value. This is why the layers are the raw inputs,
//   where an omitted field is genuinely absent, rather than the parsed config,
//   where ConfigSchema's defaults would have already materialised a value.
//
// - Capability bindings: merged key-by-key. A capability a later layer also
//   binds wins for that key. Multi-select (array) bindings compose by set-union
//   across layers, preserving order and de-duplicating, so a base preset's
//   ['tailwind'] and a config's ['css-modules'] yield ['tailwind', 'css-modules']
//   rather than the later layer replacing the earlier. Single-select string
//   bindings and the frontend object binding are whole values a later layer
//   replaces outright.

import {
  CapabilityBindingSchema,
  ConfigSchema,
  PackageManagerKeySchema,
  RepoTopologySchema,
  SchemaKeySchema,
  TaskRunnerKeySchema,
  type CapabilityBinding,
  type Config,
} from './config.js'
import { ConfigUnitSchema, type ConfigUnit } from './units.js'
import { z } from 'zod'

/**
 * A single merge layer: the substrate fields and capability bindings a preset
 * or the local config contributes, every field optional. It deliberately omits
 * `extends` and `name` — those are consumed by the loader (chain resolution and
 * diagnostics) before merging, never themselves merged into the effective
 * config. References the bare schemas (no `.default`) so an omitted field stays
 * undefined and does not override an earlier layer.
 */
export const ConfigLayerSchema = z.object({
  repoTopology: RepoTopologySchema.optional(),
  packageManager: PackageManagerKeySchema.optional(),
  taskRunner: TaskRunnerKeySchema.optional(),
  schema: SchemaKeySchema.optional(),
  capabilities: z.record(z.string().min(1), CapabilityBindingSchema).optional(),
  // A preset may declare deployable units (the bare schema, no default), so a
  // layer that omits units leaves an earlier layer's units untouched rather than
  // overriding with an empty array. Units replace as a whole value across layers
  // (last-wins): they are a unit set, not a key-merged map like capabilities.
  units: z.array(ConfigUnitSchema).optional(),
})

/**
 * A merge layer (preset contribution or local config contribution).
 */
export type ConfigLayer = z.infer<typeof ConfigLayerSchema>

/**
 * Merge two capability bindings for the same capability key: `later` overrides
 * `earlier`, except that when BOTH are multi-select arrays they compose by
 * order-preserving set-union (earlier entries first, later entries appended,
 * duplicates dropped). Any other shape combination — string over array, object
 * over string, array over string — is a whole-value replacement by `later`,
 * because those bindings are not composable values.
 */
function mergeBinding(
  earlier: CapabilityBinding,
  later: CapabilityBinding,
): CapabilityBinding {
  if (Array.isArray(earlier) && Array.isArray(later)) {
    const union: string[] = [...earlier]
    for (const ref of later) {
      if (!union.includes(ref)) {
        union.push(ref)
      }
    }
    return union
  }
  return later
}

/**
 * Merge the capability maps of two layers key-by-key. Keys only in `earlier`
 * carry through; keys only in `later` are added; keys in both are merged with
 * mergeBinding (multi-select unions, everything else last-wins).
 */
function mergeCapabilities(
  earlier: Record<string, CapabilityBinding> | undefined,
  later: Record<string, CapabilityBinding> | undefined,
): Record<string, CapabilityBinding> | undefined {
  if (earlier === undefined) {
    return later
  }
  if (later === undefined) {
    return earlier
  }
  const merged: Record<string, CapabilityBinding> = { ...earlier }
  for (const [key, binding] of Object.entries(later)) {
    const existing = merged[key]
    merged[key] =
      existing === undefined ? binding : mergeBinding(existing, binding)
  }
  return merged
}

/**
 * Overlay `later` onto `earlier` for one pair of layers. A substrate field set
 * by `later` overrides `earlier`; an undefined field in `later` leaves
 * `earlier`'s value untouched. Capabilities merge key-by-key.
 */
function overlay(earlier: ConfigLayer, later: ConfigLayer): ConfigLayer {
  return {
    repoTopology: later.repoTopology ?? earlier.repoTopology,
    packageManager: later.packageManager ?? earlier.packageManager,
    taskRunner: later.taskRunner ?? earlier.taskRunner,
    schema: later.schema ?? earlier.schema,
    capabilities: mergeCapabilities(earlier.capabilities, later.capabilities),
    units: mergeUnits(earlier.units, later.units),
  }
}

/**
 * Merge the units of two layers: a layer that sets units replaces an earlier
 * layer's units outright (last-wins, whole-value), and an omitted units leaves
 * the earlier layer's untouched. Units are a unit set, not a key-merged map, so
 * there is no per-unit composition across layers.
 */
function mergeUnits(
  earlier: ConfigUnit[] | undefined,
  later: ConfigUnit[] | undefined,
): ConfigUnit[] | undefined {
  return later ?? earlier
}

/**
 * Fold an ordered list of layers (earliest first) into a single merged layer by
 * overlaying each onto the accumulated result. An empty list yields an empty
 * layer; the single-layer case returns that layer unchanged.
 */
export function mergeLayers(layers: readonly ConfigLayer[]): ConfigLayer {
  return layers.reduce<ConfigLayer>((accumulated, layer) => overlay(accumulated, layer), {})
}

/**
 * Merge the ordered layers and validate the result through ConfigSchema, so the
 * effective config is exactly what the engine resolves and plans. ConfigSchema's
 * defaults apply only here, at the end, to fields no layer set (e.g. `schema`
 * defaults to 'zod' only when neither a preset nor the config chose one), never
 * masking a layer's explicit choice. Throws (via Zod) if the merged result is
 * not a valid config — a required substrate field no layer supplied, say — which
 * is a loud failure, not a silent default.
 */
export function mergeToConfig(layers: readonly ConfigLayer[]): Config {
  return ConfigSchema.parse(mergeLayers(layers))
}
