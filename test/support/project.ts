import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Create a fresh directory containing `files` (relative path to content) and return its real path, so that paths compared against jiti's resolved output are not affected by a symlinked temporary directory.
 */
export function makeProject(files: Readonly<Record<string, string>> = {}): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cosmiconfig-extends-')));
  for (const [relativePath, content] of Object.entries(files)) {
    writeProjectFile(root, relativePath, content);
  }

  return root;
}

/**
 * Write (or overwrite) one file below `root`, creating parent directories.
 */
export function writeProjectFile(root: string, relativePath: string, content: string): string {
  const fullPath = join(root, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);

  return fullPath;
}
