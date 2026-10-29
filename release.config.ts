import type { Options } from 'semantic-release';

type ReleaseLevel = 'major' | 'minor' | 'patch' | false;

interface CommitType {
  readonly type: string;
  readonly release: ReleaseLevel;
  /** The heading this type's commits are listed under in the release notes and CHANGELOG.md. */
  readonly section: string;
}

/**
 * Single source of truth for the conventional-commit types this project uses. commitlint's allowed type-enum (commitlint.config.ts imports this) and commit-analyzer's releaseRules below both derive from it, so a type cannot trigger a release without also being accepted by commit-msg validation, or the reverse. Every type here is also listed in the release notes, so a release is never cut by a commit that its own notes omit.
 */
export const commitTypes: readonly CommitType[] = [
  { type: 'feat', release: 'minor', section: 'Features' },
  { type: 'fix', release: 'patch', section: 'Bug Fixes' },
  { type: 'perf', release: 'patch', section: 'Performance Improvements' },
  { type: 'revert', release: 'patch', section: 'Reverts' },
  { type: 'refactor', release: 'patch', section: 'Code Refactoring' },
  { type: 'docs', release: 'patch', section: 'Documentation' },
  { type: 'style', release: 'patch', section: 'Styles' },
  { type: 'test', release: 'patch', section: 'Tests' },
  { type: 'build', release: 'patch', section: 'Build System' },
  { type: 'ci', release: 'patch', section: 'Continuous Integration' },
  { type: 'chore', release: 'patch', section: 'Chores' },
];

/**
 * Runs on `main`. Analyses commits since the last tag, bumps the version, publishes to npmjs.org through trusted OIDC publishing (no stored token, see .github/workflows/ci.yml), creates a versioned tag and GitHub Release with generated notes, and commits CHANGELOG.md and package.json back to main.
 */
const config: Options = {
  branches: ['main'],
  // Deliberately the SSH form, not package.json's own git+https:// repository field (that field stays https://; it is public consumer-facing metadata, unrelated to how this release pushes). semantic-release first tries to push to the repositoryUrl as given, and only if that fails rewrites it to https with the GITHUB_TOKEN embedded; the default GITHUB_TOKEN cannot bypass main's branch ruleset, so that fallback push would be rejected. The push as given authenticates with the deploy key the Release job provisions through GIT_SSH_COMMAND for the Release step alone (see .github/workflows/ci.yml), which the ruleset lists as a DeployKey bypass actor.
  repositoryUrl: 'git@github.com:ExaDev/cosmiconfig-extends.git',
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'conventionalcommits',
        releaseRules: [{ breaking: true, release: 'major' }, ...commitTypes.map((t) => ({ type: t.type, release: t.release }))],
      },
    ],
    [
      '@semantic-release/release-notes-generator',
      {
        // conventional-changelog-conventionalcommits is a direct dependency pinned to 9.x, not left to resolve through @commitlint/config-conventional: release-notes-generator loads conventional-changelog-writer 8, and the 10.x preset needs writer 9, so it renders an error instead of notes. With 9.x, presetConfig.types lists every type in commitTypes under its section, which the angular preset cannot (it lists only feat, fix, perf and revert, so a release cut by a docs, refactor, ci or chore commit had a version header and nothing under it). The version header is always H2, so the file's only H1 stays this repository's own title.
        preset: 'conventionalcommits',
        presetConfig: {
          types: commitTypes.map((t) => ({ type: t.type, section: t.section })),
        },
      },
    ],
    '@semantic-release/changelog',
    ['@semantic-release/npm', { npmPublish: true }],
    '@semantic-release/github',
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json'],
        message: 'chore(release): ${nextRelease.version} [skip ci]',
      },
    ],
  ],
};

export default config;
