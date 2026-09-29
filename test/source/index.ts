// The authoring barrel that configs and presets import as 'my-tool' and '@my-tool/core'. It exports only the authoring helpers, not the loader adapters, so evaluating a config through jiti does not load the package under test a second time.
export * from './intent/config.js';
export * from './intent/preset-merge.js';
export * from './intent/preset.js';
export * from './intent/units.js';
