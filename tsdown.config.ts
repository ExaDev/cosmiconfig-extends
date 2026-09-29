import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  root: 'src',
  format: ['esm', 'cjs'],
  dts: true,
  platform: 'node',
  // Keeps the .js (ESM) and .cjs (CJS) extensions package.json's exports map names; on the node platform tsdown would otherwise emit .mjs.
  fixedExtension: false,
  clean: true,
});
