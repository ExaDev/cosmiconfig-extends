import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import exadev from '@exadev/eslint-config';

export default defineConfig(
  {
    ignores: [
      'dist',
      'coverage',
      'node_modules',
      'reports',
      '.stryker-tmp',
      // Files relocated byte for byte from the source project (its tests, and the domain modules they exercise). They are kept verbatim so any drift from the original shows as a diff, which their formatting and naming would not survive `eslint --fix`.
      'test/source/intent/*.test.ts',
      'test/source/intent/config.ts',
      'test/source/intent/preset.ts',
      'test/source/intent/preset-merge.ts',
      'test/source/provider/trust.ts',
    ],
  },
  {
    languageOptions: {
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
  },
  { ...js.configs.recommended, files: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'] },
  ...exadev,
  {
    // The fixture authoring barrel stands in for the source project's public entry point, which configs and presets under test import by specifier.
    files: ['test/source/index.ts'],
    rules: { 'exadev/barrel-policy': 'off' },
  },
);
