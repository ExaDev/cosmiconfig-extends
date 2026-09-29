import { describe, expect, it } from 'vitest';

import { installedPackageOf } from './installed-package';

describe('installedPackageOf', () => {
  it.each([
    ['/repo/node_modules/name/index.js', 'name'],
    ['/repo/node_modules/@scope/name/lib/index.js', '@scope/name'],
    ['C:\\repo\\node_modules\\@scope\\name\\index.js', '@scope/name'],
    ['C:\\repo\\node_modules\\name\\index.js', 'name'],
  ])('names the package of %s', (path, expected) => {
    expect(installedPackageOf(path)).toBe(expected);
  });

  it('takes the innermost node_modules directory, including a package manager store layout', () => {
    expect(installedPackageOf('/repo/node_modules/.pnpm/a@1.0.0/node_modules/a/node_modules/@s/b/index.js')).toBe('@s/b');
    expect(installedPackageOf('/repo/node_modules/.pnpm/a@1.0.0/node_modules/a/index.js')).toBe('a');
  });

  it('returns undefined outside any node_modules directory', () => {
    expect(installedPackageOf('/repo/src/index.ts')).toBeUndefined();
    expect(installedPackageOf('/repo/not_node_modules/name/index.js')).toBeUndefined();
  });

  it('returns undefined for a file directly inside node_modules, which belongs to no package', () => {
    expect(installedPackageOf('/repo/node_modules/file.js')).toBeUndefined();
  });
});
