/**
 * Create a `defineConfig` helper for a config authored as a TypeScript module: it type-checks the argument against `Input` and returns it unchanged.
 *
 * The helper deliberately does not validate or apply schema defaults. `extends` merges what a module exports, so a default applied at authoring time would be indistinguishable from a value the author wrote and would override the presets it extends. Validation and defaults belong to the `schema` option, which runs once on the merged result. Include the `extends` key in `Input`, and make fields that a preset may supply optional.
 */
export function createDefineConfig<Input extends object>(): (config: Input) => Input {
  return (config) => config;
}
