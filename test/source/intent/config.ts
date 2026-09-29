// intent — the single Zod ConfigSchema (SSOT) and defineConfig.
//
// This schema is the single source of truth for the user config, the prompts,
// the CLI flags, and the substrate CapabilityKey/ProviderKey enums. Authoring
// is compiler-backed; the schema also runs as a defensive runtime validator
// after the executable config is evaluated (TypeScript types erase at runtime).

import { z } from 'zod'

import { ConfigUnitSchema } from './units.js'

/**
 * Substrate capability: repo topology. Intra-repo shape; exactly-one.
 */
export const RepoTopologySchema = z.enum(['monorepo', 'single-package'])
export type RepoTopology = z.infer<typeof RepoTopologySchema>

/**
 * Substrate capability: package manager; exactly-one.
 */
export const PackageManagerKeySchema = z.enum(['pnpm', 'npm', 'yarn', 'bun'])
export type PackageManagerKey = z.infer<typeof PackageManagerKeySchema>

/**
 * Substrate capability: task runner; exactly-one ('none' allowed).
 */
export const TaskRunnerKeySchema = z.enum(['turbo', 'nx', 'moon', 'none'])
export type TaskRunnerKey = z.infer<typeof TaskRunnerKeySchema>

/**
 * Substrate capability: schema library for the scaffolded repo; exactly-one.
 */
export const SchemaKeySchema = z.enum(['zod', 'valibot', 'arktype'])
export type SchemaKey = z.infer<typeof SchemaKeySchema>

/**
 * A binding to a provider of a capability. A provider reference is one of:
 * - 'self'                  — the developer implements the port,
 * - a package specifier     — '@my-tool/orpc', a third-party package,
 * - a local path            — './packages/my-storage'.
 *
 * The string form is deliberately permissive: the resolver, not the schema,
 * checks that a referenced provider actually exists and fulfils the capability.
 */
export const ProviderRefSchema = z.string().min(1)
export type ProviderRef = z.infer<typeof ProviderRefSchema>

/**
 * A renderer-shaped frontend binding: renderer plus builder, a fixed combo.
 */
export const FrontendBindingSchema = z.object({
  renderer: z.string().min(1),
  builder: z.string().min(1),
})
export type FrontendBinding = z.infer<typeof FrontendBindingSchema>

/**
 * A provider-options binding: a provider reference plus arbitrary extra keys
 * that are the provider's own options (e.g. `{ provider: '@my-tool/eslint',
 * format: 'js' }`). This is the general provider-options shape the README
 * describes; the `provider` field is reserved, every other key is an option.
 *
 * The schema deliberately keeps the option keys loose (`looseObject`): the
 * config schema cannot know any given provider's option contract, so it only
 * guarantees a `provider` ref is present and carries the rest through verbatim.
 * Each provider's own `options` Zod schema (declared via defineProvider) is what
 * validates and types its options; the engine runs it before generation, so a
 * bad option fails loudly there rather than being silently dropped here.
 *
 * Requiring `provider` is what keeps this disjoint from the frontend binding
 * (which has `renderer`/`builder` and no `provider`): the union never matches
 * ambiguously.
 */
export const ProviderOptionsBindingSchema = z.looseObject({
  provider: ProviderRefSchema,
})
export type ProviderOptionsBinding = z.infer<
  typeof ProviderOptionsBindingSchema
>

/**
 * A capability binding in the config map. A single-select capability takes a
 * bare provider reference (default options) or the `{ provider, ...options }`
 * object form; the frontend takes a renderer/builder object; a multi-select
 * capability takes an array of provider references.
 *
 * Union member order matters: ProviderOptionsBindingSchema requires a
 * `provider` key, so a frontend `{ renderer, builder }` object falls through to
 * FrontendBindingSchema. The two object forms are disjoint by construction.
 */
export const CapabilityBindingSchema = z.union([
  ProviderRefSchema,
  ProviderOptionsBindingSchema,
  FrontendBindingSchema,
  z.array(ProviderRefSchema),
])
export type CapabilityBinding = z.infer<typeof CapabilityBindingSchema>

/**
 * Type guard: a binding is the `{ provider, ...options }` object form. Narrows
 * without a cast so the provider ref and options can be read type-safely.
 */
export function isProviderOptionsBinding(
  binding: CapabilityBinding,
): binding is ProviderOptionsBinding {
  return (
    typeof binding === 'object' &&
    !Array.isArray(binding) &&
    'provider' in binding
  )
}

/**
 * The single provider ref a binding names, or undefined when the binding names
 * no single provider (a frontend renderer/builder object, or a multi-select
 * array — both handled by their own machinery). A bare string is its own ref;
 * the `{ provider, ...options }` form yields its `provider` field.
 */
export function bindingProvider(
  binding: CapabilityBinding,
): string | undefined {
  if (typeof binding === 'string') {
    return binding
  }
  if (isProviderOptionsBinding(binding)) {
    return binding.provider
  }
  return undefined
}

