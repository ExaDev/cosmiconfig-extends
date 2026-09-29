import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  root: 'src',
  format: ['esm', 'cjs'],
  dts: true,
  platform: 'node',
  clean: true,
});