/**
 * The provider options a binding carries (the object form's keys minus the
 * reserved `provider`), or an empty object for any binding form that carries no
 * options. The result is unvalidated against any provider schema here — the
 * engine validates it against the bound provider's own `options` schema before
 * passing it to generate(). Returned as a plain object the provider schema then
 * parses; never a cast.
 */
export function bindingOptions(
  binding: CapabilityBinding,
): Record<string, unknown> {
  if (!isProviderOptionsBinding(binding)) {
    return {}
  }
  const options: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(binding)) {
    if (key !== 'provider') {
      options[key] = value
    }
  }
  return options
}

/**
 * A reference to a preset to extend. A preset reference uses the SAME reference
 * space as a provider reference: a published package specifier ('@my-tool/stack'
 * or a third-party package), a local path ('./local-preset'), or a first-party/
 * self key ('self'). The loader, not the schema, resolves the reference to a
 * preset module; the schema only requires a non-empty string.
 */
export const PresetRefSchema = z.string().min(1)
export type PresetRef = z.infer<typeof PresetRefSchema>

/**
 * The `extends` value on a config (and on a preset, for chaining): one preset
 * reference, or an ordered array of references. Ordering is load-bearing for the
 * merge: an array composes left to right (later entries override earlier ones),
 * and the local config overrides every extended preset (preset = defaults,
 * config = overrides).
 */
export const ExtendsSchema = z.union([
  PresetRefSchema,
  z.array(PresetRefSchema),
])
export type Extends = z.infer<typeof ExtendsSchema>

/**
 * The user config. The substrate fields are the four substrate capabilities;
 * `capabilities` binds the remaining (output) capabilities to providers.
 */
export const ConfigSchema = z.object({
  repoTopology: RepoTopologySchema,
  packageManager: PackageManagerKeySchema,
  taskRunner: TaskRunnerKeySchema,
  schema: SchemaKeySchema.default('zod'),
  capabilities: z.record(z.string().min(1), CapabilityBindingSchema).default({}),
  /**
   * The repo's deployable units: each app or library, its directory, the
   * platforms it deploys to, whether it publishes, and the units it consumes.
   * The CLI adapter edge expands these into the per-unit deploy/publish Features
   * the engine resolves. Optional and undefined-by-default (modelled like
   * `extends`, NOT `.default([])`): an absent `units` is genuinely 'no units
   * declared', so a config without it parses byte-identical to today's behaviour
   * and serialises with no `units` key, keeping every existing snapshot green.
   * The engine never reads this field; only the adapter-edge expansion and the
   * config/state serialisers do, each handling the absence explicitly.
   */
  units: z.array(ConfigUnitSchema).optional(),
  /**
   * Presets this config inherits. Optional and undefined-by-default, so a config
   * without it parses to a config object with no `extends` key — byte-identical
   * to today's behaviour. The merge (preset = defaults, config = overrides) is
   * applied by the preset loader at the adapter edge, not by this schema.
   */
  extends: ExtendsSchema.optional(),
})

/**
 * The validated, defaults-applied config (the parameter type of defineConfig is
 * the *input* type, so authoring stays ergonomic).
 */
export type Config = z.infer<typeof ConfigSchema>

/**
 * The authoring input type passed to defineConfig — the schema's input side, so
 * optional/defaulted fields need not be supplied.
 */
export type ConfigInput = z.input<typeof ConfigSchema>

/**
 * The substrate capability keys, derived from the schema's substrate fields.
 */
export const SUBSTRATE_CAPABILITY_KEYS = [
  'repoTopology',
  'packageManager',
  'taskRunner',
  'schema',
] as const
export type SubstrateCapabilityKey = (typeof SUBSTRATE_CAPABILITY_KEYS)[number]

/**
 * Define the user config. The parameter type is z.input<typeof ConfigSchema>,
 * giving compiler-backed authoring; the schema then validates at runtime.
 */
export function defineConfig(config: ConfigInput): Config {
  return ConfigSchema.parse(config)
}

/**
 * Type guard for a parsed config.
 */
export function isConfig(value: unknown): value is Config {
  return ConfigSchema.safeParse(value).success
}

/**
 * Return the config with its `units` field removed. The config-file renderer and
 * the state serialiser both drop an absent or empty `units` so a unit-free config
 * serialises byte-identical to one authored before units existed; this is the
 * single implementation they share. It lives alongside the `Config` type it
 * manipulates so a future field change is made in one place. Reconstructs the
 * kept fields explicitly (rather than destructuring `units` into an unused
 * binding), preserving the optional `extends` only when present so
 * exactOptionalPropertyTypes is satisfied.
 */
export function omitUnits(config: Config): Omit<Config, 'units'> {
  const base: Omit<Config, 'units' | 'extends'> = {
    repoTopology: config.repoTopology,
    packageManager: config.packageManager,
    taskRunner: config.taskRunner,
    schema: config.schema,
    capabilities: config.capabilities,
  }
  return config.extends === undefined ? base : { ...base, extends: config.extends }
}
